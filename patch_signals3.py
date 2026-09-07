path = 'services/mail_context_service.py'
lines = open(path, encoding='utf-8').readlines()

ACT = "    action_signal = _contains(r'\\b(action required|please|can you|could you|reply|respond|review|approve|submit|submission|assignment|send|provide|meeting|schedule|note that|inform you|writing to inform)\\b', text)\n"
DDL = "    deadline_signal = _contains(r'\\b(due|deadline|today|tonight|tomorrow|within \\d+ (?:hours?|days?)|next month|take place|scheduled for|will be held)\\b', text)\n"
WRK = "    work_signal = _contains(r'\\b(assignment|submission|deliverable|project|report|document|spreadsheet|presentation|proposal|code|repository|exam|lab exam|quiz|marks|grade|test)\\b', text)\n"
CAL = "    calendar_signal = _contains(r'\\b(meeting|appointment|call|schedule|calendar|due|deadline|exam|scheduled|take place|will be held)\\b', text)\n"

lines[52] = ACT
lines[53] = DDL
lines[54] = WRK
lines[55] = CAL

open(path, 'w', encoding='utf-8').writelines(lines)
print('patched')
for i in range(52, 56):
    print(i+1, repr(lines[i][:90]))
