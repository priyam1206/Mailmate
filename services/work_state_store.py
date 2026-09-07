import os
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import requests


TERMINAL_STATUSES = {
    'sent', 'approved_sent', 'resolved_external', 'ignored_outbound',
    'completed', 'cancelled',
}


class WorkStateStore:
    """RAM-first active Work store with minimized Supabase durability."""

    def __init__(self):
        self._lock = threading.RLock()
        self._jobs = {}
        self._hydrated_users = set()
        self._reachable = None

    def _enabled(self):
        return str(os.getenv('SUPABASE_CONTEXT_ENABLED', '0')).lower() in {'1', 'true', 'yes', 'on'}

    def _config(self):
        return (
            os.getenv('SUPABASE_URL', '').rstrip('/'),
            os.getenv('SUPABASE_SECRET_KEY', ''),
            os.getenv('MAILMATE_USER_NAMESPACE_UUID', ''),
        )

    def _user_uuid(self, user_id):
        return str(uuid.uuid5(uuid.UUID(self._config()[2]), str(user_id or 'default').lower()))

    def _request(self, method, table, **kwargs):
        url, secret, _ = self._config()
        headers = {
            'apikey': secret,
            'Authorization': f'Bearer {secret}',
            'Content-Type': 'application/json',
        }
        prefer = kwargs.pop('prefer', None)
        if prefer:
            headers['Prefer'] = prefer
        response = requests.request(method, f'{url}/rest/v1/{table}', headers=headers, timeout=8, **kwargs)
        response.raise_for_status()
        self._reachable = True
        return response

    @staticmethod
    def _artifact_metadata(job):
        return [
            {
                'filename': str(item.get('filename') or item.get('name') or '')[:240],
                'type': str(item.get('type') or '')[:80],
                'path': str(item.get('path') or item.get('id') or '')[:500],
            }
            for item in (job.get('artifacts') or [])
            if item.get('filename') or item.get('name') or item.get('path') or item.get('id')
        ]

    def _payload(self, job):
        source = job.get('source') or {}
        output = job.get('output') or {}
        now = datetime.now(timezone.utc)
        return {
            'job_id': str(job.get('id') or ''),
            'user_id': self._user_uuid(job.get('user_id')),
            'source_message_id': str(source.get('message_id') or ''),
            'source_thread_id': str(source.get('thread_id') or '') or None,
            'clean_title': str(job.get('clean_title') or job.get('title') or 'Work task')[:240],
            'status': str(job.get('status') or 'queued'),
            'current_step': str(job.get('current_step') or '')[:500] or None,
            'task_summary': str(output.get('summary') or source.get('subject') or '')[:1000] or None,
            'deadline': source.get('deadline') or None,
            'generated_reply': str(output.get('suggested_reply') or '')[:12000] or None,
            'approval_state': str((job.get('policy_verdict') or {}).get('decision') or job.get('status') or '')[:80],
            'gmail_draft_id': output.get('gmail_draft_id') or None,
            'artifact_metadata': self._artifact_metadata(job),
            'updated_at': now.isoformat(),
            'expires_at': (now + timedelta(days=14)).isoformat(),
        }

    def hydrate(self, user_id):
        normalized = str(user_id or '').lower()
        if not normalized or normalized in self._hydrated_users:
            return
        self._hydrated_users.add(normalized)
        if not self._enabled() or not all(self._config()):
            return
        try:
            response = self._request('GET', 'active_work_state', params={
                'user_id': f'eq.{self._user_uuid(normalized)}',
                'expires_at': f'gt.{datetime.now(timezone.utc).isoformat()}',
                'select': '*',
            })
            with self._lock:
                for row in response.json() or []:
                    job_id = str(row.get('job_id') or '')
                    if not job_id or job_id in self._jobs:
                        continue
                    artifacts = [
                        {'filename': item.get('filename'), 'type': item.get('type'), 'path': item.get('path')}
                        for item in (row.get('artifact_metadata') or [])
                    ]
                    self._jobs[job_id] = {
                        'id': job_id,
                        'user_id': normalized,
                        'title': row.get('clean_title'),
                        'clean_title': row.get('clean_title'),
                        'status': row.get('status'),
                        'current_step': row.get('current_step'),
                        'source': {
                            'type': 'gmail',
                            'message_id': row.get('source_message_id'),
                            'thread_id': row.get('source_thread_id'),
                            'deadline': row.get('deadline'),
                        },
                        'output': {
                            'summary': row.get('task_summary'),
                            'suggested_reply': row.get('generated_reply') or '',
                            'gmail_draft_id': row.get('gmail_draft_id'),
                            'checklist': [],
                            'notes': [],
                        },
                        'artifacts': artifacts,
                        'steps': [],
                        'created_at': row.get('created_at'),
                        'updated_at': row.get('updated_at'),
                    }
        except Exception:
            self._reachable = False

    def read_all(self):
        with self._lock:
            return deepcopy(self._jobs)

    def write_all(self, jobs):
        with self._lock:
            self._jobs = deepcopy(jobs if isinstance(jobs, dict) else {})
        if not self._enabled() or not all(self._config()):
            return
        try:
            for job in self._jobs.values():
                job_id = str(job.get('id') or '')
                if not job_id:
                    continue
                if job.get('status') in TERMINAL_STATUSES:
                    self._request('DELETE', 'active_work_state', params={'job_id': f'eq.{job_id}'})
                    source_id = str((job.get('source') or {}).get('message_id') or '')
                    if source_id:
                        self._request('DELETE', 'active_ui_context', params={
                            'user_id': f'eq.{self._user_uuid(job.get("user_id"))}',
                            'source_message_id': f'eq.{source_id}',
                        })
                    continue
                payload = self._payload(job)
                if not payload['source_message_id']:
                    continue
                self._request(
                    'POST', 'active_work_state',
                    params={'on_conflict': 'job_id'}, json=[payload],
                    prefer='resolution=merge-duplicates,return=minimal',
                )
        except Exception:
            self._reachable = False


work_state_store = WorkStateStore()
