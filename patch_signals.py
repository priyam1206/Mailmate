path = 'services/mail_context_service.py'
content = open(path, encoding='utf-8').read()

patches = [
    (
        "    action_signal = _contains(r'\\\\b(action required|please|can you|could you|reply|respond|review|approve|submit|submission|assignment|send|provide|meeting|schedule)\\\\b', text)",
        "    action_signal = _contains(r'\\\\b(action required|please|can you|could you|reply|respond|review|approve|submit|submission|assignment|send|provide|meeting|schedule|note that|please note|inform you)\\\\b', text)"
    ),
    (
        "    deadline_signal = _contains(r'\\\\b(due|deadline|today|tonight|tomorrow|within \\\\d+ (?:hours?|days?))\\\\b', text)",
        "    deadline_signal = _contains(r'\\\\b(due|deadline|today|tonight|tomorrow|within \\\\d+ (?:hours?|days?)|next month|october|november|december|exam date|take place|scheduled for)\\\\b', text)"
    ),
    (
        "    work_signal = _contains(r'\\\\b(assignment|submission|deliverable|project|report|document|spreadsheet|presentation|proposal|code|repository)\\\\b', text)",
        "    work_signal = _contains(r'\\\\b(assignment|submission|deliverable|project|report|document|spreadsheet|presentation|proposal|code|repository|exam|lab exam|quiz|marks|grade|test)\\\\b', text)"
    ),
    (
        "    calendar_signal = _contains(r'\\\\b(meeting|appointment|call|schedule|calendar|due|deadline)\\\\b', text)",
        "    calendar_signal = _contains(r'\\\\b(meeting|appointment|call|schedule|calendar|due|deadline|exam|scheduled|take place)\\\\b', text)"
    ),
]

for old, new in patches:
    if old in content:
        content = content.replace(old, new, 1)
        print('patched:', old[:50])
    else:
        print('NOT FOUND:', old[:50])

open(path, 'w', encoding='utf-8').write(content)
print('done')
