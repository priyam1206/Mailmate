import os
import json
from urllib.parse import urlencode, urlparse
from pathlib import Path
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import re
import threading
import time
import hashlib
from dateutil import parser as date_parser

from flask import Flask, request, jsonify, redirect, send_from_directory, session, abort
from flask_cors import CORS
from dotenv import load_dotenv

# Resolve everything relative to app.py, not the shell/Antigravity working directory.
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Load environment before importing services; service modules may read env at import time.
load_dotenv(BASE_DIR / 'api.env')

# Localhost-only OAuth development flags. Keep these before google-auth-oauthlib is used.
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'

from services.whisper_service import whisper_service
from services.google_service import get_auth_url, handle_callback, get_user_profile, get_gmail_threads
from services.calendar_service import list_events as calendar_list_events, create_event as calendar_create_event, update_event as calendar_update_event, delete_event as calendar_delete_event, find_event as calendar_find_event, access_status as calendar_access_status, upsert_ai_deadline_event as calendar_upsert_ai_deadline
from services.ai_service import get_dashboard_overview, chat_with_kyle
from services.supabase_cache_service import supabase_cache

app = Flask(__name__, static_folder=None)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'default-dev-secret-key-123')
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax'
)
CORS(app)

APP_TIMEZONE = os.getenv('APP_TIMEZONE', 'Asia/Kolkata')

def _load_app_timezone():
    try:
        return ZoneInfo(APP_TIMEZONE)
    except Exception as exc:
        if APP_TIMEZONE in {'Asia/Kolkata', 'Asia/Calcutta'}:
            print(f"[Calendar] timezone database unavailable ({exc}); using fixed IST UTC+05:30")
            return timezone(timedelta(hours=5, minutes=30), name='IST')
        return timezone.utc

APP_TZ = _load_app_timezone()
CACHE_SYNC_SECONDS = max(60, int(os.getenv('CACHE_SYNC_SECONDS', '300')))
CACHE_REPROCESS_SECONDS = max(CACHE_SYNC_SECONDS, int(os.getenv('CACHE_REPROCESS_SECONDS', '1800')))
_refresh_lock = threading.Lock()
_refreshing_users = set()
AI_CALENDAR_SYNC_SECONDS = max(30, int(os.getenv('AI_CALENDAR_SYNC_SECONDS', '180')))
_ai_calendar_last_sync = {}

# Initialize Whisper in background
whisper_service.initialize()

@app.route('/')
def index():
    return send_from_directory(str(BASE_DIR), 'index.html')


@app.route('/dashboard.html')
def dashboard_page():
    return send_from_directory(str(BASE_DIR), 'dashboard.html')


@app.route('/assets/<path:filename>')
def serve_assets(filename):
    assets_dir = BASE_DIR / 'assets'
    if not (assets_dir / filename).is_file():
        abort(404)
    return send_from_directory(str(assets_dir), filename)


@app.route('/<path:filename>')
def serve_project_file(filename):
    # Serve real project files only. Never return index.html for missing
    # CSS/JS/image requests, because the browser will reject the wrong MIME type.
    candidate = (BASE_DIR / filename).resolve()
    try:
        candidate.relative_to(BASE_DIR)
    except ValueError:
        abort(404)

    if candidate.is_file():
        return send_from_directory(str(BASE_DIR), filename)

    abort(404)

@app.route('/api/health')
def health():
    return jsonify({
        "ok": True,
        "googleClientConfigured": bool(os.getenv('GOOGLE_CLIENT_ID')),
        "geminiConfigured": bool(os.getenv('GEMINI_API_KEY')),
        "supabaseConfigured": supabase_cache.configured,
        "supabase": supabase_cache.status(),
        "cachePolicy": {"syncCheckSeconds": CACHE_SYNC_SECONDS, "reprocessSeconds": CACHE_REPROCESS_SECONDS},
        "elevenLabsConfigured": bool(os.getenv('ELEVENLABS_API_KEY')),
        "calendar": calendar_access_status(),
        "calendarReadWrite": calendar_access_status().get("writable", False),
        "appTimezone": APP_TIMEZONE,
        "whisper": whisper_service.get_status(),
        "staticFiles": {
            "index.html": (BASE_DIR / "index.html").is_file(),
            "styles.css": (BASE_DIR / "styles.css").is_file(),
            "script.js": (BASE_DIR / "script.js").is_file(),
            "dashboard.html": (BASE_DIR / "dashboard.html").is_file(),
            "dashboard.css": (BASE_DIR / "dashboard.css").is_file(),
            "dashboard.js": (BASE_DIR / "dashboard.js").is_file(),
            "cs_logo.png": (BASE_DIR / "assets" / "images" / "cs_logo.png").is_file(),
            "logo.svg": (BASE_DIR / "assets" / "images" / "logo.svg").is_file()
        },
        "projectRoot": str(BASE_DIR),
        "message": "Flask Backend Running!"
    })

