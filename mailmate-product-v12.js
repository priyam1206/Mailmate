(function () {
  'use strict';

  if (window.__MAILMATE_PRODUCT_V12__) return;
  window.__MAILMATE_PRODUCT_V12__ = true;
  window.__MAILMATE_OVERVIEW_SINGLE_OWNER__ = true;

  let fetchInstalled = false;
  let refreshFrame = 0;
  let adopted = false;

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
          // The old V4 generated briefing no longer owns the Overview headline.
          // Return the already-rendered deterministic headline instead of spending
          // an LLM request on text that V11 would immediately replace.
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

  function adoptHeroOnce() {
    if (adopted) return document.getElementById('mailmateAiOverview');
    const current = document.getElementById('mailmateAiOverview');
    if (!current) return null;

    // Clone exactly once to detach observers installed by older product layers.
    // Never observe the replacement: V11 itself writes attributes and children,
    // and observing those writes creates a feedback loop that can peg the UI
    // thread and leave the boot screen stuck indefinitely.
    const clone = current.cloneNode(true);
    clone.dataset.mailmateV12Owned = '1';
    clone.dataset.mailmateV11Owned = '1';
    clone.dataset.mailmateV10Owned = '1';
    clone.dataset.mailmateV8Owned = '1';
    clone.dataset.mailmateV7Observed = '1';
    clone.classList.remove('tone-urgent', 'tone-watch', 'tone-clear', 'is-loading', 'mailmate-quiet-update');
    current.replaceWith(clone);
    adopted = true;
    return clone;
  }

  function refreshRealtimeOverview() {
    adoptHeroOnce();
    window.MailmateTimeAware?.refresh?.();
  }

  function scheduleRefresh() {
    if (refreshFrame) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      refreshRealtimeOverview();
    });
  }

  function boot() {
    installBriefingGovernor();
    adoptHeroOnce();
    scheduleRefresh();

    // Refresh only from semantic data/context events. There are deliberately no
    // MutationObservers here. V11 already owns clock-based refresh and its own
    // guarded Upcoming rendering, so DOM mutations must never feed back into V12.
    window.addEventListener('harness:context', scheduleRefresh);
    window.addEventListener('mailmate:context-changed', scheduleRefresh);
    window.addEventListener('harness:calendar-refresh', scheduleRefresh);

    document.addEventListener('click', event => {
      if (event.target.closest('.nav-tab[data-tab="overview"]')) scheduleRefresh();
    }, true);

    window.MailmateOverviewOwner = {
      refresh: scheduleRefresh,
      version: 12,
      owner: 'realtime'
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
