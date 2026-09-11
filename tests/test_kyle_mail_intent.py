import app as app_module


def test_explicit_send_ignores_reply_word_in_message_body(monkeypatch):
    monkeypatch.setattr(app_module, 'chat_with_kyle', lambda _prompt: '{"subject":"Integration test","body":"Hello"}')
    result = app_module._handle_mail_intent(
        'Send an email to person@example.com saying no reply is needed.',
        None,
        {'id': 'stale', 'sender': 'Other <other@example.com>'},
        [],
        {'name': 'Tester'},
    )
    assert [action['tool'] for action in result['actions']] == ['mail.compose', 'mail.send_draft']
    assert result['actions'][0]['args']['to'] == 'person@example.com'
    assert result['actions'][1]['args']['explicit_send'] is True


def test_compose_without_message_asks_for_content(monkeypatch):
    monkeypatch.setattr(app_module, 'chat_with_kyle', lambda _prompt: 'should not be called')
    result = app_module._handle_mail_intent(
        'Write an email to person@example.com', None, None, [], {'name': 'Tester'}
    )
    assert result['mode'] == 'message_required'
    assert result['actions'] == []
    assert 'what would you like' in result['reply'].lower()


def test_compose_uses_natural_trailing_instruction(monkeypatch):
    monkeypatch.setattr(
        app_module,
        'chat_with_kyle',
        lambda prompt: '{"subject":"Happy Birthday","body":"Hi Person,\\n\\nWishing you a very happy birthday and a wonderful year ahead.\\n\\nBest,\\nTester"}',
    )
    result = app_module._handle_mail_intent(
        'Write an email to person@example.com wishing them a happy birthday',
        None,
        None,
        [],
        {'name': 'Tester'},
    )
    assert result['actions'][0]['args']['subject'] == 'Happy Birthday'
    assert 'Wishing you' in result['actions'][0]['args']['body']
    assert 'ready here' in result['reply']


def test_generated_compose_body_gets_readable_email_format(monkeypatch):
    monkeypatch.setattr(
        app_module,
        'chat_with_kyle',
        lambda _prompt: '{"subject":"Project Ready","body":"Hi, The project is ready tomorrow. Please confirm receipt. Best, Tester"}',
    )
    result = app_module._handle_mail_intent(
        'Write an email to person@example.com saying the project is ready tomorrow',
        None,
        None,
        [],
        {'name': 'Tester'},
    )
    assert result['actions'][0]['args']['body'] == (
        'Hi Person,\n\nThe project is ready tomorrow. Please confirm receipt.\n\nBest,\nTester'
    )


def test_clock_questions_use_local_deterministic_reply():
    reply = app_module._kyle_clock_reply('what time is it?')
    assert reply
    assert 'on ' in reply
    assert app_module._kyle_clock_reply('show my inbox') is None


def test_summarize_email_strips_boilerplate_and_does_not_repeat_sender(monkeypatch):
    email = {
        'id': 'msg-summary-1',
        'sender': 'Manager <boss@example.com>',
        'subject': 'Quarterly Budget Approval',
        'body': 'Dear Priyam,\n\nPlease review and approve the attached Q3 budget allocation before end of week.\n\nBest regards,\nBoss',
        'date': 'Wed, 05 Aug 2026 10:00:00 +0530',
    }
    # Test fallback when LLM is unavailable
    monkeypatch.setattr(app_module, 'chat_with_kyle', lambda _prompt: 'Gemini is temporarily unavailable')
    result = app_module._handle_mail_intent(
        'Summarize this email',
        None,
        email,
        [email],
        {'name': 'Priyam'},
    )
    assert result['mode'] == 'mail_summary'
    reply = result['reply']
    assert not reply.startswith("From boss@example.com")
    assert not reply.startswith("Summary of 'Quarterly Budget Approval'")
    assert 'Please review and approve the attached Q3 budget allocation' in reply


def test_deadline_relativity_anchors_to_sent_date():
    from services.ai_service import _deadline
    # Email sent on August 5, mentions tomorrow (August 6). Since current date is after Aug 6, it must be marked passed.
    dl = _deadline("Please submit the report by tomorrow.", base_date="2026-08-05T10:00:00")
    assert "passed" in dl
    assert dl != "tomorrow"


def test_privacy_and_terms_routes_serve_valid_pages():
    client = app_module.app.test_client()
    for route in ('/privacy', '/privacy.html', '/terms', '/terms.html'):
        res = client.get(route)
        assert res.status_code == 200, f"Route {route} failed with {res.status_code}"
    privacy_res = client.get('/privacy')
    assert 'Google API Services User Data Policy' in privacy_res.get_data(as_text=True)
    assert 'Limited Use' in privacy_res.get_data(as_text=True)
    assert 'AES-256-GCM' in privacy_res.get_data(as_text=True)

