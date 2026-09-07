import json

from services import kyle_agent_planner


def test_selected_email_content_is_transiently_available_to_planner(monkeypatch):
    seen = {}

    def fake_completion(prompt, **kwargs):
        seen['prompt'] = prompt
        return json.dumps({
            'reply': 'The exam moved to October 7. No reply is needed.',
            'voice': 'The exam moved to October 7. No reply is needed.',
            'intent': 'summarize_email', 'actions': [],
        })

    monkeypatch.setattr(kyle_agent_planner, '_gemini_completion', fake_completion)
    result = kyle_agent_planner.plan_kyle_turn(
        'Summarize this email', {}, {'id': 'message-1'},
        lambda message_id: {
            'id': message_id, 'subject': 'Lab exam', 'sender': 'Teacher <teacher@example.edu>',
            'body': 'The exam moved to October 7.', 'privacy_gate': {'routing': 'CLOUD_ALLOWED'},
        },
    )
    assert 'The exam moved to October 7.' in seen['prompt']
    assert result['intent'] == 'summarize_email'


def test_explicit_send_evidence_is_attached_by_server(monkeypatch):
    monkeypatch.setattr(kyle_agent_planner, '_gemini_completion', lambda *args, **kwargs: json.dumps({
        'reply': 'Sending it now.', 'intent': 'send_email',
        'actions': [
            {'tool': 'mail.compose', 'args': {'to': 'person@example.com', 'subject': 'Hi', 'body': 'Hello'}},
            {'tool': 'mail.send_draft', 'args': {}},
        ],
    }))
    result = kyle_agent_planner.plan_kyle_turn('Send an email to person@example.com saying hello', {})
    assert result['actions'][-1] == {
        'tool': 'mail.send_draft', 'args': {'explicit_send': True}, 'reason': '',
    }


def test_model_cannot_invent_unregistered_tool(monkeypatch):
    monkeypatch.setattr(kyle_agent_planner, '_gemini_completion', lambda *args, **kwargs: json.dumps({
        'reply': 'No.', 'actions': [{'tool': 'javascript.eval', 'args': {'code': 'steal()'}}],
    }))
    assert kyle_agent_planner.plan_kyle_turn('Do anything', {})['actions'] == []


def test_explicit_recipient_does_not_fetch_stale_selected_email(monkeypatch):
    fetched = []
    monkeypatch.setattr(kyle_agent_planner, '_gemini_completion', lambda prompt, **kwargs: json.dumps({
        'reply': 'Ready.', 'actions': [],
    }))
    kyle_agent_planner.plan_kyle_turn(
        'Send an email to person@example.com saying hello',
        {'conversation': [{'role': 'user', 'text': 'Earlier context'}]},
        {'id': 'stale-message'},
        lambda message_id: fetched.append(message_id) or {},
    )
    assert fetched == []


def test_planner_context_is_compact_and_contains_recent_conversation(monkeypatch):
    seen = {}
    def fake_completion(prompt, **kwargs):
        seen['prompt'] = prompt
        return json.dumps({'reply': 'Ready.', 'actions': []})
    monkeypatch.setattr(kyle_agent_planner, '_gemini_completion', fake_completion)
    result = kyle_agent_planner.plan_kyle_turn(
        'What should I do next?',
        {
            'emails': [{'id': str(i), 'subject': 'S' * 900, 'body': 'private'} for i in range(30)],
            'conversation': [{'role': 'user', 'text': f'turn {i}'} for i in range(20)],
        },
    )
    payload = seen['prompt']
    assert 'turn 19' in payload and 'turn 0' not in payload
    assert 'private' not in payload
    assert len(payload) < 12000
    assert result['actions'] == []
