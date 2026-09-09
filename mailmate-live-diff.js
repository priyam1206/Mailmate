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

  function loadSingleOwnerOverview() {
    if (window.__MAILMATE_PRODUCT_V12__ || document.querySelector('script[data-mailmate-product-v12]')) return;
    if (!window.__MAILMATE_PRODUCT_V9__) {
      setTimeout(loadSingleOwnerOverview, 20);
      return;
    }

    const loadV12 = () => {
      if (window.__MAILMATE_PRODUCT_V12__ || document.querySelector('script[data-mailmate-product-v12]')) return;
      const owner = document.createElement('script');
      owner.src = './mailmate-product-v12.js?v=1';
      owner.async = false;
      owner.dataset.mailmateProductV12 = '1';
      document.head.appendChild(owner);
    };

    if (window.__MAILMATE_PRODUCT_V11__) {
      loadV12();
      return;
    }

    const realtime = document.createElement('script');
    realtime.src = './mailmate-product-v11.js?v=2';
    realtime.async = false;
    realtime.dataset.mailmateProductV11 = '1';
    realtime.addEventListener('load', loadV12, { once: true });
    document.head.appendChild(realtime);
  }

  function boot() {
    snapshot(false);
    initialized = true;
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    loadSingleOwnerOverview();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
