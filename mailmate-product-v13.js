(function () {
  'use strict';

  if (window.__MAILMATE_PRODUCT_V13__) return;
  window.__MAILMATE_PRODUCT_V13__ = true;

  let heroObserver = null;
  let heroObservedNode = null;
  let heroRefreshQueued = false;
  let heroRefreshing = false;
  let canvasWrapped = false;
  let installAttempts = 0;

  function activePage() {
    return document.querySelector('.nav-tab.active[data-tab]')?.dataset.tab ||
      (document.getElementById('tab-overview')?.classList.contains('active') ? 'overview' : '');
  }

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function plainText(value) {
    return normalize(String(value || '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1'));
  }

  function resetEmailPromptPresentation() {
    if (activePage() === 'inbox') return;
    document.getElementById('mailmateEmailContextChip')?.remove();
    const input = document.querySelector('.prompt-input');
    if (!input) return;
    if (/this email/i.test(input.placeholder || '') || input.dataset.mailmateContextPlaceholder === '1') {
      input.placeholder = 'Ask Kyle anything...';
      delete input.dataset.mailmateContextPlaceholder;
    }
  }

  function syncCanvasChrome() {
    const overview = activePage() === 'overview';
    const canvasActive = Boolean(window.KyleCanvas?.isActive?.());
    const back = document.getElementById('kyleCanvasBack');
    const restore = document.getElementById('kyleCanvasRestore');
    if (back) back.hidden = !(overview && canvasActive);
    if (restore && !overview) restore.hidden = true;
  }

  function leaveCanvasWhenNavigating(page) {
    if (page === 'overview') return;
    if (window.KyleCanvas?.isActive?.()) window.KyleCanvas.restore?.();
    requestAnimationFrame(syncCanvasChrome);
  }

  function queueHeroRefresh() {
    if (heroRefreshQueued || heroRefreshing || activePage() !== 'overview') return;
    heroRefreshQueued = true;
    requestAnimationFrame(() => {
      heroRefreshQueued = false;
      if (activePage() !== 'overview') return;
      heroRefreshing = true;
      try {
        window.MailmateTimeAware?.refresh?.();
      } finally {
        queueMicrotask(() => { heroRefreshing = false; });
      }
    });
  }

  function installHeroGuard() {
    const copy = document.querySelector('#mailmateAiOverview .mailmate-ai-copy');
    if (!copy) return false;
    if (heroObservedNode === copy && heroObserver) return true;
    heroObserver?.disconnect();
    heroObservedNode = copy;
    heroObserver = new MutationObserver(() => {
      if (!heroRefreshing) queueHeroRefresh();
    });
    heroObserver.observe(copy, { childList: true, subtree: true, characterData: true });
    queueHeroRefresh();
    return true;
  }

  function findEmailReferenceBySubject(subject) {
    const target = plainText(subject).toLowerCase();
    if (!target) return null;
    const emails = window.Kyle?.store?.context?.emails || [];
    const email = emails.find(item => plainText(item?.subject).toLowerCase() === target);
    const id = email && String(email.id || email.gmail_id || email.message_id || '');
    if (!id) return null;
    return { type: 'email', id, label: email.subject || subject };
  }

  function parseRankedMailReply(reply, prompt) {
    const source = String(reply || '').replace(/\r/g, ' ').replace(/\n+/g, ' ');
    if (!source || !/\b(?:mail|email|inbox|important|priority|urgent)\b/i.test(`${prompt || ''} ${source}`)) return null;

    const cutoff = source.search(/\bI ranked these\b/i);
    const body = cutoff >= 0 ? source.slice(0, cutoff) : source;
    const pattern = /(?:^|\s)(\d{1,2})\.\s+(?:\*\*)?(.+?)(?:\*\*)?\s+(?:—|–|-)\s+(.+?)(?=(?:\s+\d{1,2}\.\s+(?:\*\*)?)|$)/g;
    const matches = [...body.matchAll(pattern)];
    if (matches.length < 2) return null;

    const items = matches.slice(0, 6).map(match => {
      const title = plainText(match[2]);
      let detail = plainText(match[3]);
      detail = detail.replace(/\s+(?:—|–|-)\s+/g, ' · ');
      return {
        title,
        detail,
        reference: findEmailReferenceBySubject(title)
      };
    }).filter(item => item.title);

    if (items.length < 2) return null;
    return {
      title: /\bimportant\b/i.test(prompt || '') ? 'The emails that matter most' : 'What I found',
      lede: `I found ${items.length} messages worth checking.`,
      highlights: [],
      sections: [{ heading: 'Priority mail', items }]
    };
  }

  function cleanCanvasPayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const next = { ...payload };
    const parsed = parseRankedMailReply(next.reply || next.text || '', next.prompt || '');
    if (parsed) {
      next.canvas = parsed;
      return next;
    }

    if (next.canvas && typeof next.canvas === 'object') {
      const canvas = { ...next.canvas };
      if (canvas.title) canvas.title = plainText(canvas.title);
      if (canvas.lede || canvas.subtitle) {
        const raw = canvas.lede || canvas.subtitle;
        canvas.lede = plainText(raw);
        delete canvas.subtitle;
      }
      if (Array.isArray(canvas.sections)) {
        canvas.sections = canvas.sections.map(section => ({
          ...section,
          heading: plainText(section?.heading),
          items: Array.isArray(section?.items) ? section.items.map(item => ({
            ...item,
            title: plainText(item?.title),
            detail: plainText(item?.detail || item?.body),
            meta: plainText(item?.meta)
          })) : []
        }));
      }
      next.canvas = canvas;
    }
    return next;
  }

  function installCanvasFormatter() {
    const api = window.KyleCanvas;
    if (!api?.prepare || canvasWrapped) return false;
    const original = api.prepare.bind(api);
    const wrapped = function (payload = {}) {
      return original(cleanCanvasPayload(payload));
    };
    wrapped.__mailmateV13 = true;
    api.prepare = wrapped;
    canvasWrapped = true;
    return true;
  }

  function installNavigationRules() {
    document.addEventListener('click', event => {
      const nav = event.target.closest('.nav-tab[data-tab]');
      if (!nav) return;
      const page = nav.dataset.tab || '';
      leaveCanvasWhenNavigating(page);
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'auto' });
        resetEmailPromptPresentation();
        syncCanvasChrome();
        if (page === 'overview') {
          installHeroGuard();
          queueHeroRefresh();
        }
      });
    }, true);
  }

  function boot() {
    installNavigationRules();
    resetEmailPromptPresentation();
    syncCanvasChrome();
    installHeroGuard();
    installCanvasFormatter();

    window.addEventListener('harness:context', () => {
      installHeroGuard();
      queueHeroRefresh();
      resetEmailPromptPresentation();
    });
    window.addEventListener('mailmate:context-changed', () => {
      installHeroGuard();
      queueHeroRefresh();
    });
    window.addEventListener('focus', () => {
      syncCanvasChrome();
      resetEmailPromptPresentation();
      if (activePage() === 'overview') queueHeroRefresh();
    }, { passive: true });

    const installer = setInterval(() => {
      installAttempts += 1;
      installHeroGuard();
      installCanvasFormatter();
      syncCanvasChrome();
      resetEmailPromptPresentation();
      if ((canvasWrapped && heroObservedNode) || installAttempts > 40) clearInterval(installer);
    }, 250);

    window.MailmatePresentationV13 = {
      refreshOverview: queueHeroRefresh,
      syncCanvasChrome,
      resetEmailPromptPresentation,
      version: 13
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