@app.route('/api/config')
def config():
    return jsonify({
        "googleClientId": os.getenv('GOOGLE_CLIENT_ID', ''),
        "backendAuthUrl": "/auth/google"
    })

def _oauth_origin():
    redirect_uri = os.getenv('GOOGLE_REDIRECT_URI', 'http://localhost:5000/auth/google/callback')
    parsed = urlparse(redirect_uri)
    return f"{parsed.scheme or 'http'}://{parsed.netloc or 'localhost:5000'}"


@app.before_request
def keep_oauth_on_one_host():
    # Flask session cookies are host-scoped. If auth starts on 127.0.0.1 but
    # Google redirects to localhost, OAuth state / PKCE verifier are lost.
    if request.path.startswith('/auth/google'):
        target_origin = _oauth_origin()
        target = urlparse(target_origin)
        if target.netloc and request.host != target.netloc:
            query = f"?{request.query_string.decode()}" if request.query_string else ''
            return redirect(f"{target_origin}{request.path}{query}")


@app.route('/auth/google')
def auth_google():
    auth_url, state, code_verifier = get_auth_url()
    session['oauth_state'] = state
    if code_verifier:
        session['code_verifier'] = code_verifier
    return redirect(auth_url)

@app.route('/auth/google/callback')
def auth_google_callback():
    state = session.get('oauth_state')
    code_verifier = session.get('code_verifier')

    if not state:
        return (
            'OAuth session state is missing. Open http://localhost:5000 and sign in again.',
            400,
        )

    try:
        handle_callback(request.url, state=state, code_verifier=code_verifier)
        profile = get_user_profile() or {}
    except Exception as exc:
        app.logger.exception('Google OAuth callback failed')
        return jsonify({
            'error': 'Google OAuth callback failed',
            'detail': str(exc),
            'hasState': bool(state),
            'hasCodeVerifier': bool(code_verifier),
            'callbackHost': request.host,
            'expectedOrigin': _oauth_origin(),
        }), 500
    finally:
        session.pop('oauth_state', None)
        session.pop('code_verifier', None)

    user_id = profile.get('id') or profile.get('sub') or profile.get('email') or ''
    params = {
        'connected': 'true',
        'userId': user_id,
        'name': profile.get('name', ''),
        'picture': profile.get('picture', ''),
    }
    return redirect('/dashboard.html?' + urlencode(params))

@app.route('/api/user/profile')
def user_profile():
    profile = get_user_profile()
    if profile: return jsonify(profile)
    return jsonify({"error": "Not authenticated"}), 401


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.clear()
    credential_file = DATA_DIR / 'google_credentials.json'
    try:
        if credential_file.exists():
            credential_file.unlink()
    except Exception as exc:
        app.logger.warning('Could not delete local Google credentials: %s', exc)
    return jsonify({"ok": True, "redirect": "/"})


def _utc_now():
    return datetime.now(timezone.utc)


