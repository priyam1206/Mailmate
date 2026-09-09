(function () {
  'use strict';

  if (window.__MAILMATE_PRODUCT_V12__) return;
  window.__MAILMATE_PRODUCT_V12__ = true;
  window.__MAILMATE_OVERVIEW_SINGLE_OWNER__ = true;

  let heroObserver = null;
  let upcomingObserver = null;
  let reconcileQueued = false;
  let fetchInstalled = false;

  function parseBody(init) {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : null; }
    catch (_) { return null; }
  }

  function visibleHeadline() {
    return String(document.querySelector('#mailmateAiOverview .mailmate-ai-copy')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function installBriefingGovernor() {
    if (fetchInstalled || window.fetch.__mailmateOverviewSingleOwner) return;
    fetchInstalled = true;
    const priorFetch = window.fetch.bind(window);

    const wrapped = async function (input, init = {}) {
      let url;
      try { url = new URL(typeof input === 'string' ? input : input?.url, window.location.href); }
      catch (_) { return priorFetch(input, init); }

      if (url.pathname === '/api/kyle/agent' && String(init.method || input?.method || 'GET').toUpperCase() === 'POST') {
        const payload = parseBody(init);
        if (payload?.uiContext?.briefingOnly) {
          // V4's legacy AI briefing is superseded by the deterministic realtime
          // headline. Do not spend an LLM request on a surface V11 owns.
          const text = visibleHeadline() || 'Workspace ready.';
          return new Response(JSON.stringify({ reply: text, text, superseded: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
          });
        }
      }

      return priorFetch(input, init);
    };

    wrapped.__mailmateOverviewSingleOwner = true;
    window.fetch = wrapped;
  }

  function adoptHero() {
    const current = document.getElementById('mailmateAiOverview');
    if (!current) return null;
    if (current.dataset.mailmateV12Owned === '1') return current;

    // Replacing the node detaches legacy V6/V7/V8 MutationObservers that were
    // attached directly to the old hero. V12 + V11 are the only active owners.
    const clone = current.cloneNode(true);
    clone.dataset.mailmateV12Owned = '1';
    clone.dataset.mailmateV11Owned = '1';
    clone.dataset.mailmateV10Owned = '1';
    clone.dataset.mailmateV8Owned = '1';
    clone.dataset.mailmateV7Observed = '1';
    current.replaceWith(clone);

    heroObserver?.disconnect();
    heroObserver = new MutationObserver(() => queueReconcile());
    heroObserver.observe(clone, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'data-mailmate-v7-tone', 'data-mailmate-v8-tone', 'data-mailmate-v10-tone']
    });
    return clone;
  }

  function cleanLegacyHeroState(root) {
    if (!root) return;
    root.classList.remove('tone-urgent', 'tone-watch', 'tone-clear', 'is-loading', 'mailmate-quiet-update');
  }

  function reconcile() {
    const root = adoptHero();
    cleanLegacyHeroState(root);
    window.MailmateTimeAware?.refresh?.();
  }

  function queueReconcile() {
    if (reconcileQueued) return;
    reconcileQueued = true;
    queueMicrotask(() => {
      reconcileQueued = false;
      reconcile();
    });
  }

  function guardUpcoming() {
    const host = document.getElementById('upcomingList');
    if (!host || host.dataset.mailmateV12Guarded === '1') return;
    host.dataset.mailmateV12Guarded = '1';
    upcomingObserver?.disconnect();
    upcomingObserver = new MutationObserver(() => queueReconcile());
    upcomingObserver.observe(host, { childList: true, subtree: true, characterData: true });
  }

  function boot() {
    installBriefingGovernor();
    adoptHero();
    guardUpcoming();
    reconcile();

    window.addEventListener('harness:context', queueReconcile);
    window.addEventListener('mailmate:context-changed', queueReconcile);
    window.addEventListener('harness:calendar-refresh', queueReconcile);

    const bodyObserver = new MutationObserver(() => {
      adoptHero();
      guardUpcoming();
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    window.MailmateOverviewOwner = {
      refresh: reconcile,
      version: 12,
      owner: 'realtime'
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
