(function () {
  'use strict';

  if (window.__MAILMATE_PRODUCT_V8__) return;
  window.__MAILMATE_PRODUCT_V8__ = true;

  const priorFetch = window.fetch.bind(window);
  const pendingChanges = new Set();
  const voiceCache = new Map();
  const VOICE_CACHE_MAX = 16;
  let firstOverviewResolved = false;
  let overviewFingerprints = null;
  let calendarFingerprint = '';
  let workFingerprint = '';
  let ownedHero = null;
  let heroObserver = null;
  let domTimer = null;

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function legacyHeroDisabled() {
    return Boolean(window.__MAILMATE_PRODUCT_V11__ || window.__MAILMATE_OVERVIEW_SINGLE_OWNER__);
  }

  function stableJson(value) {
    try { return JSON.stringify(value); } catch (_) { return String(value || ''); }
  }

  function hashOverview(data) {
    const attention = (data?.needs_attention || []).map(item => [
      item.source_message_id || item.message_id || item.email_id || item.id || item.subject,
      item.deadline || '', item.description || item.reason || ''
    ]);
    const waiting = (data?.waiting_on_others || []).map(item => [
      item.source_message_id || item.message_id || item.email_id || item.id || item.subject,
      item.description || item.reason || ''
    ]);
    const emails = (data?.emails || []).map(email => [
      email.id || email.gmail_id || email.message_id,
      email.is_read, email.is_important, email.is_starred,
      email.subject, email.date || email.timestamp || email.internal_date
    ]);
    return {
      attention: stableJson(attention),
      waiting: stableJson(waiting),
      emails: stableJson(emails)
    };
  }

  function markChanged(name) {
    pendingChanges.add(name);
    clearTimeout(domTimer);
    domTimer = setTimeout(applyPendingChanges, 0);
  }

  function pulse(selector) {
    const node = document.querySelector(selector);
    if (!node) return;
    node.classList.remove('mailmate-live-change');
    void node.offsetWidth;
    node.classList.add('mailmate-live-change');
    setTimeout(() => node.classList.remove('mailmate-live-change'), 280);
  }

  function applyPendingChanges() {
    if (pendingChanges.has('attention')) pulse('#attentionList');
    if (pendingChanges.has('waiting')) pulse('#waitingList');
    if (pendingChanges.has('emails')) pulse('#emailList');
    if (pendingChanges.has('calendar')) {
      pulse('#upcomingList');
      pulse('#calendarGrid');
      pulse('#calendarAllDay');
    }
    if (pendingChanges.has('work')) {
      pulse('#actionList');
      pulse('#workList');
    }
    if (pendingChanges.size && !legacyHeroDisabled()) {
      setTimeout(() => {
        takeOwnershipOfHero();
        paintHeadline();
      }, 20);
    }
    pendingChanges.clear();
  }

  function showInitialLoading() {
    const overview = document.getElementById('tab-overview');
    if (!overview || document.getElementById('mailmateInitialLoader')) return;
    document.body.classList.add('mailmate-initial-loading');
    const loader = document.createElement('div');
    loader.id = 'mailmateInitialLoader';
    loader.className = 'mailmate-initial-loader';
    loader.innerHTML = '<span>Loading</span><i></i><i></i><i></i>';
    const data = document.getElementById('overviewDataSurface');
    if (data) data.insertAdjacentElement('beforebegin', loader);
    else overview.prepend(loader);
  }

  function finishInitialLoading() {
    if (firstOverviewResolved) return;
    firstOverviewResolved = true;
    const loader = document.getElementById('mailmateInitialLoader');
    loader?.classList.add('is-done');
    document.body.classList.remove('mailmate-initial-loading');
    document.body.classList.add('mailmate-live-ready');
    const reveal = [document.querySelector('.mailmate-ai-overview'), document.getElementById('overviewDataSurface')].filter(Boolean);
    reveal.forEach(node => {
      node.classList.remove('mailmate-initial-reveal');
      void node.offsetWidth;
      node.classList.add('mailmate-initial-reveal');
    });
    setTimeout(() => loader?.remove(), 260);
    if (!legacyHeroDisabled()) {
      setTimeout(() => {
        takeOwnershipOfHero();
        paintHeadline();
      }, 30);
    }
  }

  function readBody(init) {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : null; }
    catch (_) { return null; }
  }

  function cloneCachedVoice(entry) {
    entry.lastUsed = Date.now();
    const headers = new Headers(entry.headers || {});
    headers.set('X-MailMate-Voice-Cache', 'HIT');
    return new Response(entry.buffer.slice(0), {
      status: entry.status || 200,
      statusText: entry.statusText || 'OK',
      headers
    });
  }

  function storeVoice(key, response) {
    response.clone().arrayBuffer().then(buffer => {
      if (!buffer?.byteLength) return;
      voiceCache.set(key, {
        buffer,
        headers: [...response.headers.entries()],
        status: response.status,
        statusText: response.statusText,
        lastUsed: Date.now()
      });
      while (voiceCache.size > VOICE_CACHE_MAX) {
        const oldest = [...voiceCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
        if (!oldest) break;
        voiceCache.delete(oldest[0]);
      }
    }).catch(() => {});
  }

  window.fetch = async function (input, init = {}) {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input?.url, window.location.href); }
    catch (_) { return priorFetch(input, init); }

    const method = String(init.method || input?.method || 'GET').toUpperCase();

    if (method === 'POST' && url.pathname === '/api/voice/speak') {
      const body = readBody(init) || {};
      const text = normalize(body.text || '');
      const key = text ? stableJson({ text, voice: body.voice_id || '', model: body.model || '' }) : '';
      if (key && voiceCache.has(key)) return cloneCachedVoice(voiceCache.get(key));
      const response = await priorFetch(input, init);
      if (key && response.ok) storeVoice(key, response);
      return response;
    }

    const response = await priorFetch(input, init);

    if (method === 'GET' && url.pathname === '/api/dashboard/overview' && response.ok) {
      try {
        const payload = await response.clone().json();
        const next = hashOverview(payload);
        if (!overviewFingerprints) {
          overviewFingerprints = next;
          setTimeout(finishInitialLoading, 0);
        } else {
          if (next.attention !== overviewFingerprints.attention) markChanged('attention');
          if (next.waiting !== overviewFingerprints.waiting) markChanged('waiting');
          if (next.emails !== overviewFingerprints.emails) markChanged('emails');
          overviewFingerprints = next;
        }
      } catch (_) {}
    }

    if (method === 'GET' && url.pathname === '/api/calendar/events' && response.ok) {
      try {
        const payload = await response.clone().json();
        const next = stableJson((Array.isArray(payload) ? payload : []).map(event => [event.id, event.title, event.start, event.end, event.conflict]));
        if (calendarFingerprint && next !== calendarFingerprint) markChanged('calendar');
        calendarFingerprint = next;
      } catch (_) {}
    }

    if (method === 'GET' && url.pathname === '/api/work/jobs' && response.ok) {
      try {
        const payload = await response.clone().json();
        const next = stableJson((Array.isArray(payload) ? payload : []).map(job => [job.id, job.status, job.current_step]));
        if (workFingerprint && next !== workFingerprint) markChanged('work');
        workFingerprint = next;
      } catch (_) {}
    }

    return response;
  };
  window.fetch.__mailmateProductV8 = true;

  function dateOf(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatWhen(date) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const label = date.toDateString() === now.toDateString()
      ? 'Today'
      : date.toDateString() === tomorrow.toDateString()
        ? 'Tomorrow'
        : date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `${label} · ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }

  function cleanHeadlineTitle(value) {
    return normalize(value)
      .replace(/^URGENT:\s*/i, '')
      .replace(/^IMPORTANT:\s*/i, '')
      .replace(/\s+-\s+TH$/i, ' – TH');
  }

  function eventScore(event, start, now) {
    const text = normalize(event?.title).toLowerCase();
    const hours = Math.max(0, (start.getTime() - now) / 3600000);
    let score = 0;
    if (event?.conflict) score += 95;
    if (/\bmandatory\b/.test(text)) score += 150;
    if (/\bremedial\b/.test(text)) score += 135;
    if (/\burgent\b/.test(text)) score += 120;
    if (/\b(?:exam|submission|deadline|interview)\b/.test(text)) score += 105;
    if (event?.source === 'deadline') score += 55;
    if (hours <= 3) score += 28;
    else if (hours <= 8) score += 20;
    else if (hours <= 24) score += 12;
    else score -= Math.min(30, hours / 12);
    return score;
  }

  function deriveHeadline() {
    const context = window.Kyle?.store?.context || {};
    const now = Date.now();
    const emails = Array.isArray(context.emails) ? context.emails : [];
    const byId = new Map(emails.map(email => [String(email.id || email.gmail_id || email.message_id || ''), email]));
    const attention = (Array.isArray(context.needs_attention) ? context.needs_attention : []).map(item => {
      const id = String(item.source_message_id || item.message_id || item.email_id || item.id || '');
      if (byId.get(id)?.is_read === true) return null;
      const deadline = dateOf(item.deadline);
      const text = `${item.subject || item.title || ''} ${item.description || item.reason || ''}`.toLowerCase();
      let score = /\b(?:urgent|asap|immediately|mandatory|action required|due today)\b/.test(text) ? 190 : 0;
      if (deadline && deadline.getTime() >= now) {
        const h = (deadline.getTime() - now) / 3600000;
        if (h <= 6) score += 100;
        else if (h <= 24) score += 55;
      }
      return { title: cleanHeadlineTitle(item.subject || item.title || item.description || 'Needs attention'), when: deadline, score, tone: score >= 190 ? 'urgent' : 'watch' };
    }).filter(Boolean);

    const events = (Array.isArray(context.calendarEvents) ? context.calendarEvents : Array.isArray(context.calendar_events) ? context.calendar_events : [])
      .map(event => ({ event, start: dateOf(event.start) }))
      .filter(entry => entry.start && entry.start.getTime() >= now - 5 * 60000 && entry.start.getTime() <= now + 48 * 3600000)
      .map(entry => ({
        title: cleanHeadlineTitle(entry.event.title || 'Upcoming event'),
        when: entry.start,
        score: eventScore(entry.event, entry.start, now),
        tone: entry.event.conflict || /\b(?:mandatory|remedial|urgent|exam|submission|deadline)\b/i.test(entry.event.title || '') ? 'watch' : 'neutral'
      }));

    const candidates = [...attention, ...events].sort((a, b) => b.score - a.score || ((a.when?.getTime() || Infinity) - (b.when?.getTime() || Infinity)));
    const best = candidates[0];
    if (!best) return { title: 'You’re clear for now.', when: null, tone: 'clear' };
    return best;
  }

  function takeOwnershipOfHero() {
    const current = document.getElementById('mailmateAiOverview');
    if (legacyHeroDisabled()) return current;
    let card = current;
    if (!card) return null;
    if (card.dataset.mailmateV8Owned === '1') return card;
    const clone = card.cloneNode(true);
    clone.dataset.mailmateV8Owned = '1';
    clone.dataset.mailmateV7Observed = '1';
    card.replaceWith(clone);
    ownedHero = clone;
    heroObserver?.disconnect();
    heroObserver = new MutationObserver(() => {
      clearTimeout(domTimer);
      domTimer = setTimeout(paintHeadline, 0);
    });
    heroObserver.observe(clone, { childList: true, subtree: true, characterData: true });
    return clone;
  }

  function paintHeadline() {
    if (legacyHeroDisabled()) return;
    const card = takeOwnershipOfHero() || ownedHero;
    const copy = card?.querySelector('.mailmate-ai-copy');
    if (!card || !copy) return;
    const hero = deriveHeadline();
    if (card.dataset.mailmateV8Tone !== hero.tone) card.dataset.mailmateV8Tone = hero.tone;
    if (card.dataset.mailmateV7Tone !== hero.tone) card.dataset.mailmateV7Tone = hero.tone;
    if (card.classList.contains('is-loading')) card.classList.remove('is-loading');
    const html = hero.when
      ? `<span class="mailmate-headline-title">${escapeHtml(hero.title)}</span><span class="mailmate-headline-time">${escapeHtml(formatWhen(hero.when))}</span>`
      : `<span class="mailmate-headline-title">${escapeHtml(hero.title)}</span>`;
    if (copy.innerHTML !== html) copy.innerHTML = html;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function canvasStorageKey() {
    let user = 'session';
    try { user = localStorage.getItem('userId') || user; } catch (_) {}
    return `mailmate.kyle.canvas.v1.${String(user).toLowerCase()}`;
  }

  function clearPersistedCanvasHistory() {
    try { sessionStorage.removeItem(canvasStorageKey()); } catch (_) {}
  }

  function resetCanvasHistoryOnLoad() {
    clearPersistedCanvasHistory();
    const canvas = window.KyleCanvas;
    if (canvas?.state && !canvas.state.active && !canvas.state.pending) {
      canvas.state.history = [];
      canvas.state.lastResult = null;
      const restore = document.getElementById('kyleCanvasRestore');
      if (restore) restore.hidden = true;
    }
  }

  function alignRestoreButton() {
    const button = document.getElementById('kyleCanvasRestore');
    const shell = document.querySelector('#kyleOverviewHome .kyle-shell, #kyleOverviewHome .prompt-shell, #kyleOverviewHome .kyle-widget');
    if (!button || !shell || button.hidden) return;
    const rect = shell.getBoundingClientRect();
    button.style.left = `${rect.left + rect.width / 2}px`;
    button.style.bottom = `${Math.max(76, window.innerHeight - rect.top + 8)}px`;
  }

  function syncCanvasChrome() {
    const active = Boolean(window.KyleCanvas?.state?.active);
    document.body.classList.toggle('mailmate-canvas-expanded', active);
    const back = document.getElementById('kyleCanvasBack');
    if (back && back.parentElement !== document.body) document.body.appendChild(back);
    if (back) back.hidden = !active;
    alignRestoreButton();
  }

  function installRestoreTransition() {
    const button = document.getElementById('kyleCanvasRestore');
    if (!button || button.dataset.mailmateV8Bound === '1') return;
    button.dataset.mailmateV8Bound = '1';
    button.setAttribute('aria-label', 'Reopen last answer');
    button.title = 'Reopen last answer';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (button.hidden) return;
      document.body.classList.add('mailmate-canvas-opening');
      button.hidden = true;
      setTimeout(() => {
        window.KyleCanvas?.reopen?.();
        syncCanvasChrome();
      }, 150);
      setTimeout(() => document.body.classList.remove('mailmate-canvas-opening'), 380);
    }, true);
  }

  function installBackButton() {
    const back = document.getElementById('kyleCanvasBack');
    if (!back || back.dataset.mailmateV8Bound === '1') return;
    back.dataset.mailmateV8Bound = '1';
    if (back.parentElement !== document.body) document.body.appendChild(back);
    back.addEventListener('click', () => setTimeout(syncCanvasChrome, 0));
  }

  function observeUi() {
    const observer = new MutationObserver(() => {
      clearTimeout(domTimer);
      domTimer = setTimeout(() => {
        installRestoreTransition();
        installBackButton();
        syncCanvasChrome();
        if (!legacyHeroDisabled()) {
          takeOwnershipOfHero();
          paintHeadline();
        }
      }, 0);
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    showInitialLoading();
    resetCanvasHistoryOnLoad();
    installRestoreTransition();
    installBackButton();
    syncCanvasChrome();
    if (!legacyHeroDisabled()) {
      takeOwnershipOfHero();
      paintHeadline();
    }
    observeUi();
    window.addEventListener('resize', alignRestoreButton, { passive: true });
    window.addEventListener('pagehide', clearPersistedCanvasHistory);
    window.addEventListener('beforeunload', clearPersistedCanvasHistory);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