def _parse_utc(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _cache_age_seconds(cache_row, field):
    dt = _parse_utc((cache_row or {}).get(field))
    return None if dt is None else max(0, (_utc_now() - dt).total_seconds())


def _cached_response(cache_row, profile, user_row):
    payload = dict((cache_row or {}).get('payload') or {})
    payload['cached'] = True
    payload['cache_mode'] = (cache_row or {}).get('mode')
    payload['cache_processed_at'] = (cache_row or {}).get('processed_at')
    payload['cache_last_checked_at'] = (cache_row or {}).get('last_checked_at')
    payload['user'] = profile
    payload['user_id'] = profile.get('email') or profile.get('id') or ''
    if user_row:
        payload['supabase_user_id'] = user_row.get('id')
    return payload


def _deadline_target(item):
    raw = str((item or {}).get('deadline') or '').strip()
    if not raw:
        return None, False

    now = datetime.now(APP_TZ)
    lower = raw.lower()

    within = re.search(r'within\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)', lower)
    if within:
        amount = int(within.group(1))
        minutes = amount * 60 if within.group(2).startswith(('hour', 'hr')) else amount
        return now + timedelta(minutes=minutes), True

    if 'tomorrow' in lower:
        target = (now + timedelta(days=1)).replace(hour=23, minute=59, second=0, microsecond=0)
        clock = _parse_clock(raw)
        if clock:
            target = target.replace(hour=clock[0], minute=clock[1])
            return target, True
        return target, False

    if 'today' in lower or 'tonight' in lower:
        target = now.replace(hour=23, minute=59, second=0, microsecond=0)
        clock = _parse_clock(raw)
        if clock:
            target = target.replace(hour=clock[0], minute=clock[1])
            return target, True
        return target, False

    try:
        parsed = date_parser.parse(raw, fuzzy=True, default=now)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=APP_TZ)
        else:
            parsed = parsed.astimezone(APP_TZ)
        has_time = bool(re.search(r'\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b', lower))
        return parsed, has_time
    except Exception:
        return None, False


def _deadline_urgency(target):
    if not target:
        return 'normal'
    remaining = (target - datetime.now(APP_TZ)).total_seconds()
    if remaining <= 6 * 3600:
        return 'critical'
    if remaining <= 24 * 3600:
        return 'urgent'
    return 'normal'


def _deadline_marker(item):
    stable = (
        (item or {}).get('source_message_id')
        or (item or {}).get('message_id')
        or (item or {}).get('email_id')
    )
    if stable:
        return f"gmail-{stable}"
    raw = '|'.join([
        str((item or {}).get('subject') or ''),
        str((item or {}).get('title') or ''),
        str((item or {}).get('description') or (item or {}).get('reason') or ''),
        str((item or {}).get('deadline') or ''),
    ])
    return 'derived-' + hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]


def _deadline_title(item):
    title = (
        (item or {}).get('subject')
        or (item or {}).get('title')
        or _short_task_description(item)
        or 'Email deadline'
    )
    title = re.sub(r'\s+', ' ', str(title)).strip()
    if len(title) > 72:
        title = title[:69].rstrip() + '...'
    return title


def _reconcile_ai_calendar(payload, profile=None, force=False):
    """
    Persist high-confidence email deadlines into the currently connected
    Google Calendar. Managed markers make this safe to run repeatedly.
    """
    status = calendar_access_status()
    if not status.get('authenticated') or status.get('writable') is False:
        return {"created_or_updated": 0, "skipped": 0, "enabled": False}

    account_key = str((profile or {}).get('email') or (profile or {}).get('id') or 'default')
    now_ts = time.time()
    if not force and now_ts - _ai_calendar_last_sync.get(account_key, 0) < AI_CALENDAR_SYNC_SECONDS:
        return {"created_or_updated": 0, "skipped": 0, "enabled": True, "throttled": True}

    _ai_calendar_last_sync[account_key] = now_ts
    changed = 0
    skipped = 0

    for item in (payload or {}).get('needs_attention') or []:
        if not item.get('deadline'):
            continue

        target, has_time = _deadline_target(item)
        if not target:
            skipped += 1
            continue

        urgency = _deadline_urgency(target)
        marker = _deadline_marker(item)
        description = str(
            item.get('description')
            or item.get('reason')
            or 'Automatically created from an email deadline by Agent Harness.'
        ).strip()

        if has_time:
            # A deadline is represented as a short block ending at the due time.
            start = target - timedelta(minutes=30)
            end = target
            event_payload = {
                "title": _deadline_title(item),
                "description": description + "\n\nCreated automatically by Agent Harness from Gmail.",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "all_day": False,
                "urgency": urgency,
            }
        else:
            event_payload = {
                "title": _deadline_title(item),
                "description": description + "\n\nCreated automatically by Agent Harness from Gmail.",
                "start": target.date().isoformat(),
                "end": (target.date() + timedelta(days=1)).isoformat(),
                "all_day": True,
                "urgency": urgency,
            }

        try:
            calendar_upsert_ai_deadline(marker, event_payload)
            changed += 1
        except Exception as exc:
            app.logger.warning('AI calendar reconcile skipped %s: %s', marker, exc)
            skipped += 1

    return {"created_or_updated": changed, "skipped": skipped, "enabled": True}


