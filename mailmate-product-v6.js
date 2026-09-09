(function () {
  'use strict';

  if (window.__MAILMATE_PRODUCT_V6__) return;
  window.__MAILMATE_PRODUCT_V6__ = true;

  const NETWORK_FETCH = window.fetch.bind(window);
  const inflight = new Map();
  const responseCache = new Map();
  const watchers = [];

  function loadStyles() {
    if (document.querySelector('link[data-mailmate-product-v6]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './mailmate-product-v6.css?v=1';
    link.dataset.mailmateProductV6 = '1';
    document.head.appendChild(link);
  }

  function methodOf(init, input) {
    return String(init?.method || input?.method || 'GET').toUpperCase();
  }

  function requestUrl(input) {
    try {
      return new URL(typeof input === 'string' ? input : input?.url, window.location.href);
    } catch (_) {
      return null;
    }
  }

  function cachePolicy(url) {
    const path = url.pathname;
    if (path === '/api/dashboard/overview') return 45000;
    if (path === '/api/calendar/events') return 45000;
    if (path === '/api/automations') return 30000;
    if (path === '/api/health') return 30000;
    if (path === '/api/work/settings') return 30000;
    if (path === '/api/work/jobs') return 18000;
    return 0;
  }

  function isExplicitRefresh(url) {
    return url.searchParams.get('refresh') === 'true'
      || url.searchParams.has('_')
      || url.searchParams.has('ts')
      || Date.now() < Number(window.__mailmateForceRefreshUntil || 0);
  }

  function normalizedKey(url) {
    const copy = new URL(url.href);
    copy.searchParams.delete('_');
    copy.searchParams.delete('ts');
    const sorted = [...copy.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
    copy.search = '';
    for (const [key, value] of sorted) copy.searchParams.append(key, value);
    return `${copy.pathname}?${copy.searchParams.toString()}`;
  }

  function clearCacheByPrefix(prefixes) {
    for (const key of responseCache.keys()) {
      if (prefixes.some(prefix => key.startsWith(prefix))) responseCache.delete(key);
    }
  }

  function invalidateForWrite(url) {
    const path = url.pathname;
    if (path.startsWith('/api/calendar/')) {
      clearCacheByPrefix(['/api/calendar/events?', '/api/dashboard/overview?']);
    }
    if (path.startsWith('/api/gmail/') || path.startsWith('/api/mail/')) {
      clearCacheByPrefix(['/api/dashboard/overview?']);
    }
    if (path.startsWith('/api/work/')) {
      clearCacheByPrefix(['/api/work/jobs?', '/api/dashboard/overview?']);
    }
    if (path.startsWith('/api/automations')) {
      clearCacheByPrefix(['/api/automations?', '/api/work/jobs?', '/api/dashboard/overview?']);
    }
  }

  async function brokeredFetch(input, init = {}) {
    const url = requestUrl(input);
    if (!url) return NETWORK_FETCH(input, init);
    const method = methodOf(init, input);

    if (method !== 'GET') {
      invalidateForWrite(url);
      return NETWORK_FETCH(input, init);
    }

    const ttl = cachePolicy(url);
    if (!ttl) return NETWORK_FETCH(input, init);

    const key = normalizedKey(url);
    const force = isExplicitRefresh(url);
    const now = Date.now();

    if (!force) {
      const cached = responseCache.get(key);
      if (cached && now - cached.savedAt < ttl) {
        try { return cached.response.clone(); } catch (_) { responseCache.delete(key); }
      }
    }

    if (inflight.has(key)) {
      const master = await inflight.get(key);
      return master.clone();
    }

    const pending = NETWORK_FETCH(input, init).then(response => {
      const master = response.clone();
      if (response.ok) {
        responseCache.set(key, { savedAt: Date.now(), response: master.clone() });
      }
      return master;
    }).finally(() => inflight.delete(key));

    inflight.set(key, pending);
    const master = await pending;
    return master.clone();
  }

  brokeredFetch.__mailmateProductV6 = true;
  window.fetch = brokeredFetch;

  // Manual refresh remains truly manual and bypasses the quiet cache window.
  document.addEventListener('click', event => {
    if (event.target.closest('#refreshBtn, #calendarTodayBtn, #calendarPrevBtn, #calendarNextBtn')) {
      window.__mailmateForceRefreshUntil = Date.now() + 1800;
    }
  }, true);

  // Background re-renders are common. Only animate when the data actually changed,
  // not every time the same cached DOM is rebuilt.
  function signature(node) {
    if (!node) return '';
    const text = String(node.innerText || '').replace(/\s+/g, ' ').trim();
    const ids = [...node.querySelectorAll('[data-kyle-id], [data-calendar-event], [data-job-id]')]
      .slice(0, 80)
      .map(el => el.dataset.kyleId || el.dataset.calendarEvent || el.dataset.jobId || '')
      .join('|');
    return `${text.slice(0, 5000)}::${ids}`;
  }

  function animateQuietly(node) {
    if (!node || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    node.classList.remove('mailmate-quiet-update');
    void node.offsetWidth;
    node.classList.add('mailmate-quiet-update');
    window.setTimeout(() => node.classList.remove('mailmate-quiet-update'), 220);
  }

  function watchSurface(selector) {
    const node = document.querySelector(selector);
    if (!node || node.dataset.mailmateQuietWatched === '1') return;
    node.dataset.mailmateQuietWatched = '1';
    let last = signature(node);
    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = signature(node);
        if (next && next !== last) {
          animateQuietly(node);
          last = next;
        }
      }, 90);
    });
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    watchers.push(observer);
  }

  function installQuietWatchers() {
    [
      '#mailmateAiOverview',
      '#attentionList',
      '#actionList',
      '#upcomingList',
      '#emailList',
      '#calendarAllDay',
      '#calendarGrid',
      '#workList'
    ].forEach(watchSurface);
  }

  // V4 keeps the open-email chip visible as a user cue. V6 removes that visual cue,
  // while leaving the underlying MailmateContext + current-email bridge untouched.
  function removeVisibleEmailChip() {
    const chip = document.getElementById('mailmateEmailContextChip');
    if (chip) chip.setAttribute('aria-hidden', 'true');
  }

  // Background Calendar refreshes should settle silently. Keep the most recent
  // successful sync timestamp visible but never flash "Syncing" in the toolbar.
  function quietCalendarStatus() {
    const status = document.getElementById('calendarSyncState');
    if (!status || status.dataset.mailmateQuietBound === '1') return;
    status.dataset.mailmateQuietBound = '1';
    const observer = new MutationObserver(() => {
      if (status.dataset.state === 'syncing') status.setAttribute('aria-label', 'Calendar updating in background');
      else if (status.dataset.state === 'ready') status.setAttribute('aria-label', status.textContent.trim());
    });
    observer.observe(status, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-state'] });
    watchers.push(observer);
  }

  function installDomRuntime() {
    installQuietWatchers();
    removeVisibleEmailChip();
    quietCalendarStatus();
  }

  // Dynamic surfaces are created after startup, so bind lazily without calling APIs.
  const domObserver = new MutationObserver(() => {
    clearTimeout(domObserver._timer);
    domObserver._timer = setTimeout(installDomRuntime, 120);
  });
  domObserver.observe(document.documentElement, { childList: true, subtree: true });
  watchers.push(domObserver);

  // Clear old response snapshots; they are only a short-lived API governor.
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of responseCache.entries()) {
      if (now - entry.savedAt > 120000) responseCache.delete(key);
    }
  }, 60000);

  loadStyles();
  installDomRuntime();
})();
