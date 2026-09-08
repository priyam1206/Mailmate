(function () {
  const UI_TOOLS = new Set([
    'navigation.open', 'inbox.set_filter', 'inbox.open_email', 'calendar.open_event',
    'work.focus', 'ui.highlight', 'ui.scroll_to', 'ui.annotate', 'ui.toast',
    'calendar.preview_move', 'calendar.preview_create',
    'calendar.inspect_event', 'calendar.delete_prepare', 'calendar.refresh',
    'automation.run_now', 'automation.enable', 'automation.disable',
    'mail.compose', 'mail.reply', 'mail.update_draft', 'mail.close_composer'
  ]);
  const WRITE_TOOLS = new Set(['calendar.commit_move', 'calendar.commit_create', 'calendar.delete_confirmed', 'mail.send_draft']);
  const DESTRUCTIVE_TOOLS = new Set(['calendar.delete', 'inbox.send_reply']);

  function evaluate(action = {}) {
    const tool = String(action.tool || '');
    if (UI_TOOLS.has(tool)) return { allowed: true, risk: 'ui' };
    if (WRITE_TOOLS.has(tool)) {
      if (tool === 'mail.send_draft') {
        if (!action.args?.explicit_send) {
          return { allowed: false, approvalRequired: true, reason: 'Say send when you want Kyle to deliver this draft.' };
        }
        return { allowed: true, risk: 'write', basis: 'explicit-user-send' };
      }
      const previewId = String(action.args?.previewId || '');
      if (!previewId) return { allowed: false, reason: 'A visible preview is required before this write.' };
      if (!action.args?.approved) return { allowed: false, approvalRequired: true, reason: 'Review the preview, then confirm the change.' };
      return { allowed: true, risk: 'write' };
    }
    if (DESTRUCTIVE_TOOLS.has(tool)) {
      return { allowed: false, approvalRequired: true, reason: 'This action needs explicit confirmation.' };
    }
    return { allowed: false, reason: 'Tool is not in Kyle policy.' };
  }

  window.KylePolicy = { evaluate };

  function loadBranchFix(src, marker, onload) {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset[marker] = '1';
    if (typeof onload === 'function') script.addEventListener('load', onload, { once: true });
    document.head.appendChild(script);
  }

  // Preserve the earlier architecture patch, then layer the UX/safety patch
  // on top so it wraps the already-guarded fetch/send behavior deterministically.
  loadBranchFix('./kyle-main-fixes.js?v=2', 'mailmateKyleMainFixes', () => {
    loadBranchFix('./mailmate-ux-fixes.js?v=1', 'mailmateUxFixes', () => {
      loadBranchFix('./mailmate-inbox-stability.js?v=1', 'mailmateInboxStability');
    });
  });
})();