def _build_live_dashboard(profile, user_row, force_ai=False):
    threads, emails = get_gmail_threads()
    if not threads:
        raise RuntimeError('No Gmail threads are available')

    supabase_id = user_row.get('id') if user_row else None
    fingerprint = supabase_cache.fingerprint_emails(emails)
    cached = supabase_cache.get_cached_dashboard(supabase_id) if supabase_id else None

    same_source = bool(
        cached and cached.get('source_fingerprint') == fingerprint
    )
    processed_age = _cache_age_seconds(cached, 'processed_at')
    reprocess_due = processed_age is None or processed_age >= CACHE_REPROCESS_SECONDS

    if supabase_id:
        supabase_cache.save_emails(supabase_id, emails)

    if cached and same_source and not force_ai and not reprocess_due:
        supabase_cache.mark_checked(supabase_id)
        response = _cached_response(cached, profile, user_row)
        response['cache_revalidated'] = True
        return response

    overview = get_dashboard_overview(threads)
    overview['emails'] = emails
    overview['user'] = profile
    overview['user_id'] = profile.get('email') or profile.get('id') or ''
    overview['cached'] = False
    overview['source_changed'] = not same_source if cached else True
    overview['ai_calendar_sync'] = _reconcile_ai_calendar(overview, profile=profile, force=True)

    if supabase_id:
        reprocess_after = (_utc_now() + timedelta(seconds=CACHE_REPROCESS_SECONDS)).isoformat()
        rich_saved = supabase_cache.save_processed_context(
            supabase_id, overview, fingerprint, reprocess_after
        )
        supabase_cache.save_legacy_snapshot(supabase_id, overview)
        overview['cache_mode'] = 'processed-context' if rich_saved else 'legacy-cache'
        overview['supabase_user_id'] = supabase_id

    return overview


def _refresh_user_in_background(profile, user_row):
    key = (user_row or {}).get('id') or profile.get('email') or 'default'
    with _refresh_lock:
        if key in _refreshing_users:
            return False
        _refreshing_users.add(key)

    def runner():
        try:
            _build_live_dashboard(profile, user_row, force_ai=False)
        except Exception as exc:
            app.logger.warning('Background Gmail/cache refresh failed: %s', exc)
        finally:
            with _refresh_lock:
                _refreshing_users.discard(key)

    threading.Thread(target=runner, daemon=True, name=f'cache-refresh-{key}').start()
    return True


@app.route('/api/dashboard/overview')
def dashboard_overview():
    try:
        profile = get_user_profile()
        if not profile:
            return jsonify({"error": "Not authenticated"}), 401

        force = str(request.args.get('refresh', '')).lower() in {'1', 'true', 'yes'}
        user_row = supabase_cache.find_or_create_user(profile) if supabase_cache.enabled else None
        supabase_id = user_row.get('id') if user_row else None

        if supabase_id and not force:
            cached = supabase_cache.get_cached_dashboard(supabase_id)
            if cached:
                checked_age = _cache_age_seconds(cached, 'last_checked_at')
                processed_age = _cache_age_seconds(cached, 'processed_at')
                should_check = checked_age is None or checked_age >= CACHE_SYNC_SECONDS
                should_reprocess = processed_age is None or processed_age >= CACHE_REPROCESS_SECONDS

                started = False
                if should_check or should_reprocess:
                    started = _refresh_user_in_background(profile, user_row)

                response = _cached_response(cached, profile, user_row)
                response['background_refresh_started'] = started
                response['ai_calendar_sync'] = _reconcile_ai_calendar(response, profile=profile, force=False)
                return jsonify(response)

        return jsonify(_build_live_dashboard(profile, user_row, force_ai=force))
    except Exception as exc:
        app.logger.exception('Dashboard processing failed')
        return jsonify({"error": str(exc)}), 500


