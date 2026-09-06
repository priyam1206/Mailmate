import os
import google.generativeai as genai
import json
import datetime
from services.google_service import get_calendar_events, build, get_credentials

def get_dashboard_overview(threads):
    genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
    model = genai.GenerativeModel('gemini-3.5-flash-lite', generation_config={"response_mime_type": "application/json"})

    prompt = f"""Analyze the following email threads and generate an overview.
Format MUST be JSON exactly matching this:
{{
    "metrics": {{"emails": int, "important": int, "actions": int}},
    "needs_attention": [{{"description": "...", "owner": "me", "source_message_id": "...", "deadline": "..."}}],
    "waiting_on_others": [{{"description": "...", "owner": "other", "source_message_id": "..."}}],
    "ai_insight": "string"
}}
RULES:
1. Distinguish between 'needs_attention' (actions where owner='me' and unresolved) vs 'waiting_on_others' (owner='other').
2. If latest message in thread is 'outbound' and has no reply, it usually means waiting_on_others, unless a task assigned to 'me' is still incomplete.
3. Ignore promotional/reddit emails.
Threads:
{json.dumps(threads)}
"""
    try:
        res = model.generate_content(prompt)
        return json.loads(res.text)
    except Exception as e:
        print("Gemini error:", e)
        return {
            "metrics": {"emails": len(threads), "important": 0, "actions": 0},
            "needs_attention": [],
            "waiting_on_others": [],
            "ai_insight": "Error analyzing emails."
        }

def list_events():
    '''List upcoming calendar events.'''
    events = get_calendar_events()
    return f"Upcoming events: {json.dumps(events)}"

def create_event(title: str, start_time: str, end_time: str):
    '''Create a calendar event. Times must be ISO string e.g. 2026-09-07T10:00:00+05:30'''
    try:
        creds = get_credentials()
        service = build('calendar', 'v3', credentials=creds)
        event = {
            'summary': title,
            'start': {'dateTime': start_time, 'timeZone': 'Asia/Kolkata'},
            'end': {'dateTime': end_time, 'timeZone': 'Asia/Kolkata'},
        }
        event = service.events().insert(calendarId='primary', body=event).execute()
        return f"Created event: {event.get('htmlLink')}"
    except Exception as e:
        return f"Error: {str(e)}"

def chat_with_kyle(message):
    genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
    tools = [list_events, create_event]
    model = genai.GenerativeModel('gemini-3.5-flash-lite', tools=tools)

    chat = model.start_chat(enable_automatic_function_calling=True)
    try:
        res = chat.send_message(f"You are Kyle, a helpful assistant. You manage calendar and email workflows. Timezone is Asia/Kolkata. The time is {datetime.datetime.now().isoformat()}. User says: {message}")
        return res.text
    except Exception as e:
        return f"Kyle error: {str(e)}"
