(function () {
  'use strict';

  if (window.__MAILMATE_LIVE_DIFF__) return;
  window.__MAILMATE_LIVE_DIFF__ = true;

  const selectors = [
    '#attentionList',
    '#waitingList',
    '#actionList',
    '#upcomingList',
    '#emailList',
    '#workList',
    '#calendarGrid',
    '#calendarAllDay'
  ];
  const fingerprints = new Map();
  let scheduled = false;
  let initialized = false;

  function fingerprint(node) {
    if (!node) return '';
    return String(node.innerHTML || '').replace(/\s+/g, ' ').trim();
  }

  function snapshot(animateChanges) {
    selectors.forEach(selector => {
      const node = document.querySelector(selector);
      if (!node) return;
      const next = fingerprint(node);
      const previous = fingerprints.get(selector);
      fingerprints.set(selector, next);
      if (!animateChanges || previous == null || previous === next) return;
      node.classList.remove('mailmate-live-change');
      void node.offsetWidth;
      node.classList.add('mailmate-live-change');
      setTimeout(() => node.classList.remove('mailmate-live-change'), 280);
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const canAnimate = initialized && document.body.classList.contains('mailmate-live-ready');
      snapshot(canAnimate);
      initialized = true;
    });
  }

  function loadRealtimeOverview() {
    if (window.__MAILMATE_PRODUCT_V11__ || document.querySelector('script[data-mailmate-product-v11]')) return;
    if (!window.__MAILMATE_PRODUCT_V9__) {
      setTimeout(loadRealtimeOverview, 20);
      return;
    }
    const script = document.createElement('script');
    script.src = './mailmate-product-v11.js?v=1';
    script.async = false;
    script.dataset.mailmateProductV11 = '1';
    document.head.appendChild(script);
  }

  function boot() {
    snapshot(false);
    initialized = true;
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    loadRealtimeOverview();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