@app.route('/api/cache/status')
def cache_status():
    profile = get_user_profile()
    if not profile:
        return jsonify({"authenticated": False, "supabase": supabase_cache.status()}), 401

    user_row = supabase_cache.find_or_create_user(profile) if supabase_cache.enabled else None
    cached = supabase_cache.get_cached_dashboard(user_row.get('id')) if user_row else None
    return jsonify({
        "authenticated": True,
        "supabase": supabase_cache.status(),
        "cache": {
            "available": bool(cached),
            "mode": cached.get('mode') if cached else None,
            "processed_at": cached.get('processed_at') if cached else None,
            "last_checked_at": cached.get('last_checked_at') if cached else None,
        },
        "policy": {
            "sync_check_seconds": CACHE_SYNC_SECONDS,
            "reprocess_seconds": CACHE_REPROCESS_SECONDS,
        }
    })


@app.route('/api/calendar/ai-sync', methods=['POST'])
def calendar_ai_sync():
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401

    user_row = supabase_cache.find_or_create_user(profile) if supabase_cache.enabled else None
    cached = supabase_cache.get_cached_dashboard(user_row.get('id')) if user_row else None
    payload = (cached or {}).get('payload') or {}
    if not payload:
        return jsonify({"ok": True, "created_or_updated": 0, "reason": "No cached deadlines"})

    result = _reconcile_ai_calendar(payload, profile=profile, force=True)
    return jsonify({"ok": True, **result})


@app.route('/api/calendar/events', methods=['GET', 'POST'])
def calendar_events():
    try:
        if request.method == 'POST':
            payload = request.get_json(silent=True) or {}
            return jsonify(calendar_create_event(payload)), 201

        events = calendar_list_events(
            start=request.args.get('start'),
            end=request.args.get('end'),
            limit=request.args.get('limit', 250),
        )
        return jsonify(events)
    except Exception as exc:
        app.logger.exception('Calendar request failed')
        return jsonify({"error": str(exc)}), 500


@app.route('/api/calendar/events/<event_id>', methods=['PATCH', 'DELETE'])
def calendar_event_detail(event_id):
    try:
        if request.method == 'DELETE':
            return jsonify(calendar_delete_event(event_id))
        payload = request.get_json(silent=True) or {}
        return jsonify(calendar_update_event(event_id, payload))
    except Exception as exc:
        app.logger.exception('Calendar mutation failed')
        return jsonify({"error": str(exc)}), 500


@app.route('/api/calendar/sync')
def calendar_sync():
    """Small endpoint used by the frontend/Kyle to force a current read."""
    try:
        return jsonify({
            "events": calendar_list_events(
                start=request.args.get('start'),
                end=request.args.get('end'),
                limit=request.args.get('limit', 250),
            ),
            "synced_at": datetime.now(APP_TZ).isoformat(),
            "timezone": APP_TIMEZONE,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

@app.route('/api/stt/status')
def stt_status():
    return jsonify(whisper_service.get_status())

@app.route('/api/stt/transcribe', methods=['POST'])
def stt_transcribe():
    if 'audio' not in request.files:
        return jsonify({"error": "No audio file"}), 400

    audio_file = request.files['audio']
    path = str(DATA_DIR / 'temp_audio.webm')
    audio_file.save(path)

    try:
        result = whisper_service.transcribe(path)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 503


def _day_window_from_text(text):
    now = datetime.now(APP_TZ)
    lower = (text or '').lower()
    if 'tomorrow' in lower:
        day = now + timedelta(days=1)
    elif 'today' in lower or 'tonight' in lower:
        day = now
    else:
        weekdays = {
            'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
            'friday': 4, 'saturday': 5, 'sunday': 6,
        }
        target = next((n for name, n in weekdays.items() if name in lower), None)
        if target is None:
            day = now
        else:
            delta = (target - now.weekday()) % 7
            if delta == 0 and 'next ' in lower:
                delta = 7
            day = now + timedelta(days=delta)

    start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    end = day.replace(hour=23, minute=59, second=59, microsecond=0)
    return start, end


def _parse_clock(text):
    lower = (text or '').lower()
    m = re.search(r'\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b', lower)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2) or 0)
        if hour == 12:
            hour = 0
        if m.group(3) == 'pm':
            hour += 12
        return hour, minute

    m = re.search(r'\bat\s+([01]?\d|2[0-3]):([0-5]\d)\b', lower)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


