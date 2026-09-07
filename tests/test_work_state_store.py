from services.work_state_store import WorkStateStore


def _configure(monkeypatch):
    monkeypatch.setenv('SUPABASE_CONTEXT_ENABLED', '1')
    monkeypatch.setenv('SUPABASE_URL', 'https://example.supabase.co')
    monkeypatch.setenv('SUPABASE_SECRET_KEY', 'server-secret')
    monkeypatch.setenv('MAILMATE_USER_NAMESPACE_UUID', '12345678-1234-4234-8234-123456789abc')


def _job(status='waiting_approval'):
    return {
        'id': 'work-1', 'user_id': 'user@example.com', 'clean_title': 'Reply to teacher',
        'status': status, 'current_step': 'Review draft',
        'source': {
            'message_id': 'm-1', 'thread_id': 't-1', 'subject': 'Private source subject',
            'snippet': 'Never persist this raw snippet', 'body': 'Never persist this body',
        },
        'output': {'summary': 'Reply is ready.', 'suggested_reply': 'Thanks, I will send it.', 'gmail_draft_id': 'draft-1'},
        'artifacts': [{'filename': 'plan.md', 'type': 'markdown', 'path': 'workspaces/work-1/plan.md', 'content': 'secret'}],
    }


def test_active_work_is_minimized_and_terminal_work_is_deleted(monkeypatch):
    _configure(monkeypatch)
    store = WorkStateStore()
    calls = []
    monkeypatch.setattr(store, '_request', lambda method, table, **kwargs: calls.append((method, table, kwargs)))
    store.write_all({'work-1': _job()})
    upsert = next(call for call in calls if call[0] == 'POST')
    payload = upsert[2]['json'][0]
    packed = str(payload)
    assert 'Never persist' not in packed
    assert 'content' not in payload['artifact_metadata'][0]
    calls.clear()
    store.write_all({'work-1': _job('completed')})
    assert any(method == 'DELETE' and table == 'active_work_state' for method, table, _ in calls)
