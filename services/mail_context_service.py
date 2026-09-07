import hashlib
import json
import os
import re
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone

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
    context_type = 'work' if work_allowed else 'calendar' if calendar_allowed else 'reply' if reply >= 0.65 and not blocked else 'attention'
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
        'context_type': context_type,
        'status': 'active',
        'display_title': subject[:240] or 'Gmail item',
        'sender_display': sender[:180],
        'summary': 'Action is required.' if action_signal else 'Review when convenient.',
        'deadline_at': None,
        'source_updated_at': str(message.get('timestamp') or message.get('date') or '') or None,
        'processed_at': datetime.now(timezone.utc).isoformat(),
        'classifier_version': CLASSIFIER_VERSION,
    }


class MailContextService:
    def __init__(self):
        self._lock = threading.Lock()
        self._rows = {}
        self._reachable = None
        self._last_error = None
        self._active_rows = 0

    @staticmethod
    def _enabled():
        return str(os.getenv('SUPABASE_CONTEXT_ENABLED', '0')).lower() in {'1', 'true', 'yes', 'on'}

    @staticmethod
    def _config():
        return {
            'url': os.getenv('SUPABASE_URL', '').rstrip('/'),
            'secret': os.getenv('SUPABASE_SECRET_KEY', ''),
            'namespace': os.getenv('MAILMATE_USER_NAMESPACE_UUID', ''),
        }

    def _identity(self, external_user_id):
        namespace = uuid.UUID(self._config()['namespace'])
        normalized = str(external_user_id or 'default').lower()
        return (
            str(uuid.uuid5(namespace, normalized)),
            str(uuid.uuid5(namespace, f'gmail:{normalized}')),
        )

    def _headers(self):
        secret = self._config()['secret']
        return {
            'apikey': secret,
            'Authorization': f'Bearer {secret}',
            'Content-Type': 'application/json',
        }

    def _request(self, method, table, *, params=None, payload=None, prefer=None):
        headers = self._headers()
        if prefer:
            headers['Prefer'] = prefer
        response = requests.request(
            method,
            f"{self._config()['url']}/rest/v1/{table}",
            headers=headers,
            params=params,
            json=payload,
            timeout=8,
        )
        response.raise_for_status()
        self._reachable = True
        self._last_error = None
        return response

    @staticmethod
    def _is_relevant(row):
        return bool(
            row.get('attention_allowed') or row.get('requires_reply')
            or row.get('work_allowed') or row.get('calendar_allowed')
        )

    @staticmethod
    def _storage_payload(row, user_uuid, account_uuid):
        now = datetime.now(timezone.utc)
        return {
            'user_id': user_uuid,
            'account_id': account_uuid,
            'source_message_id': row['gmail_message_id'],
            'source_thread_id': row.get('gmail_thread_id') or None,
            'source_fingerprint': row['source_fingerprint'],
            'context_type': row.get('context_type') or 'attention',
            'status': row.get('status') or 'active',
            'display_title': row.get('display_title') or 'Gmail item',
            'sender_display': row.get('sender_display') or None,
            'summary': row.get('summary') or None,
            'importance_score': row.get('importance_score') or 0,
            'urgency_score': row.get('urgency_score') or 0,
            'needs_attention': bool(row.get('attention_allowed')),
            'requires_reply': bool(row.get('requires_reply')),
            'work_required': bool(row.get('work_allowed')),
            'calendar_required': bool(row.get('calendar_allowed')),
            'deadline_at': row.get('deadline_at'),
            'work_job_id': row.get('work_job_id'),
            'updated_at': now.isoformat(),
            'expires_at': (now + timedelta(days=30)).isoformat(),
            'classifier_version': row.get('classifier_version') or CLASSIFIER_VERSION,
        }

    def update(self, user_id, messages):
        user_key = str(user_id or 'default').lower()
        changed = []
        removed = set()
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
            removed = set(user_rows) - present
            for stale_id in removed:
                user_rows.pop(stale_id, None)
            rows = list(user_rows.values())
        persistence = self._persist(user_key, changed, removed)
        return {'rows': deepcopy(rows), 'changed_count': len(changed), 'persistence': persistence}

    def _persist(self, external_user_id, rows, removed_ids=()):
        if not self._enabled():
            return {'enabled': False, 'stored': 0, 'mode': 'memory-only'}
        config = self._config()
        if not all(config.values()):
            return {'enabled': True, 'stored': 0, 'mode': 'missing-server-config'}
        try:
            user_uuid, account_uuid = self._identity(external_user_id)
            account = [{
                'id': account_uuid,
                'user_id': user_uuid,
                'provider': 'gmail',
                'provider_account_id_hash': hashlib.sha256(external_user_id.encode('utf-8')).hexdigest(),
                'rules_version': RULES_VERSION,
                'last_sync_at': datetime.now(timezone.utc).isoformat(),
            }]
            self._request('POST', 'mail_accounts', params={'on_conflict': 'id'}, payload=account, prefer='resolution=merge-duplicates,return=minimal')
            relevant = [row for row in rows if self._is_relevant(row)]
            irrelevant_ids = {row['gmail_message_id'] for row in rows if not self._is_relevant(row)}
            delete_ids = sorted(set(removed_ids) | irrelevant_ids)
            if delete_ids:
                self._request('DELETE', 'active_ui_context', params={
                    'account_id': f'eq.{account_uuid}',
                    'source_message_id': f'in.({",".join(delete_ids)})',
                })
            minimized = [self._storage_payload(row, user_uuid, account_uuid) for row in relevant]
            if minimized:
                self._request('POST', 'active_ui_context', params={'on_conflict': 'account_id,source_message_id'}, payload=minimized, prefer='resolution=merge-duplicates,return=minimal')
            self._active_rows = len(relevant)
            return {'enabled': True, 'stored': len(minimized), 'deleted': len(delete_ids), 'mode': 'active-context'}
        except Exception:
            self._reachable = False
            self._last_error = 'Supabase active-context persistence is unavailable'
            return {'enabled': True, 'stored': 0, 'mode': 'ram-fallback', 'degraded': True}

    def hydrate(self, external_user_id):
        """Hydrate only live minimized context. Supabase failure leaves RAM usable."""
        if not self._enabled() or not all(self._config().values()):
            return []
        try:
            _, account_uuid = self._identity(external_user_id)
            now = datetime.now(timezone.utc).isoformat()
            self._request('DELETE', 'active_ui_context', params={
                'account_id': f'eq.{account_uuid}',
                'expires_at': f'lte.{now}',
            })
            response = self._request('GET', 'active_ui_context', params={
                'account_id': f'eq.{account_uuid}',
                'status': 'eq.active',
                'expires_at': f'gt.{now}',
                'select': '*',
            })
            stored = response.json() or []
            rows = {}
            for item in stored:
                message_id = str(item.get('source_message_id') or '')
                if not message_id:
                    continue
                rows[message_id] = {
                    'gmail_message_id': message_id,
                    'gmail_thread_id': item.get('source_thread_id'),
                    'source_fingerprint': item.get('source_fingerprint'),
                    'context_type': item.get('context_type'),
                    'status': item.get('status'),
                    'display_title': item.get('display_title'),
                    'sender_display': item.get('sender_display'),
                    'summary': item.get('summary'),
                    'importance_score': item.get('importance_score') or 0,
                    'urgency_score': item.get('urgency_score') or 0,
                    'attention_allowed': bool(item.get('needs_attention')),
                    'requires_reply': bool(item.get('requires_reply')),
                    'work_allowed': bool(item.get('work_required')),
                    'calendar_allowed': bool(item.get('calendar_required')),
                    'deadline_at': item.get('deadline_at'),
                    'classifier_version': item.get('classifier_version') or CLASSIFIER_VERSION,
                }
            with self._lock:
                self._rows[str(external_user_id or 'default').lower()] = rows
            self._active_rows = len(rows)
            return deepcopy(list(rows.values()))
        except Exception:
            self._reachable = False
            self._last_error = 'Supabase active-context hydration is unavailable'
            return []

    def delete_context(self, external_user_id, message_ids):
        ids = {str(item) for item in (message_ids or []) if item}
        user_key = str(external_user_id or 'default').lower()
        with self._lock:
            for message_id in ids:
                self._rows.get(user_key, {}).pop(message_id, None)
        if ids:
            self._persist(user_key, [], ids)

    def load_sync_state(self, external_user_id):
        if not self._enabled() or not all(self._config().values()):
            return {}
        try:
            _, account_uuid = self._identity(external_user_id)
            response = self._request('GET', 'mail_accounts', params={
                'id': f'eq.{account_uuid}',
                'select': 'last_history_id,last_sync_at,last_full_scan_at',
                'limit': '1',
            })
            rows = response.json() or []
            return rows[0] if rows else {}
        except Exception:
            self._reachable = False
            return {}

    def save_sync_state(self, external_user_id, history_id, full_scan=False):
        if not self._enabled() or not all(self._config().values()):
            return False
        try:
            user_uuid, account_uuid = self._identity(external_user_id)
            now = datetime.now(timezone.utc).isoformat()
            account = {
                'id': account_uuid,
                'user_id': user_uuid,
                'provider': 'gmail',
                'provider_account_id_hash': hashlib.sha256(str(external_user_id).encode('utf-8')).hexdigest(),
                'last_history_id': str(history_id or '') or None,
                'last_sync_at': now,
                'rules_version': RULES_VERSION,
            }
            if full_scan:
                account['last_full_scan_at'] = now
            self._request(
                'POST', 'mail_accounts', params={'on_conflict': 'id'}, payload=[account],
                prefer='resolution=merge-duplicates,return=minimal',
            )
            return True
        except Exception:
            self._reachable = False
            return False

    def status(self):
        enabled = self._enabled()
        configured = all(self._config().values())
        return {
            'enabled': enabled,
            'configured': configured,
            'reachable': self._reachable if configured else None,
            'ready': enabled and configured and self._reachable is not False,
            'mode': 'active-context' if enabled and configured else 'memory-only',
            'activeRows': self._active_rows,
            'degraded': self._reachable is False,
        }


mail_context_service = MailContextService()