def _extract_event_title(text):
    raw = (text or '').strip()
    called = re.search(r'\bcalled\s+(.+?)(?:\s+(?:today|tomorrow|on\s+\w+|at\s+\d)|$)', raw, re.I)
    if called:
        return called.group(1).strip(' .')

    # "schedule C2C test tomorrow at 5 pm"
    m = re.search(
        r'\b(?:add|create|schedule|book)\s+(?:an?\s+)?(?:event\s+)?(.+?)(?=\s+(?:today|tomorrow|on\s+\w+|at\s+\d)|$)',
        raw,
        re.I,
    )
    if m:
        title = m.group(1).strip(' .')
        title = re.sub(r'^(?:for\s+)?', '', title).strip()
        if title:
            return title
    return 'New event'


def _natural_event_payload(text):
    day_start, _ = _day_window_from_text(text)
    clock = _parse_clock(text)
    if not clock:
        return None

    hour, minute = clock
    start = day_start.replace(hour=hour, minute=minute)
    duration = 60
    dm = re.search(r'\bfor\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b', text or '', re.I)
    if dm:
        amount = int(dm.group(1))
        duration = amount * 60 if dm.group(2).lower().startswith(('hour', 'hr')) else amount

    return {
        "title": _extract_event_title(text),
        "start": start.isoformat(),
        "end": (start + timedelta(minutes=max(15, duration))).isoformat(),
        "description": "Created by Kyle from Agent Harness.",
    }


def _event_brief_item(event):
    start = event.get('start') or ''
    label = start
    try:
        if 'T' in start:
            dt = datetime.fromisoformat(start.replace('Z', '+00:00')).astimezone(APP_TZ)
            label = dt.strftime('%a %d %b · %-I:%M %p') if os.name != 'nt' else dt.strftime('%a %d %b · %#I:%M %p')
        elif start:
            dt = datetime.fromisoformat(start[:10])
            label = dt.strftime('%a %d %b · all day')
    except Exception:
        pass
    return {
        "title": event.get('title') or 'Event',
        "meta": label,
        "conflict": bool(event.get('conflict')),
        "id": event.get('id'),
    }


def _short_task_description(item):
    text = str(item.get('description') or item.get('reason') or item.get('subject') or 'your highest-priority task').strip()
    text = re.sub(r'\s+', ' ', text)
    return text[:120].rstrip(' ,.;')


