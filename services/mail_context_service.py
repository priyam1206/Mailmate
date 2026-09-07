import hashlib
import json
import os
import re
import threading
import time
import uuid
from copy import deepcopy
from datetime import datetime, timezone

import jwt
import requests


CLASSIFIER_VERSION = 1
RULES_VERSION = 1


def _clamp(value):
    return round(max(0.0, min(1.0, float(value))), 3)


def _fingerprint(message):
    source = {
        'id': str(message.get('id') or message.get('gmail_id') or ''),
        'thread_id': str(message.get('thread_id') or ''),
        'subject': str(message.get('subject') or ''),
        'sender': str(message.get('sender') or ''),
        'snippet': str(message.get('snippet') or ''),
        'timestamp': str(message.get('timestamp') or message.get('date') or ''),
        'labels': sorted(str(item) for item in (message.get('labels') or [])),
        'direction': str(message.get('direction') or ''),
    }
    packed = json.dumps(source, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return hashlib.sha256(packed.encode('utf-8')).hexdigest()


def _contains(pattern, text):
    return bool(re.search(pattern, text, re.I))


def classify_message(message, gate=None):
    """Return minimized, deterministic derived context; never return mail content."""
    subject = str(message.get('subject') or '')
    snippet = str(message.get('snippet') or '')
    sender = str(message.get('sender') or '')
    text = f'{subject} {snippet} {sender}'
    labels = ' '.join(str(item) for item in (message.get('labels') or [])).lower()
    direction = str(message.get('direction') or 'unknown').lower()

    promotional = 'promotion' in labels or _contains(r'\b(unsubscribe|sale|discount|limited offer|newsletter)\b', text)
    money_claim = _contains(r'\b(prize|lottery|jackpot|casino|gambling|bet|crypto giveaway|claim reward)\b', text)
    credential_request = _contains(r'\b(password|otp|one[- ]time password|verify your account|login immediately|credentials?)\b', text)
    suspicious_link = _contains(r'https?://(?:\d{1,3}\.){3}\d{1,3}|\b(bit\.ly|tinyurl\.com|t\.co)/', text)
    action_signal = _contains(r'\b(action required|please|can you|could you|reply|respond|review|approve|submit|submission|assignment|send|provide|meeting|schedule)\b', text)
    deadline_signal = _contains(r'\b(due|deadline|today|tonight|tomorrow|within \d+ (?:hours?|days?))\b', text)
    work_signal = _contains(r'\b(assignment|submission|deliverable|project|report|document|spreadsheet|presentation|proposal|code|repository)\b', text)
    calendar_signal = _contains(r'\b(meeting|appointment|call|schedule|calendar|due|deadline)\b', text)

    deterministic_phishing = (
        (0.35 if credential_request else 0)
        + (0.25 if money_claim else 0)
        + (0.25 if suspicious_link else 0)
        + (0.15 if _contains(r'\b(urgent|immediately|suspended)\b', text) and credential_request else 0)
    )
    spam = (0.7 if promotional else 0) + (0.25 if money_claim else 0)
    malicious = (0.55 if suspicious_link and credential_request else 0) + (0.25 if money_claim else 0)
    financial = 0.8 if _contains(r'\b(bank|card|payment|invoice|account number|upi|wallet|tax)\b', text) else 0
    privacy = 0.85 if credential_request or _contains(r'\b(otp|medical|health|passport|aadhaar|social security)\b', text) else 0.1

    importance = 0.2 + (0.45 if action_signal else 0) + (0.2 if 'important' in labels else 0) + (0.15 if deadline_signal else 0)
    urgency = (0.55 if deadline_signal else 0.1) + (0.2 if _contains(r'\b(today|tonight|within \d+ hours?)\b', text) else 0)
    action = (0.75 if action_signal else 0.1) + (0.15 if direction == 'inbound' else -0.1)
    reply = (0.7 if direction == 'inbound' and action_signal else 0.1)
    work = (0.75 if work_signal and action_signal else 0.15)
    calendar = (0.75 if calendar_signal and deadline_signal else 0.1)

    scores = {
        'importance_score': _clamp(importance),
        'urgency_score': _clamp(urgency),
        'spam_score': _clamp(spam),
        'phishing_score': _clamp(deterministic_phishing),
        'malicious_score': _clamp(malicious),
        'financial_sensitivity_score': _clamp(financial),
        'privacy_score': _clamp(privacy),
        'action_score': _clamp(action),
        'reply_score': _clamp(reply),
        'work_score': _clamp(work),
        'calendar_score': _clamp(calendar),
        'confidence_score': 0.9,
    }
    blocked = scores['phishing_score'] >= 0.55 or scores['spam_score'] >= 0.65 or scores['malicious_score'] >= 0.55
    gate = gate or {}
    privacy_blocked = gate.get('routing') == 'BLOCK'
    attention_allowed = not blocked and not privacy_blocked and scores['importance_score'] >= 0.7 and scores['action_score'] >= 0.6
    work_allowed = not blocked and not privacy_blocked and scores['action_score'] >= 0.75 and scores['work_score'] >= 0.65
    calendar_allowed = not blocked and not privacy_blocked and scores['action_score'] >= 0.75 and scores['urgency_score'] >= 0.5 and scores['calendar_score'] >= 0.7

    category = 'unsafe' if blocked else 'actionable_work' if work_allowed else 'actionable' if attention_allowed else 'informational'
    return {
        'gmail_message_id': str(message.get('id') or message.get('gmail_id') or ''),
        'gmail_thread_id': str(message.get('thread_id') or ''),
        'source_fingerprint': _fingerprint(message),
        'direction': direction,
        'category': category,
        **scores,
        'requires_reply': bool(reply >= 0.65 and not blocked),
        'attention_allowed': attention_allowed,
        'work_allowed': work_allowed,
        'calendar_allowed': calendar_allowed,
        'deadline_at': None,
        'source_updated_at': str(message.get('timestamp') or message.get('date') or '') or None,
        'processed_at': datetime.now(timezone.utc).isoformat(),
        'classifier_version': CLASSIFIER_VERSION,
    }


class MailContextService:
    def __init__(self):
        self._lock = threading.Lock()
        self._rows = {}

    def update(self, user_id, messages):
        user_key = str(user_id or 'default').lower()
        changed = []
        with self._lock:
            user_rows = self._rows.setdefault(user_key, {})
            present = set()
            for message in messages or []:
                message_id = str(message.get('id') or message.get('gmail_id') or '')
                if not message_id:
                    continue
                present.add(message_id)
                fingerprint = _fingerprint(message)
                existing = user_rows.get(message_id)
                if existing and existing.get('source_fingerprint') == fingerprint and existing.get('classifier_version') == CLASSIFIER_VERSION:
                    continue
                row = classify_message(message, message.get('privacy_gate'))
                user_rows[message_id] = row
                changed.append(row)
            for stale_id in set(user_rows) - present:
                user_rows.pop(stale_id, None)
            rows = list(user_rows.values())
        persistence = self._persist(user_key, changed)
        return {'rows': deepcopy(rows), 'changed_count': len(changed), 'persistence': persistence}

    def _persist(self, external_user_id, rows):
        if not rows or str(os.getenv('SUPABASE_CONTEXT_ENABLED', '0')).lower() not in {'1', 'true', 'yes', 'on'}:
            return {'enabled': False, 'stored': 0, 'mode': 'memory-only'}
        url = os.getenv('SUPABASE_URL', '').rstrip('/')
        anon_key = os.getenv('SUPABASE_PUBLISHABLE_KEY', '')
        jwt_secret = os.getenv('SUPABASE_JWT_SECRET', '')
        namespace = os.getenv('MAILMATE_USER_NAMESPACE_UUID', '')
        if not all((url, anon_key, jwt_secret, namespace)):
            return {'enabled': False, 'stored': 0, 'mode': 'missing-user-jwt-config'}
        try:
            user_uuid = str(uuid.uuid5(uuid.UUID(namespace), external_user_id))
            account_uuid = str(uuid.uuid5(uuid.UUID(namespace), f'gmail:{external_user_id}'))
            now = int(time.time())
            token = jwt.encode({'sub': user_uuid, 'role': 'authenticated', 'aud': 'authenticated', 'iat': now, 'exp': now + 300}, jwt_secret, algorithm='HS256')
            headers = {'apikey': anon_key, 'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal'}
            account = [{
                'id': account_uuid,
                'user_id': user_uuid,
                'provider': 'gmail',
                'provider_account_id_hash': hashlib.sha256(external_user_id.encode('utf-8')).hexdigest(),
                'rules_version': RULES_VERSION,
                'last_sync_at': datetime.now(timezone.utc).isoformat(),
            }]
            requests.post(f'{url}/rest/v1/mail_accounts?on_conflict=id', headers=headers, json=account, timeout=8).raise_for_status()
            minimized = [{**row, 'user_id': user_uuid, 'account_id': account_uuid} for row in rows]
            requests.post(f'{url}/rest/v1/mail_context?on_conflict=account_id,gmail_message_id', headers=headers, json=minimized, timeout=8).raise_for_status()
            return {'enabled': True, 'stored': len(minimized), 'mode': 'user-scoped-jwt'}
        except Exception as exc:
            return {'enabled': True, 'stored': 0, 'mode': 'error', 'error': str(exc)[:180]}

    def status(self):
        enabled = str(os.getenv('SUPABASE_CONTEXT_ENABLED', '0')).lower() in {'1', 'true', 'yes', 'on'}
        configured = bool(os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_PUBLISHABLE_KEY') and os.getenv('SUPABASE_JWT_SECRET') and os.getenv('MAILMATE_USER_NAMESPACE_UUID'))
        return {'enabled': enabled, 'configured': configured, 'ready': enabled and configured, 'mode': 'user-scoped-jwt' if enabled and configured else 'memory-only'}


mail_context_service = MailContextService()
