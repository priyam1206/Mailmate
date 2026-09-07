from services.mail_sync_service import MailSyncService


def test_unchanged_gmail_does_not_enqueue_work():
    calls = []
    service = MailSyncService(
        lambda profile, force_ai=False: {'source_changed': False, 'gmail_history_id': '7'},
        lambda user_id, payload: calls.append((user_id, payload)),
        interval_seconds=30,
    )
    result = service.sync_once({'email': 'user@example.com'})
    assert result['status'] == 'unchanged'
    assert calls == []


def test_gmail_delta_enqueues_once():
    calls = []
    service = MailSyncService(
        lambda profile, force_ai=False: {'source_changed': True, 'gmail_history_id': '8', 'context_sync': {'changed_messages': 1}},
        lambda user_id, payload: calls.append((user_id, payload['gmail_history_id'])),
        interval_seconds=30,
    )
    result = service.sync_once({'email': 'user@example.com'})
    assert result['status'] == 'changed'
    assert calls == [('user@example.com', '8')]