def _kyle_fast_path(message, context, selected_event_id=None):
    lower = (message or '').lower().strip()

    if re.search(r'\b(open|show)\s+(my\s+)?calendar\b', lower) and not re.search(r'\b(today|tomorrow|week|schedule|what|events?)\b', lower):
        return {
            "reply": "Calendar opened.",
            "voice": "Calendar opened.",
            "command": {"type": "open_page", "page": "calendar"},
            "handled": True,
        }

    # Calendar reads should never spend a Gemini token.
    if (
        ('calendar' in lower or 'schedule' in lower)
        and re.search(r'\b(what|show|list|have|on|free|busy|today|tomorrow|week)\b', lower)
        and not re.search(r'\b(add|create|schedule\s+an?\s+event|book|move|change|delete|remove)\b', lower)
    ):
        if 'week' in lower:
            start, _ = _day_window_from_text('today')
            start = start - timedelta(days=start.weekday())
            end = start + timedelta(days=7) - timedelta(seconds=1)
        else:
            start, end = _day_window_from_text(lower)
        events = calendar_list_events(start=start.isoformat(), end=end.isoformat(), limit=100)
        items = [_event_brief_item(e) for e in events[:8]]
        conflicts = sum(1 for e in events if e.get('conflict'))

        deadline_items = []
        for task in (context or {}).get('needs_attention') or []:
            deadline = str(task.get('deadline') or '').lower()
            if not deadline:
                continue
            relevant = True
            if 'tomorrow' in lower:
                relevant = 'tomorrow' in deadline
            elif 'today' in lower or 'tonight' in lower:
                relevant = ('today' in deadline or 'tonight' in deadline or 'within' in deadline)
            if relevant:
                deadline_items.append({
                    "title": task.get('subject') or task.get('title') or 'Email deadline',
                    "meta": _short_task_description(task),
                    "conflict": False,
                })

        items = (deadline_items + items)[:8]
        total = len(events) + len(deadline_items)
        if total == 0:
            voice = "Your calendar and deadlines are clear."
            reply = "No calendar events or email deadlines in that window."
        elif deadline_items and not events:
            voice = f"No meetings, but you have {len(deadline_items)} deadline{'s' if len(deadline_items) != 1 else ''}."
            reply = f"{len(deadline_items)} email deadline{'s' if len(deadline_items) != 1 else ''} need attention."
        else:
            first = events[0]
            voice = f"You have {len(events)} calendar event{'s' if len(events) != 1 else ''}"
            if deadline_items:
                voice += f" and {len(deadline_items)} deadline{'s' if len(deadline_items) != 1 else ''}"
            voice += f". First: {first.get('title', 'event')}."
            if conflicts:
                voice += f" {conflicts} clash{'es' if conflicts != 1 else ''}."
            reply = f"{total} scheduled item{'s' if total != 1 else ''} found."
        return {
            "reply": reply,
            "voice": voice,
            "brief": {"title": "Calendar", "items": items},
            "command": {"type": "open_page", "page": "calendar"},
            "handled": True,
        }

    # Deterministic creation for common voice commands: no Gemini call.
    if re.search(r'\b(add|create|schedule|book)\b', lower) and ('event' in lower or 'calendar' in lower or _parse_clock(lower)):
        payload = _natural_event_payload(message)
        if payload:
            event = calendar_create_event(payload)
            item = _event_brief_item(event)
            return {
                "reply": f"Added {event.get('title')} to Google Calendar.",
                "voice": f"Done. {event.get('title')} is on your calendar.",
                "brief": {"title": "Added to calendar", "items": [item]},
                "command": {"type": "calendar_refresh"},
                "handled": True,
            }

    # Selected-event mutations.
    if selected_event_id and re.search(r'\b(delete|remove|cancel)\b', lower):
        calendar_delete_event(selected_event_id)
        return {
            "reply": "Deleted the selected Google Calendar event.",
            "voice": "Done. I deleted it.",
            "command": {"type": "calendar_refresh"},
            "handled": True,
        }

    if selected_event_id and re.search(r'\b(move|change|reschedule)\b', lower):
        clock = _parse_clock(lower)
        if clock:
            start_day, _ = _day_window_from_text(lower)
            hour, minute = clock
            new_start = start_day.replace(hour=hour, minute=minute)
            # Keep the default mutation small; the UI can edit exact duration.
            event = calendar_update_event(selected_event_id, {
                "start": new_start.isoformat(),
                "end": (new_start + timedelta(hours=1)).isoformat(),
            })
            return {
                "reply": f"Moved {event.get('title')} on Google Calendar.",
                "voice": "Done. I moved it.",
                "brief": {"title": "Calendar updated", "items": [_event_brief_item(event)]},
                "command": {"type": "calendar_refresh"},
                "handled": True,
            }

    # "What should I work on?" is primarily local context, not an LLM problem.
    if re.search(r'\b(what should i (work on|do)|what do i (work on|do)|what(?:\'s| is) next|priority)\b', lower):
        attention = list((context or {}).get('needs_attention') or [])
        start, end = _day_window_from_text('today')
        try:
            events = calendar_list_events(start=start.isoformat(), end=end.isoformat(), limit=50)
        except Exception:
            events = []

        items = []
        if attention:
            top = attention[0]
            task = _short_task_description(top)
            items.append({
                "title": top.get('subject') or 'Do this first',
                "meta": task,
                "conflict": False,
            })
            voice = f"Do this first: {task}."
        elif events:
            first = events[0]
            items.append(_event_brief_item(first))
            voice = f"Your next commitment is {first.get('title', 'an event')}."
        else:
            voice = "Nothing urgent is blocking you. Pick one focused task."

        for event in events[:3]:
            items.append(_event_brief_item(event))

        return {
            "reply": voice,
            "voice": voice[:220],
            "brief": {"title": "What to focus on", "items": items[:5]},
            "handled": True,
        }

    return None


