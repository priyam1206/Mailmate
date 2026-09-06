import os
import json
from pathlib import Path
from datetime import datetime, timezone
from email.utils import getaddresses, parseaddr

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

BASE_DIR = Path(__file__).resolve().parent.parent
CREDENTIALS_FILE = BASE_DIR / 'data' / 'google_credentials.json'
TOKEN_URI = 'https://oauth2.googleapis.com/token'

# gmail.modify includes Gmail read access and is required for moving messages to Trash.
# Existing users with an older gmail.readonly token must reconnect Google once.
SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar',
]


def _parse_expiry(value):
    if not value:
        return None
    try:
        expiry = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if expiry.tzinfo is not None:
            expiry = expiry.astimezone(timezone.utc).replace(tzinfo=None)
        return expiry
    except Exception:
        return None


def get_google_config():
    return {
        'web': {
            'client_id': os.getenv('GOOGLE_CLIENT_ID'),
            'client_secret': os.getenv('GOOGLE_CLIENT_SECRET'),
            'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
            'token_uri': TOKEN_URI,
            'redirect_uris': [os.getenv('GOOGLE_REDIRECT_URI', 'http://localhost:5000/auth/google/callback')],
        }
    }


def get_credentials():
    if not CREDENTIALS_FILE.exists():
        return None
    try:
        data = json.loads(CREDENTIALS_FILE.read_text(encoding='utf-8'))
        creds = Credentials(
            token=data.get('token'),
            refresh_token=data.get('refresh_token'),
            id_token=data.get('id_token'),
            token_uri=data.get('token_uri', TOKEN_URI),
            client_id=data.get('client_id', os.getenv('GOOGLE_CLIENT_ID')),
            client_secret=data.get('client_secret', os.getenv('GOOGLE_CLIENT_SECRET')),
            scopes=data.get('scopes') or SCOPES,
            expiry=_parse_expiry(data.get('expiry')),
        )
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            save_credentials(creds)
        return creds
    except Exception as exc:
        print('Error loading credentials:', exc)
        return None


def save_credentials(creds):
    CREDENTIALS_FILE.parent.mkdir(parents=True, exist_ok=True)
    previous = {}
    if CREDENTIALS_FILE.exists():
        try:
            previous = json.loads(CREDENTIALS_FILE.read_text(encoding='utf-8'))
        except Exception:
            previous = {}
    data = json.loads(creds.to_json())
    if not data.get('refresh_token') and previous.get('refresh_token'):
        data['refresh_token'] = previous['refresh_token']
    data.setdefault('client_id', os.getenv('GOOGLE_CLIENT_ID', ''))
    data.setdefault('client_secret', os.getenv('GOOGLE_CLIENT_SECRET', ''))
    data.setdefault('token_uri', TOKEN_URI)
    tmp = CREDENTIALS_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, indent=2), encoding='utf-8')
    tmp.replace(CREDENTIALS_FILE)


def get_auth_url():
    flow = Flow.from_client_config(get_google_config(), scopes=SCOPES)
    flow.redirect_uri = get_google_config()['web']['redirect_uris'][0]
    auth_url, state = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        include_granted_scopes='true',
    )
    return auth_url, state, getattr(flow, 'code_verifier', None)


def handle_callback(url, state=None, code_verifier=None):
    flow = Flow.from_client_config(get_google_config(), scopes=SCOPES, state=state)
    flow.redirect_uri = get_google_config()['web']['redirect_uris'][0]
    if code_verifier:
        flow.code_verifier = code_verifier
    flow.fetch_token(authorization_response=url)
    creds = flow.credentials
    save_credentials(creds)
    return creds


def _gmail_service():
    creds = get_credentials()
    if not creds:
        return None
    return build('gmail', 'v1', credentials=creds, cache_discovery=False)


def get_user_profile():
    creds = get_credentials()
    if not creds:
        return None
    service = build('oauth2', 'v2', credentials=creds, cache_discovery=False)
    user_info = service.userinfo().get().execute()
    return {
        'id': user_info.get('id'),
        'name': user_info.get('name'),
        'email': user_info.get('email'),
        'picture': user_info.get('picture'),
    }


def get_calendar_events():
    creds = get_credentials()
    if not creds:
        return []
    service = build('calendar', 'v3', credentials=creds, cache_discovery=False)
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    events_result = service.events().list(
        calendarId='primary',
        timeMin=now,
        maxResults=30,
        singleEvents=True,
        orderBy='startTime',
    ).execute()
    parsed = []
    for event in events_result.get('items', []):
        parsed.append({
            'id': event['id'],
            'title': event.get('summary', 'No Title'),
            'description': event.get('description', ''),
            'start': event['start'].get('dateTime', event['start'].get('date')),
            'end': event['end'].get('dateTime', event['end'].get('date')),
            'html_link': event.get('htmlLink'),
        })
    return parsed


def _gmail_query():
    return (os.getenv('GMAIL_QUERY') or 'newer_than:30d').strip()


