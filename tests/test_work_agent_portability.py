import threading
from copy import deepcopy

import services.work_agent_service as work_module
from services.work_agent_service import WorkAgentService


def test_hydrated_work_job_restores_gmail_action_metadata(monkeypatch):
    state = {
        'work-1': {
            'id': 'work-1',
            'user_id': 'user@example.com',
            'status': 'waiting_approval',
            'source': {'message_id': 'm-1', 'thread_id': 't-1'},
            'output': {'suggested_reply': 'Thanks.'},
        }
    }
    service = WorkAgentService.__new__(WorkAgentService)
    service._lock = threading.RLock()
    service._read_jobs = lambda: deepcopy(state)

    def write_jobs(jobs):
        state.clear()
        state.update(deepcopy(jobs))

    service._write_jobs = write_jobs
    monkeypatch.setattr(work_module, 'get_gmail_message', lambda message_id: {
        'id': message_id,
        'thread_id': 't-1',
        'sender': 'Teacher <teacher@example.edu>',
        'subject': 'Assignment update',
        'rfc_message_id': '<source@example.edu>',
        'labels': ['INBOX'],
        'body': 'This raw body must remain transient.',
    })

    job = service._ensure_source_metadata('work-1', 'user@example.com', state['work-1'])

    assert job['source']['sender'] == 'Teacher <teacher@example.edu>'
    assert job['source']['subject'] == 'Assignment update'
    assert job['source']['direction'] == 'inbound'
    assert 'body' not in job['source']
    assert 'body' not in state['work-1']['source']


def test_resolved_source_ids_only_include_verified_resolution_states():
    service = WorkAgentService.__new__(WorkAgentService)
    service.list_jobs = lambda user_id, reconcile=False: [
        {'status': 'resolved_external', 'source': {'message_id': 'replied'}},
        {'status': 'sent', 'source': {'message_id': 'sent'}},
        {'status': 'waiting_approval', 'source': {'message_id': 'pending'}},
        {'status': 'failed', 'source': {'message_id': 'failed'}},
    ]
    assert service.resolved_source_message_ids('user@example.com') == {'replied', 'sent'}
