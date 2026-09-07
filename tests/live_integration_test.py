import requests, json, uuid, time, sys

BASE = 'http://127.0.0.1:5000'

def main():
    s = requests.Session()
    s.headers['Content-Type'] = 'application/json'
    results = []

    def check(name, ok, detail=''):
        tag = 'PASS' if ok else 'FAIL'
        print(f'[{tag}] {name}' + (f'  ({detail})' if detail else ''))
        results.append((name, ok))
        return ok

    print('=' * 60)
    print('Kyle Live Integration Test Suite')
    print('=' * 60)

    # 1. Auth / profile
    r = s.get(f'{BASE}/api/user/profile')
    profile = r.json() if r.ok else {}
    check('GET /api/user/profile', r.status_code == 200)
    check('Profile has email', bool(profile.get('email')))
    user_email = profile.get('email', 'fallback@test.com')
    print(f'     Signed in as: {user_email}')

    # 2. Dashboard overview
    print()
    print('-- Overview --')
    r = s.get(f'{BASE}/api/dashboard/overview')
    check('GET /api/dashboard/overview', r.status_code == 200)
    ov = r.json() if r.ok else {}
    emails = ov.get('emails', [])
    needs  = ov.get('needs_attention', [])
    check('Overview.emails is list', isinstance(emails, list))
    check('Overview.needs_attention is list', isinstance(needs, list))
    print(f'     Inbox: {len(emails)} emails | Needs attention: {len(needs)}')

    # 3. Kyle agent prompts
    print()
    print('-- Kyle Chat Prompts --')
    prompts = [
        'Summarize my most recent emails',
        'What should I handle first today?',
        'Are there any urgent deadlines?',
        'What is my latest email about?',
    ]
    ctx = {
        'emails': emails[:4],
        'needs_attention': needs[:3],
    }
    for prompt in prompts:
        r = s.post(f'{BASE}/api/kyle/agent', json={
            'message': prompt,
            'conversation': [],
            'context': ctx,
        })
        body = {}
        try: body = r.json()
        except: pass
        reply = body.get('reply') or body.get('text') or body.get('message') or ''
        ok = r.status_code == 200 and bool(reply)
        check(f'Prompt: "{prompt[:45]}"', ok, f'reply={len(reply)}chars')
        if reply:
            snippet = reply[:110].replace('\n', ' ')
            print(f'     Kyle: {snippet}...' if len(reply) > 110 else f'     Kyle: {snippet}')
        time.sleep(0.6)

    # 4. Work jobs
    print()
    print('-- Work Jobs --')
    r = s.get(f'{BASE}/api/work/jobs')
    check('GET /api/work/jobs', r.status_code == 200)
    jobs = r.json() if r.ok else []
    check('Work jobs list', isinstance(jobs, list))
    terminal = {'sent','resolved_external','cancelled','failed','ignored_outbound','approved_sent'}
    active = [j for j in jobs if j.get('status') not in terminal]
    print(f'     Total: {len(jobs)} | Active/pending: {len(active)}')
    for j in jobs[:3]:
        print(f'     - [{j.get("status")}] {j.get("title","?")}')

    # 5. Send self-test email
    print()
    print('-- Mail Send --')
    op_id = str(uuid.uuid4())
    payload = {
        'operation_id': op_id,
        'to': user_email,
        'subject': '[Kyle Test] Automated self-test ' + op_id[:8],
        'body': 'Automated integration test email from Kyle test suite. Safe to delete.',
        'thread_id': None,
        'in_reply_to': None,
    }
    r = s.post(f'{BASE}/api/mail/send', json=payload)
    body = {}
    try: body = r.json()
    except: pass
    sent_ok = r.status_code == 200 and body.get('ok')
    check('POST /api/mail/send (self-mail)', sent_ok, f'status={r.status_code} msgid={str(body.get("message_id",""))[:14]}')

    # 5b. Idempotency
    r2 = s.post(f'{BASE}/api/mail/send', json=payload)
    b2 = {}
    try: b2 = r2.json()
    except: pass
    idempotent = r2.status_code in (200, 409)
    check('Idempotent resend (same op_id)', idempotent, f'status={r2.status_code}')

    # 5c. Reject missing operation_id
    bad = {k: v for k, v in payload.items() if k != 'operation_id'}
    r3 = s.post(f'{BASE}/api/mail/send', json=bad)
    check('Reject missing operation_id (400)', r3.status_code == 400, f'got {r3.status_code}')

    # 5d. Reject bad recipient
    r4 = s.post(f'{BASE}/api/mail/send', json={**payload, 'operation_id': str(uuid.uuid4()), 'to': 'not-valid'})
    b4 = {}
    try: b4 = r4.json()
    except: pass
    check('Reject invalid recipient', r4.status_code in (400,422) or b4.get('code') in ('invalid_recipient','bad_request'), f'status={r4.status_code}')

    # 5e. Reject empty body
    r5 = s.post(f'{BASE}/api/mail/send', json={**payload, 'operation_id': str(uuid.uuid4()), 'body': ''})
    b5 = {}
    try: b5 = r5.json()
    except: pass
    check('Reject empty body', r5.status_code in (400,422) or not b5.get('ok'), f'status={r5.status_code}')

    # Summary
    print()
    print('=' * 60)
    total  = len(results)
    passed = sum(1 for _, ok in results if ok)
    failed = total - passed
    status = 'ALL GREEN' if failed == 0 else f'{failed} FAILED'
    print(f'Results: {passed}/{total} passed -- {status}')
    return 0 if failed == 0 else 1

if __name__ == '__main__':
    raise SystemExit(main())
