(function () {
  function snapshot() {
    return window.MailmateContext?.snapshot?.() || {};
  }

  function composerSnapshot() {
    const panel = document.getElementById('kyleActionPanel');
    const subject = document.getElementById('kyleComposerSubject');
    const body = document.getElementById('kyleComposerText');

    if (!panel) {
      return {
        exists: false,
        visible: false,
        mode: null,
        state: null,
        subject: '',
        body: ''
      };
    }

    const style = window.getComputedStyle(panel);
    const rect = panel.getBoundingClientRect();
    const visible =
      panel.isConnected &&
      panel.getAttribute('aria-hidden') !== 'true' &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0 &&
      rect.width > 20 &&
      rect.height > 20;

    return {
      exists: true,
      visible,
      mode: panel.dataset.mode || null,
      state: panel.dataset.composerState || null,
      subject: subject?.value || '',
      body: body?.value || '',
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }
    };
  }

  function capture(action) {
    const reference = action?.args?.reference;
    const element = reference ? window.MailmateObjects?.getElement(reference) : null;

    return {
      context: snapshot(),
      composer: composerSnapshot(),
      reference,
      connected: Boolean(element?.isConnected),
      rect: element?.getBoundingClientRect?.().toJSON?.() || null
    };
  }

  async function after(action, before, result) {
    await new Promise(resolve => setTimeout(resolve, 70));

    const current = snapshot();
    const composer = composerSnapshot();
    let satisfied = result !== false && result?.ok !== false;
    const details = {};

    if (action.tool === 'navigation.open') {
      satisfied = current.page === action.args?.page;
    }

    if (action.tool === 'inbox.set_filter') {
      const activeFilter = document.querySelector('.filter-tab.active')?.dataset.filter || '';
      details.filter = activeFilter;
      details.count = document.querySelectorAll('#emailList .email-item').length;
      satisfied = activeFilter === action.args?.filter;
    }

    if (action.tool === 'inbox.open_email') {
      satisfied =
        current.open?.type === 'email' &&
        current.open?.id === action.args?.reference?.id;
    }

    if (action.tool === 'calendar.open_event') {
      satisfied =
        current.open?.type === 'calendar-event' &&
        current.open?.id === action.args?.reference?.id;
    }

    if (action.tool === 'mail.compose' || action.tool === 'mail.reply') {
      details.composer = composer;
      satisfied = composer.exists && composer.visible && composer.mode === 'email_review';
    }

    if (action.tool === 'mail.update_draft') {
      details.composer = composer;
      satisfied =
        composer.exists &&
        composer.visible &&
        (action.args?.subject === undefined || composer.subject === String(action.args.subject)) &&
        (action.args?.body === undefined || composer.body === String(action.args.body));
    }

    if (action.tool === 'mail.send_draft') {
      details.composer = composer;
      satisfied =
        result?.ok === true &&
        (
          composer.state === 'sent' ||
          Boolean(result?.messageId || result?.message_id)
        );
    }

    return {
      satisfied,
      before: before?.context || {},
      after: current,
      details
    };
  }

  window.KyleObservation = {
    snapshot,
    composerSnapshot,
    capture,
    after
  };
})();