def get_gmail_message_ids(limit=250):
    """Cheap current-mail inventory used to prune stale cached/deleted messages."""
    service = _gmail_service()
    if not service:
        return set()

    limit = max(1, min(int(limit or 250), 500))
    query = _gmail_query()
    ids = set()
    page_token = None
    while len(ids) < limit:
        kwargs = {
            'userId': 'me',
            'maxResults': min(100, limit - len(ids)),
            'includeSpamTrash': False,
        }
        if query:
            kwargs['q'] = query
        if page_token:
            kwargs['pageToken'] = page_token
        response = service.users().messages().list(**kwargs).execute()
        ids.update(str(item.get('id')) for item in (response.get('messages') or []) if item.get('id'))
        page_token = response.get('nextPageToken')
        if not page_token:
            break
    return ids


def trash_gmail_message(message_id):
    """Move one Gmail message to Trash. Requires gmail.modify."""
    if not message_id:
        raise ValueError('message_id is required')
    service = _gmail_service()
    if not service:
        raise RuntimeError('Google credentials are not available')
    result = service.users().messages().trash(userId='me', id=str(message_id)).execute()
    return {
        'trashed': True,
        'id': result.get('id') or str(message_id),
        'thread_id': result.get('threadId'),
        'labels': result.get('labelIds') or [],
    }


def _address_list(raw):
    return [{'name': name, 'email': email} for name, email in getaddresses([raw or '']) if email]


def _batch_fetch_threads(service, refs):
    payloads = {}
    errors = {}

    def callback(request_id, response, exception):
        if exception is not None:
            errors[str(request_id)] = exception
        elif response is not None:
            payloads[str(request_id)] = response

    try:
        batch = service.new_batch_http_request()
        for ref in refs:
            thread_id = str(ref['id'])
            request = service.users().threads().get(
                userId='me',
                id=thread_id,
                format='metadata',
                metadataHeaders=['From', 'To', 'Cc', 'Subject', 'Date'],
            )
            batch.add(request, callback=callback, request_id=thread_id)
        if refs:
            batch.execute()
        return payloads
    except Exception as exc:
        print('[Gmail] batch fetch failed; falling back to sequential metadata fetch:', exc)
        payloads = {}
        for ref in refs:
            thread_id = str(ref['id'])
            try:
                payloads[thread_id] = service.users().threads().get(
                    userId='me',
                    id=thread_id,
                    format='metadata',
                    metadataHeaders=['From', 'To', 'Cc', 'Subject', 'Date'],
                ).execute()
            except Exception as item_exc:
                print(f'[Gmail] thread {thread_id} skipped:', item_exc)
        return payloads


def get_gmail_threads():
    """
    Fetch recent Gmail context with one thread-list call plus a batched metadata fetch.
    This is much faster than issuing one full HTTP request per thread sequentially.
    """
    service = _gmail_service()
    if not service:
        return [], []

    profile = service.users().getProfile(userId='me').execute()
    my_email = str(profile.get('emailAddress') or '').strip().lower()
    limit = max(1, min(int(os.getenv('GMAIL_FETCH_LIMIT', '20') or 20), 50))
    query = _gmail_query()

    kwargs = {'userId': 'me', 'maxResults': limit, 'includeSpamTrash': False}
    if query:
        kwargs['q'] = query
    refs = service.users().threads().list(**kwargs).execute().get('threads', [])
    payloads = _batch_fetch_threads(service, refs)

    results = []
    emails = []

    for ref in refs:
        thread_id = str(ref.get('id') or '')
        t_data = payloads.get(thread_id)
        if not t_data:
            continue

        messages = []
        thread_subject = 'No Subject'
        for m in t_data.get('messages', []):
            headers = {str(h.get('name') or ''): str(h.get('value') or '') for h in (m.get('payload') or {}).get('headers', [])}
            sender_raw = headers.get('From', '')
            sender_name, sender_email = parseaddr(sender_raw)
            sender_email = sender_email.lower()
            subject = headers.get('Subject') or thread_subject
            if subject and subject != 'No Subject':
                thread_subject = subject
            date = headers.get('Date', '')
            labels = m.get('labelIds', []) or []
            is_sent_by_me = ('SENT' in labels) or (bool(my_email) and sender_email == my_email)
            direction = 'outbound' if is_sent_by_me else 'inbound'
            is_unread = 'UNREAD' in labels
            is_starred = 'STARRED' in labels
            snippet = m.get('snippet', '') or ''

            msg_data = {
                'id': m['id'],
                'gmail_id': m['id'],
                'thread_id': thread_id,
                'sender': sender_raw,
                'from': {'name': sender_name, 'email': sender_email},
                'to': _address_list(headers.get('To', '')),
                'cc': _address_list(headers.get('Cc', '')),
                'subject': subject,
                'date': date,
                'timestamp': date,
                'snippet': snippet,
                'body': snippet,
                'direction': direction,
                'is_sent_by_me': is_sent_by_me,
                'is_read': not is_unread,
                'is_starred': is_starred,
                'labels': labels,
            }
            messages.append(msg_data)
            emails.append(msg_data)

        latest_direction = messages[-1]['direction'] if messages else 'inbound'
        results.append({
            'thread_id': thread_id,
            'subject': thread_subject,
            'messages': messages,
            'latest_direction': latest_direction,
        })

    return results, emails
