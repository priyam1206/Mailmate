(function () {
  'use strict';

  if (window.__MAILMATE_INBOX_STABILITY_V2__) return;
  window.__MAILMATE_INBOX_STABILITY_V2__ = true;

  const READ_TTL_MS = 15 * 60 * 1000;
  const ORDER_KEY = () => `mailmate.inbox.order.v2.${String(localStorage.getItem('userId') || 'session').toLowerCase()}`;
  const READ_KEY = () => `mailmate.inbox.pending-read.v2.${String(localStorage.getItem('userId') || 'session').toLowerCase()}`;

  let stableOrder = [];
  let observer = null;
  let reconciling = false;
  let explicitSortUntil = 0;
  let explicitCaptureTimer = null;

  function list() {
    return document.getElementById('emailList');
  }

  function itemId(item) {
    return String(item?.dataset?.kyleId || '').trim();
  }

  function currentItems() {
    const host = list();
    return host ? [...host.querySelectorAll('.email-item[data-kyle-id]')] : [];
  }

  function currentIds() {
    return currentItems().map(itemId).filter(Boolean);
  }

  function loadOrder() {
    try {
      const value = JSON.parse(sessionStorage.getItem(ORDER_KEY()) || '[]');
      stableOrder = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    } catch (_) {
      stableOrder = [];
    }
  }

  function saveOrder() {
    try { sessionStorage.setItem(ORDER_KEY(), JSON.stringify(stableOrder.slice(0, 250))); } catch (_) {}
  }

  function captureOrder() {
    const ids = currentIds();
    if (!ids.length) return;
    stableOrder = ids;
    saveOrder();
  }

  function readMap() {
    try {
      const raw = JSON.parse(localStorage.getItem(READ_KEY()) || '{}');
      const now = Date.now();
      const clean = {};
      Object.entries(raw && typeof raw === 'object' ? raw : {}).forEach(([id, timestamp]) => {
        const time = Number(timestamp || 0);
        if (id && time && now - time < READ_TTL_MS) clean[id] = time;
      });
      localStorage.setItem(READ_KEY(), JSON.stringify(clean));
      return clean;
    } catch (_) {
      return {};
    }
  }

  function writeReadMap(map) {
    try { localStorage.setItem(READ_KEY(), JSON.stringify(map || {})); } catch (_) {}
  }

  function rememberRead(id) {
    id = String(id || '').trim();
    if (!id) return;
    const map = readMap();
    map[id] = Date.now();
    writeReadMap(map);
    patchSessionSnapshot(id);
    patchKyleContext(id);
    paintReadState();
  }

  function clearRememberedRead(id) {
    const map = readMap();
    if (!map[id]) return;
    delete map[id];
    writeReadMap(map);
  }

  function isRememberedRead(id) {
    return Boolean(readMap()[String(id || '')]);
  }

  function patchObjectReadState(value, pending = readMap()) {
    if (!value || typeof value !== 'object') return false;
    let changed = false;

    if (Array.isArray(value)) {
      value.forEach(item => { if (patchObjectReadState(item, pending)) changed = true; });
      return changed;
    }

    const id = String(value.id || value.gmail_id || value.message_id || '').trim();
    if (id && pending[id]) {
      // Once Gmail itself reports the message as read, the temporary overlay is
      // no longer needed. Until then, hide stale cached UNREAD state.
      if (value.is_read === true || (Array.isArray(value.labels) && !value.labels.includes('UNREAD'))) {
        delete pending[id];
      } else if ('is_read' in value || 'gmail_id' in value || Array.isArray(value.labels)) {
        value.is_read = true;
        if (Array.isArray(value.labels)) value.labels = value.labels.filter(label => String(label).toUpperCase() !== 'UNREAD');
        changed = true;
      }
    }

    Object.keys(value).forEach(key => {
      if (value[key] && typeof value[key] === 'object' && patchObjectReadState(value[key], pending)) changed = true;
    });
    return changed;
  }

  function patchSessionSnapshot(id) {
    const userId = String(localStorage.getItem('userId') || 'anonymous');
    const key = `mailmate.dashboard.${userId}`;
    try {
      const snapshot = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!snapshot?.data) return;
      const pending = { [id]: Date.now() };
      patchObjectReadState(snapshot.data, pending);
      sessionStorage.setItem(key, JSON.stringify(snapshot));
    } catch (_) {}
  }

  function patchKyleContext(id) {
    const context = window.Kyle?.store?.context;
    if (!context || typeof context !== 'object') return;
    const pending = { [id]: Date.now() };
    patchObjectReadState(context, pending);
  }

  function paintReadState() {
    const pending = readMap();
    currentItems().forEach(item => {
      const id = itemId(item);
      if (!id || !pending[id]) return;
      item.classList.remove('is-unread');
      item.setAttribute('data-mailmate-read-overlay', '1');
    });
  }

  function disableLegacySortObserver() {
    const host = list();
    if (!host) return;
    const legacy = host.__mailmateSearchObserver;
    if (legacy && typeof legacy.disconnect === 'function' && !legacy.__mailmateDisabled) {
      try { legacy.disconnect(); } catch (_) {}
    }
    // Keep this truthy so ensureInboxTools() does not recreate the old observer
    // every time the user returns to Inbox.
    host.__mailmateSearchObserver = {
      __mailmateDisabled: true,
      disconnect() {}
    };
  }

  function stopBackgroundAnimation() {
    const host = list();
    if (!host) return;
    if (Date.now() >= explicitSortUntil) host.classList.remove('mailmate-results-arrive');
  }

  function reconcileOrder() {
    if (reconciling || Date.now() < explicitSortUntil) return;
    const host = list();
    const items = currentItems();
    if (!host || !items.length) return;

    disableLegacySortObserver();
    paintReadState();
    stopBackgroundAnimation();

    const ids = items.map(itemId).filter(Boolean);
    if (!stableOrder.length) {
      stableOrder = ids;
      saveOrder();
      return;
    }

    const present = new Set(ids);
    const known = new Set(stableOrder);
    // Background sync may add genuinely new mail. Put only the new rows at the
    // top; never reshuffle existing rows because an unread/AI score changed.
    const newIds = ids.filter(id => !known.has(id));
    const desired = [
      ...newIds,
      ...stableOrder.filter(id => present.has(id)),
      ...ids.filter(id => !newIds.includes(id) && !stableOrder.includes(id))
    ];

    const byId = new Map(items.map(item => [itemId(item), item]));
    const same = desired.length === ids.length && desired.every((id, index) => id === ids[index]);
    stableOrder = desired;
    saveOrder();
    if (same) return;

    // MutationObserver callbacks run before the browser paints. Reordering here
    // prevents the server-order -> smart-order flash visible during background sync.
    reconciling = true;
    const fragment = document.createDocumentFragment();
    desired.forEach(id => {
      const item = byId.get(id);
      if (item) fragment.appendChild(item);
    });
    host.appendChild(fragment);
    reconciling = false;
  }

  function scheduleExplicitCapture(delay = 130) {
    clearTimeout(explicitCaptureTimer);
    explicitCaptureTimer = setTimeout(() => {
      captureOrder();
      paintReadState();
      const host = list();
      setTimeout(() => host?.classList.remove('mailmate-results-arrive'), 220);
    }, delay);
  }

  function allowExplicitSort(duration = 500) {
    explicitSortUntil = Date.now() + duration;
    scheduleExplicitCapture(Math.min(180, duration - 40));
  }

  function installStableObserver() {
    const host = list();
    if (!host) return false;
    disableLegacySortObserver();
    if (observer) return true;

    observer = new MutationObserver(() => {
      if (reconciling) return;
      disableLegacySortObserver();
      paintReadState();
      stopBackgroundAnimation();
      reconcileOrder();
    });
    observer.observe(host, { childList: true });

    // Let the original Smart priority sorter establish its first ordering once,
    // then freeze that ordering until the user explicitly chooses another sort.
    setTimeout(() => {
      disableLegacySortObserver();
      if (!stableOrder.length) captureOrder();
      reconcileOrder();
    }, 260);
    return true;
  }

  function installReadPersistenceFetch() {
    if (window.fetch.__mailmateReadPersistenceV2) return;
    const inheritedFetch = window.fetch.bind(window);

    const wrapped = async function (input, init = {}) {
      let url = null;
      try { url = new URL(typeof input === 'string' ? input : input?.url, window.location.href); } catch (_) {}
      const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
      const readMatch = url?.pathname?.match(/^\/api\/gmail\/messages\/([^/]+)\/read$/);

      const response = await inheritedFetch(input, init);

      if (readMatch && method === 'POST') {
        if (response.ok) {
          rememberRead(decodeURIComponent(readMatch[1]));
        }
        return response;
      }

      const shouldOverlay = response.ok && method === 'GET' && url && (
        url.pathname === '/api/dashboard/overview' ||
        /^\/api\/gmail\/messages\//.test(url.pathname)
      );
      if (!shouldOverlay || !(response.headers.get('content-type') || '').includes('application/json')) return response;

      try {
        const payload = await response.clone().json();
        const pending = readMap();
        const changed = patchObjectReadState(payload, pending);
        writeReadMap(pending);
        if (!changed) return response;
        const headers = {};
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== 'content-length') headers[key] = value;
        });
        headers['Content-Type'] = 'application/json';
        headers['Cache-Control'] = 'no-store';
        return new Response(JSON.stringify(payload), {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      } catch (_) {
        return response;
      }
    };

    wrapped.__mailmateReadPersistenceV2 = true;
    window.fetch = wrapped;
  }

  // Explicit sorting/searching is the only time the UI is allowed to visibly
  // reorder/fade. Merely opening mail or background syncing stays motionless.
  document.addEventListener('pointerdown', event => {
    if (event.target.closest('#mailmateSortMenu [data-sort]')) {
      allowExplicitSort(520);
      return;
    }
    if (event.target.closest('#mailmateSearchToggle, #mailmateSearchClose')) {
      allowExplicitSort(320);
    }
  }, true);

  document.addEventListener('input', event => {
    if (event.target?.id === 'mailmateInboxSearch') allowExplicitSort(260);
  }, true);

  // When a message is opened, freeze the exact current order immediately.
  document.addEventListener('pointerdown', event => {
    if (event.target.closest('#emailList .email-item[data-kyle-id]')) captureOrder();
  }, true);

  loadOrder();
  installReadPersistenceFetch();

  if (!installStableObserver()) {
    const bootObserver = new MutationObserver(() => {
      if (installStableObserver()) bootObserver.disconnect();
    });
    bootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Apply remembered read-state to the same-session snapshot before Dashboard
  // paints it on a reload. This avoids the purple unread dot flashing back first.
  Object.keys(readMap()).forEach(patchSessionSnapshot);
})();