(function () {
  'use strict';

  if (window.__MAILMATE_INBOX_STABILITY__) return;
  window.__MAILMATE_INBOX_STABILITY__ = true;

  let pinnedOrder = null;
  let pinnedUntil = 0;
  let restoring = false;
  let observer = null;

  function inboxList() {
    return document.getElementById('emailList');
  }

  function ids(list = inboxList()) {
    if (!list) return [];
    return [...list.querySelectorAll('.email-item[data-kyle-id]')]
      .map(item => String(item.dataset.kyleId || ''))
      .filter(Boolean);
  }

  function clearPin() {
    pinnedOrder = null;
    pinnedUntil = 0;
  }

  function pinCurrentOrder() {
    const current = ids();
    if (!current.length) return;
    pinnedOrder = current;
    // Opening a message can cause an immediate read-state render and a second
    // render when the full Gmail body finishes loading. Keep both stable.
    pinnedUntil = Date.now() + 5000;
  }

  function restorePinnedOrder() {
    if (restoring || !pinnedOrder || Date.now() > pinnedUntil) {
      if (pinnedOrder && Date.now() > pinnedUntil) clearPin();
      return;
    }

    const list = inboxList();
    if (!list) return;
    const items = [...list.querySelectorAll('.email-item[data-kyle-id]')];
    if (!items.length) return;

    const byId = new Map(items.map(item => [String(item.dataset.kyleId || ''), item]));
    const desiredIds = [
      ...pinnedOrder.filter(id => byId.has(id)),
      ...items.map(item => String(item.dataset.kyleId || '')).filter(id => id && !pinnedOrder.includes(id))
    ];
    const currentIds = items.map(item => String(item.dataset.kyleId || ''));
    if (desiredIds.length === currentIds.length && desiredIds.every((id, index) => id === currentIds[index])) return;

    restoring = true;
    const fragment = document.createDocumentFragment();
    desiredIds.forEach(id => {
      const item = byId.get(id);
      if (item) fragment.appendChild(item);
    });
    list.appendChild(fragment);
    requestAnimationFrame(() => { restoring = false; });
  }

  function observeInbox() {
    const list = inboxList();
    if (!list || observer) return Boolean(list);
    observer = new MutationObserver(() => {
      if (restoring || !pinnedOrder) return;
      requestAnimationFrame(restorePinnedOrder);
    });
    observer.observe(list, { childList: true });
    return true;
  }

  // Capture the exact visible ordering before opening an email. Smart priority
  // may use unread state as a ranking signal, but merely reading an item should
  // never make the row jump away from the user's cursor.
  document.addEventListener('pointerdown', event => {
    if (event.target.closest('#emailList .email-item[data-kyle-id]')) {
      pinCurrentOrder();
      return;
    }

    // Explicit view changes are allowed to reorder immediately.
    if (event.target.closest('#mailmateInboxTools, #tab-inbox .filter-tab, #refreshBtn')) {
      clearPin();
    }
  }, true);

  // Keyboard opening gets the same stability behavior.
  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('#emailList .email-item[data-kyle-id]')) {
      pinCurrentOrder();
    }
  }, true);

  if (!observeInbox()) {
    const boot = new MutationObserver(() => {
      if (observeInbox()) boot.disconnect();
    });
    boot.observe(document.documentElement, { childList: true, subtree: true });
  }
})();