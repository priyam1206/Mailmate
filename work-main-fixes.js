(function () {
  'use strict';

  if (window.__MAILMATE_WORK_MAIN_FIXES__) return;
  window.__MAILMATE_WORK_MAIN_FIXES__ = true;

  const previousFetch = window.fetch.bind(window);

  function requestUrl(input) {
    try {
      return new URL(
        typeof input === 'string' || input instanceof URL ? String(input) : input?.url,
        window.location.href
      );
    } catch (_) {
      return null;
    }
  }

  function requestMethod(input, init) {
    return String(init?.method || input?.method || 'GET').toUpperCase();
  }

  const workAwareFetch = function (input, init = {}) {
    const url = requestUrl(input);
    if (
      url &&
      url.pathname === '/api/work/jobs' &&
      requestMethod(input, init) === 'GET'
    ) {
      // Opening/polling Work is an explicit request for the current Work plane.
      // Reconcile every time so Overview cannot advertise Work-ready mail while
      // Work itself stays empty. Job IDs are deterministic server-side, so this
      // does not duplicate existing jobs.
      if (!url.searchParams.has('ensure')) url.searchParams.set('ensure', '1');
      if (!url.searchParams.has('reconcile')) url.searchParams.set('reconcile', '1');
      url.searchParams.set('_work_sync', String(Date.now()));

      if (typeof input === 'string' || input instanceof URL) {
        return previousFetch(url.toString(), { ...init, cache: 'no-store' });
      }

      try {
        const request = new Request(url.toString(), input);
        return previousFetch(request, { ...init, cache: 'no-store' });
      } catch (_) {
        return previousFetch(url.toString(), { ...init, cache: 'no-store' });
      }
    }

    return previousFetch(input, init);
  };

  workAwareFetch.__mailmateWorkMainFixes = true;
  workAwareFetch.__previousFetch = previousFetch;
  window.fetch = workAwareFetch;
})();
