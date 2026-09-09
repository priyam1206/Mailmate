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

  function loadPresentationV13() {
    if (!document.querySelector('link[data-mailmate-product-v13]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = './mailmate-product-v13.css?v=1';
      style.dataset.mailmateProductV13 = '1';
      document.head.appendChild(style);
    }
    if (window.__MAILMATE_PRODUCT_V13__ || document.querySelector('script[data-mailmate-product-v13]')) return;
    const script = document.createElement('script');
    script.src = './mailmate-product-v13.js?v=1';
    script.async = false;
    script.dataset.mailmateProductV13 = '1';
    document.head.appendChild(script);
  }

  function loadSingleOwnerOverview() {
    if (window.__MAILMATE_PRODUCT_V12__) {
      loadPresentationV13();
      return;
    }
    if (document.querySelector('script[data-mailmate-product-v12]')) {
      setTimeout(loadSingleOwnerOverview, 20);
      return;
    }
    if (!window.__MAILMATE_PRODUCT_V9__) {
      setTimeout(loadSingleOwnerOverview, 20);
      return;
    }

    const loadV12 = () => {
      if (window.__MAILMATE_PRODUCT_V12__) {
        loadPresentationV13();
        return;
      }
      if (document.querySelector('script[data-mailmate-product-v12]')) return;
      const owner = document.createElement('script');
      owner.src = './mailmate-product-v12.js?v=2';
      owner.async = false;
      owner.dataset.mailmateProductV12 = '1';
      owner.addEventListener('load', loadPresentationV13, { once: true });
      document.head.appendChild(owner);
    };

    if (window.__MAILMATE_PRODUCT_V11__) {
      loadV12();
      return;
    }

    const realtime = document.createElement('script');
    realtime.src = './mailmate-product-v11.js?v=3';
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
