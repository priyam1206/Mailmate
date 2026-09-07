from services import calendar_service


class _Request:
    def __init__(self, value):
        self.value = value

    def execute(self):
        return self.value


class _Events:
    def __init__(self, existing):
        self.existing = existing
        self.updated = None
        self.patched = None

    def get(self, **_kwargs):
        return _Request(self.existing)

    def update(self, **kwargs):
        self.updated = kwargs
        return _Request({**self.existing, **kwargs['body']})

    def patch(self, **kwargs):
        self.patched = kwargs
        return _Request({**self.existing, **kwargs['body']})


class _Service:
    def __init__(self, events):
        self._events = events

    def events(self):
        return self._events


def test_all_day_to_timed_update_does_not_retain_date_fields(monkeypatch):
    events = _Events({
        'id': 'event-1',
        'summary': 'Deadline',
        'start': {'date': '2026-09-08'},
        'end': {'date': '2026-09-09'},
    })
    monkeypatch.setattr(calendar_service, '_require_write_scope', lambda: None)
    monkeypatch.setattr(calendar_service, '_service', lambda: _Service(events))

    calendar_service.update_event('event-1', {
        'start': '2026-09-08T14:30:00+05:30',
        'end': '2026-09-08T15:00:00+05:30',
        'all_day': False,
    })

    assert events.patched is None
    assert events.updated['body']['start'] == {
        'dateTime': '2026-09-08T14:30:00+05:30',
        'timeZone': 'Asia/Kolkata',
    }
    assert 'date' not in events.updated['body']['start']


def test_timed_edit_still_uses_patch(monkeypatch):
    events = _Events({
        'id': 'event-2',
        'summary': 'Meeting',
        'start': {'dateTime': '2026-09-08T10:00:00+05:30'},
        'end': {'dateTime': '2026-09-08T11:00:00+05:30'},
    })
    monkeypatch.setattr(calendar_service, '_require_write_scope', lambda: None)
    monkeypatch.setattr(calendar_service, '_service', lambda: _Service(events))

    calendar_service.update_event('event-2', {'title': 'Updated meeting'})

    assert events.updated is None
    assert events.patched['body'] == {'summary': 'Updated meeting'}
