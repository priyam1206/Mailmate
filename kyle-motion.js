(function () {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let queueTail = Promise.resolve();

  function duration(ms) {
    return reducedMotion?.matches ? 0 : ms;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, duration(ms)));
  }

  function queue(tasks) {
    const run = async () => {
      for (const task of tasks) await task();
    };
    queueTail = queueTail.then(run, run);
    return queueTail;
  }

  function caption(text, options = {}) {
    window.dispatchEvent(new CustomEvent('kyle:motion-caption', {
      detail: { text: String(text || ''), transient: Boolean(options.transient) }
    }));
  }

  function labelFor(action) {
    const label = action.args?.reference?.label || 'that item';
    const labels = {
      'navigation.open': `Opening ${action.args?.page || 'that page'}...`,
      'inbox.set_filter': 'Filtering your inbox...',
      'inbox.open_email': `Finding ${label}...`,
      'calendar.open_event': `Opening ${label}...`,
      'calendar.preview_move': `Previewing a new time for ${label}...`,
      'calendar.preview_create': 'Finding a place on your calendar...',
      'calendar.delete_prepare': 'Resolving the exact calendar items...',
      'calendar.delete_confirmed': 'Removing the confirmed calendar items...',
      'calendar.refresh': 'Refreshing Google Calendar...',
      'automation.run_now': 'Starting that scheduled Kyle run...',
      'automation.enable': 'Enabling that automation...',
      'automation.disable': 'Pausing that automation...',
      'work.focus': `Focusing ${label}...`,
      'ui.highlight': 'Showing you where...',
      'ui.scroll_to': 'Bringing it into view...'
    };
    return labels[action.tool] || 'Working on it...';
  }

  let currentOrbDelta = { x: 0, y: 0 };

  async function moveOrbTo(target, options = {}) {
    const mount = document.getElementById('kyleMount') || document.querySelector('.kyle-floating-mount');
    if (!mount) return false;

    let element = null;
    if (typeof target === 'string') {
      element = document.querySelector(target);
    } else if (target && typeof target.getBoundingClientRect === 'function') {
      element = target;
    } else if (target && target.type) {
      element = window.MailmateObjects?.getElement(target);
    }
    if (!element) return false;

    if (options.scroll !== false && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({
        behavior: reducedMotion?.matches ? 'auto' : 'smooth',
        block: options.scrollBlock || 'nearest',
        inline: 'nearest'
      });
      await wait(reducedMotion?.matches ? 0 : 80);
    }

    const targetRect = element.getBoundingClientRect();
    const orbWidth = mount.offsetWidth || 76;
    const orbHeight = mount.offsetHeight || 76;
    const winW = window.innerWidth || 1200;
    const winH = window.innerHeight || 800;

    // Fixed dock home is bottom-right (right: 26px, bottom: 26px)
    const homeLeft = winW - orbWidth - 26;
    const homeTop = winH - orbHeight - 26;

    // Prefer placing Kyle to the right of target
    let candidateX = targetRect.right + 16;
    let candidateY = targetRect.top + Math.max(0, (targetRect.height - orbHeight) / 2);

    // If overflowing right, place to the left of target
    if (candidateX + orbWidth > winW - 16) {
      candidateX = targetRect.left - orbWidth - 16;
    }

    // If still overflowing left, place above or below
    if (candidateX < 16) {
      candidateX = Math.min(winW - orbWidth - 16, Math.max(16, targetRect.left + 16));
      candidateY = targetRect.top > orbHeight + 20 ? targetRect.top - orbHeight - 12 : targetRect.bottom + 12;
    }

    // Viewport collision bounds protection
    candidateX = Math.max(12, Math.min(winW - orbWidth - 12, candidateX));
    candidateY = Math.max(12, Math.min(winH - orbHeight - 12, candidateY));

    const deltaX = Math.round(candidateX - homeLeft);
    const deltaY = Math.round(candidateY - homeTop);

    mount.classList.add('kyle-traveling');

    if (reducedMotion?.matches) {
      currentOrbDelta = { x: deltaX, y: deltaY };
      mount.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
      return true;
    }

    const prevX = currentOrbDelta.x;
    const prevY = currentOrbDelta.y;
    currentOrbDelta = { x: deltaX, y: deltaY };

    if (typeof mount.animate === 'function') {
      const midX = Math.round((prevX + deltaX) / 2);
      const midY = Math.round((prevY + deltaY) / 2 - Math.min(35, Math.abs(deltaX - prevX) * 0.1 + 15));
      const anim = mount.animate([
        { transform: `translate3d(${prevX}px, ${prevY}px, 0)` },
        { transform: `translate3d(${midX}px, ${midY}px, 0)`, offset: 0.45 },
        { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` }
      ], {
        duration: duration(options.duration || 420),
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        fill: 'forwards'
      });
      await new Promise(resolve => {
        anim.onfinish = resolve;
        setTimeout(resolve, duration(options.duration || 420) + 20);
      });
      try { anim.cancel(); } catch (_) {}
    }

    mount.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
    await wait(options.pauseAfter || 60);
    return true;
  }

  async function moveOrbHome(options = {}) {
    const mount = document.getElementById('kyleMount') || document.querySelector('.kyle-floating-mount');
    if (!mount) return false;

    if (currentOrbDelta.x === 0 && currentOrbDelta.y === 0 && !mount.style.transform) {
      mount.classList.remove('kyle-traveling');
      return true;
    }

    if (reducedMotion?.matches) {
      currentOrbDelta = { x: 0, y: 0 };
      mount.style.transform = '';
      mount.classList.remove('kyle-traveling');
      return true;
    }

    const prevX = currentOrbDelta.x;
    const prevY = currentOrbDelta.y;
    currentOrbDelta = { x: 0, y: 0 };

    if (typeof mount.animate === 'function') {
      const anim = mount.animate([
        { transform: `translate3d(${prevX}px, ${prevY}px, 0)` },
        { transform: 'translate3d(0px, 0px, 0)' }
      ], {
        duration: duration(options.duration || 400),
        easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
        fill: 'forwards'
      });
      await new Promise(resolve => {
        anim.onfinish = resolve;
        setTimeout(resolve, duration(options.duration || 400) + 20);
      });
      try { anim.cancel(); } catch (_) {}
    }

    mount.style.transform = '';
    mount.classList.remove('kyle-traveling');
    await wait(options.pauseAfter || 40);
    return true;
  }

  async function acquire(reference) {
    const element = window.MailmateObjects?.getElement(reference);
    if (!element) return false;
    element.scrollIntoView({ behavior: reducedMotion?.matches ? 'auto' : 'smooth', block: 'center' });
    element.classList.add('kyle-acquiring');
    await moveOrbTo(element, { scroll: false });
    await wait(140);
    element.classList.remove('kyle-acquiring');
    return true;
  }

  async function emphasizeSelection(reference) {
    const snapshot = window.MailmateContext?.snapshot?.() || {};
    const source = snapshot.selectedTextSource;
    if (!snapshot.selectedText || source?.type !== reference?.type || source?.id !== reference?.id) return false;
    const range = window.getSelection?.()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return false;
    const sweep = document.createElement('span');
    sweep.className = 'kyle-selection-emphasis';
    Object.assign(sweep.style, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`
    });
    document.body.appendChild(sweep);
    requestAnimationFrame(() => sweep.classList.add('is-visible'));
    annotate(reference, 'Using this', 1100);
    await wait(180);
    setTimeout(() => sweep.remove(), duration(900));
    return true;
  }

  async function navigate(page) {
    const nav = window.MailmateObjects?.getElement({ type: 'page', id: page });
    const current = document.querySelector('.tab-panel.active');
    nav?.classList.add('kyle-nav-target');
    current?.classList.add('kyle-panel-leaving');
    await wait(120);
    nav?.classList.remove('kyle-nav-target');
  }

  async function focus(reference) {
    const element = window.MailmateObjects?.getElement(reference);
    if (!element) return false;
    element.classList.remove('kyle-focus');
    void element.offsetWidth;
    element.classList.add('kyle-focus');
    if (window.KyleSpotlight?.spotlight) {
      window.KyleSpotlight.spotlight(element, { duration: 2400 });
    }
    setTimeout(() => element.classList.remove('kyle-focus'), duration(1800));
    return true;
  }

  async function reveal(reference) {
    const element = window.MailmateObjects?.getElement(reference);
    const detail = reference?.type === 'email' ? document.getElementById('emailDetail') : element;
    if (!detail) return false;
    detail.classList.remove('kyle-reveal');
    void detail.offsetWidth;
    detail.classList.add('kyle-reveal');
    if (reference?.type === 'email') {
      const header = detail.querySelector('.email-detail-header') || detail;
      if (window.KyleSpotlight?.spotlight) {
        window.KyleSpotlight.spotlight(header, { duration: 3200, scroll: false });
      }
    }
    setTimeout(() => detail.classList.remove('kyle-reveal'), duration(650));
    await wait(190);
    return true;
  }

  function annotate(reference, text, timeout = 1700) {
    const element = window.MailmateObjects?.getElement(reference);
    if (!element || !text) return false;
    const note = document.createElement('span');
    note.className = 'kyle-annotation';
    note.textContent = String(text).slice(0, 90);
    document.body.appendChild(note);
    const rect = element.getBoundingClientRect();
    note.style.left = `${Math.min(window.innerWidth - note.offsetWidth - 12, Math.max(12, rect.left))}px`;
    note.style.top = `${Math.max(10, rect.top - 34)}px`;
    requestAnimationFrame(() => note.classList.add('is-visible'));
    setTimeout(() => {
      note.classList.remove('is-visible');
      setTimeout(() => note.remove(), duration(180));
    }, duration(timeout));
    return true;
  }

  async function previewMove(reference, result) {
    const element = window.MailmateObjects?.getElement(reference);
    if (!element || !result?.preview) return false;
    const ghost = element.cloneNode(true);
    const rect = element.getBoundingClientRect();
    ghost.className = `${element.className} kyle-calendar-ghost`;
    ghost.dataset.kylePreviewId = result.previewId;
    Object.assign(ghost.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', zIndex: '1800'
    });
    document.body.appendChild(ghost);
    const delta = Number(result.preview.deltaMinutes || 0) / 60 * 56;
    requestAnimationFrame(() => { ghost.style.transform = `translateY(${delta}px)`; });
    await wait(520);
    ghost.classList.add('is-settled');
    return true;
  }

  async function previewCreate(result) {
    const preview = result?.preview;
    const start = new Date(preview?.payload?.start);
    const end = new Date(preview?.payload?.end);
    if (!preview || Number.isNaN(start.getTime())) return false;
    const dayKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const grid = document.getElementById('calendarGrid');
    const column = grid?.querySelector(`[data-calendar-day="${dayKey}"]`);
    if (!column) return false;
    const startHour = Number(grid.dataset.startHour || 7);
    const minutes = start.getHours() * 60 + start.getMinutes() - startHour * 60;
    const durationMinutes = Math.max(30, (end - start) / 60000 || 60);
    const ghost = document.createElement('div');
    ghost.className = 'calendar-event-block source-ai kyle-calendar-create-ghost';
    ghost.dataset.kylePreviewId = result.previewId;
    ghost.style.top = `${Math.max(0, minutes / 60 * 56)}px`;
    ghost.style.height = `${Math.max(28, durationMinutes / 60 * 56 - 2)}px`;
    ghost.innerHTML = `<strong></strong><small>Preview</small>`;
    ghost.querySelector('strong').textContent = preview.payload.title;
    column.appendChild(ghost);
    requestAnimationFrame(() => ghost.classList.add('is-visible'));
    await wait(340);
    return true;
  }

  async function before(action) {
    caption(labelFor(action));
    if (action.tool === 'navigation.open') return navigate(action.args?.page);
    if (action.args?.reference) {
      await acquire(action.args.reference);
      await emphasizeSelection(action.args.reference);
      return true;
    }
    return wait(20);
  }

  async function after(action, result, observation) {
    document.querySelectorAll('.kyle-panel-leaving').forEach(panel => panel.classList.remove('kyle-panel-leaving'));
    if (action.tool === 'calendar.preview_move') await previewMove(action.args?.reference, result);
    if (action.tool === 'calendar.preview_create') await previewCreate(result);
    if (action.tool === 'calendar.commit_move' || action.tool === 'calendar.commit_create') {
      document.querySelector(`[data-kyle-preview-id="${action.args?.previewId}"]`)?.remove();
    }
    if (action.args?.reference) {
      await focus(action.args.reference);
      if (/open_email|open_event|work\.focus/.test(action.tool)) await reveal(action.args.reference);
    }
    const progress = observation?.satisfied ? 'Done.' : 'I could not verify that change.';
    window.dispatchEvent(new CustomEvent('kyle:action-progress', { detail: { action, progress, observation } }));
  }

  window.KyleMotion = { queue, caption, acquire, emphasizeSelection, navigate, focus, reveal, annotate, previewMove, previewCreate, before, after, wait, moveOrbTo, moveOrbHome };
})();
