import os
import json
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import datetime

SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar'
]

CREDENTIALS_FILE = 'data/google_credentials.json'

def get_google_config():
    return {
        "web": {
            "client_id": os.getenv('GOOGLE_CLIENT_ID'),
            "client_secret": os.getenv('GOOGLE_CLIENT_SECRET'),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [os.getenv('GOOGLE_REDIRECT_URI', 'http://localhost:5000/auth/google/callback')]
        }
    }

def get_credentials():
    if os.path.exists(CREDENTIALS_FILE):
        try:
            with open(CREDENTIALS_FILE, 'r') as f:
                data = json.load(f)
                creds = Credentials(
                    token=data.get('token'),
                    refresh_token=data.get('refresh_token'),
                    id_token=data.get('id_token'),
                    token_uri=data.get('token_uri', 'https://oauth2.googleapis.com/token'),
                    client_id=data.get('client_id', os.getenv('GOOGLE_CLIENT_ID')),
                    client_secret=data.get('client_secret', os.getenv('GOOGLE_CLIENT_SECRET')),
                    scopes=data.get('scopes', SCOPES)
                )
                if creds and creds.expired and creds.refresh_token:
                    try:
                        creds.refresh(Request())
                        save_credentials(creds)
                    except Exception as refresh_err:
                        print("Error refreshing token:", refresh_err)
                return creds
        except Exception as e:
            print("Error loading credentials:", e)
            return None
    return None

def save_credentials(creds):
    os.makedirs('data', exist_ok=True)
    with open(CREDENTIALS_FILE, 'w') as f:
        f.write(creds.to_json())

def get_auth_url():
    flow = Flow.from_client_config(get_google_config(), scopes=SCOPES)
    flow.redirect_uri = get_google_config()['web']['redirect_uris'][0]
    auth_url, state = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        include_granted_scopes='true'
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

def get_user_profile():
    creds = get_credentials()
    if not creds: return None
    service = build('oauth2', 'v2', credentials=creds)
    user_info = service.userinfo().get().execute()
    return {
        "name": user_info.get('name'),
        "email": user_info.get('email'),
        "picture": user_info.get('picture')
    }

def get_calendar_events():
    creds = get_credentials()
    if not creds: return []
    service = build('calendar', 'v3', credentials=creds)
    now = datetime.datetime.utcnow().isoformat() + 'Z'
    events_result = service.events().list(calendarId='primary', timeMin=now,
                                          maxResults=30, singleEvents=True,
                                          orderBy='startTime').execute()
    events = events_result.get('items', [])
    parsed = []
    for event in events:
        parsed.append({
            "id": event['id'],
            "title": event.get('summary', 'No Title'),
            "description": event.get('description', ''),
            "start": event['start'].get('dateTime', event['start'].get('date')),
            "end": event['end'].get('dateTime', event['end'].get('date')),
            "html_link": event.get('htmlLink')
        })
    return parsed

def get_gmail_threads():
    creds = get_credentials()
    if not creds: return [], []
    service = build('gmail', 'v1', credentials=creds)
    profile = get_user_profile()
    my_email = profile['email'] if profile else ''

    threads = service.users().threads().list(userId='me', maxResults=15).execute().get('threads', [])
    results = []
    emails = []
    for t in threads:
        t_data = service.users().threads().get(userId='me', id=t['id'], format='full').execute()
        messages = []
        thread_subject = "No Subject"
        for m in t_data.get('messages', []):
            headers = {h['name']: h['value'] for h in m['payload'].get('headers', [])}
            sender = headers.get('From', '')
            subject = headers.get('Subject', thread_subject)
            if subject and subject != "No Subject":
                thread_subject = subject
            date = headers.get('Date', '')
            direction = "outbound" if (my_email in sender or "SENT" in m.get('labelIds', [])) else "inbound"
            is_unread = "UNREAD" in m.get('labelIds', [])
            is_starred = "STARRED" in m.get('labelIds', [])
            snippet = m.get('snippet', '')

            msg_data = {
                "id": m['id'],
                "gmail_id": m['id'],
                "thread_id": t['id'],
                "sender": sender,
                "from": sender,
                "subject": subject,
                "date": date,
                "timestamp": date,
                "snippet": snippet,
                "body": snippet,
                "direction": direction,
                "is_read": not is_unread,
                "is_starred": is_starred,
                "labels": m.get('labelIds', [])
            }
            messages.append(msg_data)
            emails.append(msg_data)

        latest_direction = messages[-1]['direction'] if messages else "inbound"
        results.append({
            "thread_id": t['id'],
            "subject": thread_subject,
            "messages": messages,
            "latest_direction": latest_direction
        })
    return results, emails
