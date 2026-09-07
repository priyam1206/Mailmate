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
