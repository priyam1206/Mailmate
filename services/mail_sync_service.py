import threading
import time


class MailSyncService:
    """Per-account incremental Gmail sync that runs independently of dashboard pages."""

    def __init__(self, snapshot_builder, enqueue_work, interval_seconds=300):
        self.snapshot_builder = snapshot_builder
        self.enqueue_work = enqueue_work
        self.interval_seconds = max(30, int(interval_seconds))
        self._lock = threading.Lock()
        self._workers = {}
        self._sync_locks = {}

    @staticmethod
    def _user_id(profile):
        return str(profile.get('email') or profile.get('id') or profile.get('sub') or 'default').lower()

    def start(self, profile):
        user_id = self._user_id(profile)
        with self._lock:
            existing = self._workers.get(user_id)
            if existing and existing.is_alive():
                return False
            worker = threading.Thread(target=self._run, args=(dict(profile),), daemon=True, name=f'mail-sync-{user_id[:18]}')
            self._workers[user_id] = worker
            self._sync_locks.setdefault(user_id, threading.Lock())
            worker.start()
        return True

    def sync_once(self, profile):
        user_id = self._user_id(profile)
        with self._lock:
            sync_lock = self._sync_locks.setdefault(user_id, threading.Lock())
        if not sync_lock.acquire(blocking=False):
            return {'status': 'in_flight', 'changed': False}
        try:
            payload = self.snapshot_builder(profile, force_ai=False)
            changed = bool(payload.get('source_changed'))
            if changed:
                self.enqueue_work(user_id, payload)
            return {
                'status': 'changed' if changed else 'unchanged',
                'changed': changed,
                'history_id': payload.get('gmail_history_id'),
                'classified': int((payload.get('context_sync') or {}).get('changed_messages') or 0),
            }
        finally:
            sync_lock.release()

    def _run(self, profile):
        while True:
            try:
                self.sync_once(profile)
            except Exception as exc:
                print(f'[MailSync] {self._user_id(profile)}: {exc}')
            time.sleep(self.interval_seconds)

    def status(self):
        with self._lock:
            return {'interval_seconds': self.interval_seconds, 'workers': sum(1 for item in self._workers.values() if item.is_alive())}
