import importlib
import os

import pytest

from services.agent.models.lmstudio import LMStudioModel, ModelContextOverflow
from services.agent.session import AgentSession
from services.work_agent_service import WorkAgentService
from services.agent.token_budget import approximate_tokens, bound_messages
from services import ai_service


def test_prompt_budget_truncates_before_generation():
    messages = [
        {'role': 'system', 'content': 'rules ' * 1000},
        {'role': 'user', 'content': 'mail ' * 5000},
    ]
    bounded = bound_messages(messages, max_input_tokens=600)
    assert sum(approximate_tokens(item['content']) for item in bounded) <= 600
    assert 'truncated' in bounded[1]['content']


def test_host_never_routes_back_to_tailscale(monkeypatch):
    monkeypatch.setenv('MAILMATE_WORKER_HOST', '0.0.0.0')
    monkeypatch.setenv('MAILMATE_REMOTE_WORKER_URL', 'http://100.114.2.88:5000/api/compute')
    routes = LMStudioModel()._routes()
    assert [route[0] for route in routes] == ['local_lm_studio']


def test_client_uses_remote_work_compute_only(monkeypatch):
    monkeypatch.delenv('MAILMATE_WORKER_HOST', raising=False)
    monkeypatch.delenv('MAILMATE_CLIENT_LOCAL_LM', raising=False)
    monkeypatch.setenv('MAILMATE_REMOTE_WORKER_URL', 'http://100.114.2.88:5000/api/compute')
    routes = LMStudioModel()._routes()
    assert [route[0] for route in routes] == ['remote_local_worker']


def test_context_overflow_is_not_retried(monkeypatch):
    monkeypatch.setenv('MAILMATE_WORKER_HOST', '1')
    calls = []

    class Response:
        ok = False
        status_code = 400
        text = 'Context size has been exceeded'

    monkeypatch.setattr('services.agent.models.lmstudio.requests.post', lambda *args, **kwargs: calls.append(kwargs) or Response())
    with pytest.raises(ModelContextOverflow):
        LMStudioModel()._request_completion({
            'messages': [{'role': 'user', 'content': 'hello'}],
        })
    assert len(calls) == 1


def test_work_request_disables_thinking_and_is_bounded(monkeypatch):
    monkeypatch.setenv('MAILMATE_WORKER_HOST', '1')
    captured = {}

    class Response:
        ok = True
        status_code = 200

        @staticmethod
        def json():
            return {'choices': [{'message': {'content': '{"ok":true}'}, 'finish_reason': 'stop'}]}

    def post(*args, **kwargs):
        captured.update(kwargs['json'])
        return Response()

    monkeypatch.setattr('services.agent.models.lmstudio.requests.post', post)
    LMStudioModel()._request_completion({
        'messages': [{'role': 'user', 'content': 'oversized ' * 6000}],
    }, request_kind='work', max_input_tokens=600)
    assert captured['chat_template_kwargs']['enable_thinking'] is False
    assert sum(approximate_tokens(item['content']) for item in captured['messages']) <= 600


def test_overview_is_deterministic_and_single_flight_cached(monkeypatch):
    ai_service._overview_cache.clear()
    ai_service._overview_inflight.clear()
    monkeypatch.setattr(ai_service.PrivacyGate, 'filter_threads_for_ai', lambda threads: threads)
    prompts = []

    def gemini(prompt, **kwargs):
        prompts.append(prompt)
        return '{"metrics":{},"needs_attention":[],"waiting_on_others":[],"ai_insight":"Clear"}'

    monkeypatch.setattr(ai_service, '_gemini_completion', gemini)
    threads = [{
        'id': 'thread-1',
        'messages': [{
            'id': 'message-1',
            'subject': 'Action required tomorrow',
            'sender': 'Teammate <team@example.com>',
            'snippet': 'Please review the portal. ' + ('private body ' * 1000),
            'direction': 'inbound',
            'timestamp': '2026-09-07T10:00:00Z',
        }],
    }]
    first = ai_service.get_dashboard_overview(threads)
    second = ai_service.get_dashboard_overview(threads)
    assert first == second
    assert prompts == []
    assert first['ai_insight'] == '1 message needs your attention.'
    assert first['needs_attention'][0]['description'] == 'Review this request.'


def test_overview_preserves_exact_day_first_deadline_from_context(monkeypatch):
    ai_service._overview_cache.clear()
    monkeypatch.setattr(ai_service.PrivacyGate, 'filter_threads_for_ai', lambda threads: threads)
    threads = [{'id': 'thread-deadline', 'messages': [{
        'id': 'message-deadline', 'subject': 'Confirm participation',
        'snippet': 'Please confirm attendance before 9 September 2026 at 3:00 PM.',
        'direction': 'inbound',
        'context_scores': {'attention_allowed': True, 'deadline_at': '2026-09-09T15:00:00+05:30'},
    }]}]
    result = ai_service.get_dashboard_overview(threads)
    assert result['needs_attention'][0]['deadline'] == '2026-09-09T15:00:00+05:30'


def test_calendar_deadline_parser_preserves_times_and_uses_end_of_day():
    timed, has_time = mailmate_app._deadline_target({'deadline': '2026-09-09T15:00:00+05:30'})
    date_only, date_has_time = mailmate_app._deadline_target({'deadline': '2026-09-10'})
    assert has_time is True
    assert (timed.hour, timed.minute) == (15, 0)
    assert date_has_time is False
    assert (date_only.hour, date_only.minute) == (23, 59)


