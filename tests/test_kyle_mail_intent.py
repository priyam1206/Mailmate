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