def _compact_context(context):
    context = context or {}
    tasks = []
    for item in (context.get('needs_attention') or [])[:3]:
        tasks.append({
            "task": _short_task_description(item),
            "deadline": item.get('deadline'),
        })

    calendar_events = []
    for event in (context.get('calendarEvents') or [])[:5]:
        calendar_events.append({
            "title": event.get('title'),
            "start": event.get('start'),
            "conflict": event.get('conflict'),
        })

    return {"tasks": tasks, "calendar": calendar_events}


def _compact_voice(text, max_chars=190):
    clean = re.sub(r'\s+', ' ', str(text or '')).strip()
    if not clean:
        return ''
    sentences = re.split(r'(?<=[.!?])\s+', clean)
    spoken = sentences[0]
    if len(spoken) < 70 and len(sentences) > 1:
        spoken += ' ' + sentences[1]
    if len(spoken) > max_chars:
        spoken = spoken[:max_chars].rsplit(' ', 1)[0].rstrip(' ,;:') + '.'
    return spoken


@app.route('/api/kyle/chat', methods=['POST'])
def kyle_chat_endpoint():
    data = request.get_json(silent=True) or {}
    msg = str(data.get('message') or '').strip()
    context = data.get('context') or {}
    selected_event_id = data.get('selectedCalendarEventId')

    try:
        fast = _kyle_fast_path(msg, context, selected_event_id=selected_event_id)
        if fast:
            return jsonify(fast)
    except Exception as exc:
        app.logger.warning('Kyle deterministic tool failed: %s', exc)

    # Fallback AI: give it only the tiny context that changes the answer.
    # The full inbox is already visible in the UI, so there is no reason to
    # send/voice it again.
    compact = _compact_context(context)
    ai_prompt = (
        "You are Kyle inside Agent Harness. Answer naturally and directly. "
        "The UI already shows details, so the spoken answer should usually be 1-2 short sentences, <=35 words. "
        "Never claim the calendar is clear when the supplied context contains a deadline or event. "
        f"Context: {json.dumps(compact, ensure_ascii=False)}\n"
        f"User: {msg}"
    )
    text = chat_with_kyle(ai_prompt)
    return jsonify({
        "reply": text,
        "text": text,
        "voice": _compact_voice(text),
        "handled": False,
    })

def _cache_maintenance_loop():
    while True:
        time.sleep(CACHE_SYNC_SECONDS)
        if not supabase_cache.enabled:
            continue
        try:
            profile = get_user_profile()
            if not profile:
                continue
            user_row = supabase_cache.find_or_create_user(profile)
            if user_row:
                _refresh_user_in_background(profile, user_row)
        except Exception as exc:
            app.logger.debug('Cache maintenance skipped: %s', exc)


def _start_cache_maintenance():
    if not supabase_cache.enabled:
        print('[Cache] Supabase disabled; using live Gmail processing.')
        return
    status = supabase_cache.status()
    print(
        f"[Cache] Supabase ready; mode={status.get('mode')}; "
        f"source-check={CACHE_SYNC_SECONDS}s; reprocess={CACHE_REPROCESS_SECONDS}s"
    )
    threading.Thread(
        target=_cache_maintenance_loop,
        daemon=True,
        name='cache-maintenance'
    ).start()


if __name__ == '__main__':
    _start_cache_maintenance()
    port = int(os.getenv('PORT', 5000))
    print(f"Flask server running on http://localhost:{port}")
    print(f"[Static] project root: {BASE_DIR}")
    print(f"[Static] styles.css: {(BASE_DIR / 'styles.css').is_file()}")
    app.run(port=port, host='0.0.0.0', debug=True, use_reloader=False)