def test_common_work_uses_one_structured_plan(monkeypatch):
    calls = []
    monkeypatch.setattr(LMStudioModel, 'work_plan', lambda self, source: calls.append(source) or {
        'summary': 'Reply prepared.',
        'checklist': ['Confirm the deadline', 'Reply to the sender'],
        'reply': {'subject': 'Re: Deadline', 'body': 'Hi,\n\nI will complete this tomorrow.\n\nBest,\nPriyam'},
        'artifacts': [],
    })
    service = WorkAgentService.__new__(WorkAgentService)
    service.timeout = 20
    monkeypatch.setattr(service, '_set_job_activity', lambda *args: None)
    session = AgentSession(
        job_id='work_test',
        user_id='user@example.com',
        goal='Prepare reply',
        source_email={},
        routing='LOCAL_ONLY',
    )
    result = service._run_fast_work_path(session, {
        'subject': 'Deadline tomorrow',
        'sender': 'Teacher <teacher@example.com>',
        'snippet': 'Please submit tomorrow.',
    })
    assert len(calls) == 1
    assert result.status == 'finished'
    assert result.reply_draft['body']
    assert result.checklist == ['Confirm the deadline', 'Reply to the sender']


os.environ.setdefault('MAILMATE_DISABLE_WHISPER_INIT', '1')
mailmate_app = importlib.import_module('app')


def test_explicit_email_address_is_preserved(monkeypatch):
    monkeypatch.setattr(mailmate_app, 'chat_with_kyle', lambda prompt: '{"subject":"Portal deadline","body":"Hi,\\n\\nThe deadline is tomorrow.\\n\\nBest,\\nPriyam"}')
    result = mailmate_app._handle_mail_intent(
        'send an email to sreyankosinha@gmail.com about the portal deadline tomorrow',
        None,
        None,
        [],
        {'name': 'Priyam'},
    )
    assert result['actions'][0]['args']['to'] == 'sreyankosinha@gmail.com'


def test_compose_replaces_signoff_only_model_output(monkeypatch):
    monkeypatch.setattr(mailmate_app, 'chat_with_kyle', lambda _prompt: '{"subject":"Confirmation","body":"Best Regards,\\nPriyam"}')
    result = mailmate_app._handle_mail_intent(
        'send an email to attendee@example.com saying I confirm my attendance',
        None, None, [], {'name': 'Priyam'},
    )
    body = result['actions'][0]['args']['body']
    assert 'confirm my attendance' in body.lower()
    assert len(body) > len('Best Regards, Priyam')


def test_mail_send_operation_is_idempotent(monkeypatch):
    calls = []
    monkeypatch.setattr(mailmate_app, 'get_user_profile', lambda: {'email': 'user@example.com'})
    monkeypatch.setattr(mailmate_app, 'send_gmail_direct', lambda **kwargs: calls.append(kwargs) or {'id': 'sent-1'})
    mailmate_app._mail_send_operations.clear()
    client = mailmate_app.app.test_client()
    payload = {
        'operation_id': 'operation_12345',
        'to': 'person@example.com',
        'subject': 'Hello',
        'body': 'One message only.',
    }
    first = client.post('/api/mail/send', json=payload)
    second = client.post('/api/mail/send', json=payload)
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.get_json()['idempotent_replay'] is True
    assert len(calls) == 1


def test_mail_send_rejects_invalid_recipient(monkeypatch):
    monkeypatch.setattr(mailmate_app, 'get_user_profile', lambda: {'email': 'user@example.com'})
    client = mailmate_app.app.test_client()
    response = client.post('/api/mail/send', json={
        'operation_id': 'operation_67890',
        'to': 'Sreyanko',
        'subject': 'Hello',
        'body': 'Message',
    })
    assert response.status_code == 400
    assert response.get_json()['code'] == 'invalid_recipient'


def test_mailbox_snapshot_reuses_unchanged_history(monkeypatch):
    mailmate_app._mailbox_snapshots.clear()
    calls = {'threads': 0}
    monkeypatch.setattr(mailmate_app, 'get_gmail_history_id', lambda: 'history-7')

    def fetch_threads():
        calls['threads'] += 1
        email = {'id': 'm-1', 'thread_id': 't-1'}
        return [{'thread_id': 't-1', 'messages': [email]}], [email]

    monkeypatch.setattr(mailmate_app, 'get_gmail_threads', fetch_threads)
    profile = {'id': 'google-user-1'}
    first = mailmate_app._mailbox_snapshot(profile)
    second = mailmate_app._mailbox_snapshot(profile)
    assert calls['threads'] == 1
    assert first[2:4] == (False, True)
    assert second[2:4] == (True, False)


def test_manual_dashboard_refresh_reconciles_without_enqueuing_work(monkeypatch):
    calls = {'reconcile': 0, 'enqueue': 0}
    monkeypatch.setattr(mailmate_app, 'get_user_profile', lambda: {'email': 'user@example.com'})
    monkeypatch.setattr(mailmate_app, '_build_live_dashboard', lambda profile, force_ai=False: {
        'emails': [], 'needs_attention': [], 'metrics': {}, 'user': profile,
    })
    monkeypatch.setattr(mailmate_app.work_agent_service, 'reconcile_jobs_with_gmail', lambda user_id: calls.__setitem__('reconcile', calls['reconcile'] + 1))
    monkeypatch.setattr(mailmate_app.work_agent_service, 'sync_and_enqueue', lambda *args: calls.__setitem__('enqueue', calls['enqueue'] + 1))
    response = mailmate_app.app.test_client().get('/api/dashboard/overview?refresh=true')
    assert response.status_code == 200
    assert calls == {'reconcile': 1, 'enqueue': 0}
