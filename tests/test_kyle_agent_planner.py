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
