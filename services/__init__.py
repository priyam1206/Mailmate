"""Mailmate service package compatibility hooks for the branch fixes.

This branch currently receives attention references from more than one dashboard
analysis/cache path. WorkAgentService historically accepted only
`source_message_id`, so otherwise Work-ready Gmail could be visible in Overview
but never become a WorkJob. Normalize those equivalent identifiers at the
service boundary without weakening the Privacy Gate or Work policy checks.
"""


def _install_work_sync_normalizer():
    try:
        from . import work_agent_service as _work_module
    except Exception as exc:  # Keep unrelated service imports available.
        print(f"[WorkSyncCompat] deferred: {exc}")
        return

    service = getattr(_work_module, "work_agent_service", None)
    if service is None or getattr(service, "_mailmate_attention_id_compat", False):
        return

    original_sync = service.sync_and_enqueue

    def normalized_sync_and_enqueue(user_id, overview_data):
        if not isinstance(overview_data, dict):
            return original_sync(user_id, overview_data)

        payload = dict(overview_data)

        normalized_emails = []
        for raw in list(payload.get("emails") or []):
            if not isinstance(raw, dict):
                continue
            email = dict(raw)
            canonical_id = email.get("id") or email.get("gmail_id") or email.get("message_id")
            if canonical_id:
                # WorkAgentService builds its lookup from id/gmail_id. Preserve
                # the original fields while giving message_id-only records the
                # same canonical identity.
                email.setdefault("id", str(canonical_id))
                email.setdefault("gmail_id", str(canonical_id))
            normalized_emails.append(email)
        payload["emails"] = normalized_emails

        normalized_attention = []
        for raw in list(payload.get("needs_attention") or []):
            if not isinstance(raw, dict):
                continue
            item = dict(raw)
            source_id = (
                item.get("source_message_id")
                or item.get("message_id")
                or item.get("email_id")
            )
            if source_id:
                item["source_message_id"] = str(source_id)
            normalized_attention.append(item)
        payload["needs_attention"] = normalized_attention

        return original_sync(user_id, payload)

    service.sync_and_enqueue = normalized_sync_and_enqueue
    service._mailmate_attention_id_compat = True
    print("[WorkSyncCompat] attention identifiers normalized for Work sync")


_install_work_sync_normalizer()
