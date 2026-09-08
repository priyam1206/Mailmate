(function () {
  'use strict';

  if (window.__MAILMATE_PRODUCT_V7__) return;
  window.__MAILMATE_PRODUCT_V7__ = true;

  const priorFetch = window.fetch.bind(window);
  let suppressSurfaceCloseUntil = 0;
  let heroObserver = null;
  let domRefreshQueued = false;

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function messageId(email) {
    return String(email?.id || email?.gmail_id || email?.message_id || '');
  }

  function attentionId(item) {
    return String(item?.source_message_id || item?.message_id || item?.email_id || item?.id || '').trim();
  }

  function filterReadAttention(data) {
    if (!data || !Array.isArray(data.needs_attention) || !Array.isArray(data.emails)) return data;
    const emailById = new Map(data.emails.map(email => [messageId(email), email]).filter(([id]) => id));
    const filtered = data.needs_attention.filter(item => {
      const id = attentionId(item);
      if (!id) return true;
      const email = emailById.get(id);
      if (!email) return true;
      return email.is_read !== true;
    });
    if (filtered.length === data.needs_attention.length) return data;
    return {
      ...data,
      needs_attention: filtered,
      metrics: {
        ...(data.metrics || {}),
        needs_attention: filtered.length,
        attention: filtered.length
      }
    };
  }

  function rebuildJsonResponse(response, payload) {
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  function pruneAttentionContext(id) {
    id = String(id || '');
    if (!id) return;
    const context = window.Kyle?.store?.context;
    if (context && Array.isArray(context.needs_attention)) {
      context.needs_attention = context.needs_attention.filter(item => attentionId(item) !== id);
    }
  }

  function updateAttentionCounts() {
    const list = document.getElementById('attentionList');
    if (!list) return;
    const items = [...list.querySelectorAll('li[data-source-id]')];
    const count = items.length;
    const badge = document.getElementById('attentionBadge');
    const metric = document.getElementById('importantCount');
    const viewAll = document.getElementById('viewAllAttentionBtn');
    const viewAllCount = document.getElementById('viewAllAttentionCount');
    if (badge) badge.textContent = `${count} item${count === 1 ? '' : 's'}`;
    if (metric) metric.textContent = String(count);
    if (viewAll) viewAll.hidden = count <= 5;
    if (viewAllCount) viewAllCount.textContent = String(count);
    if (!count) {
      list.innerHTML = '<li class="overview-empty"><strong>Inbox clear</strong><span>Nothing unread needs your attention right now.</span></li>';
    }
  }

  function removeAttentionItem(id) {
    id = String(id || '');
    if (!id) return;
    pruneAttentionContext(id);
    const items = [...document.querySelectorAll('#attentionList li[data-source-id]')]
      .filter(item => String(item.dataset.sourceId || '') === id);
    if (!items.length) return;
    items.forEach(item => {
      item.classList.add('mailmate-attention-removing');
      window.setTimeout(() => {
        item.remove();
        updateAttentionCounts();
        refreshHero();
      }, 170);
    });
  }

  window.fetch = async function (input, init = {}) {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input?.url, window.location.href); }
    catch (_) { return priorFetch(input, init); }

    const method = String(init.method || 'GET').toUpperCase();
    const response = await priorFetch(input, init);

    if (method === 'GET' && url.pathname === '/api/dashboard/overview' && response.ok) {
      try {
        const payload = filterReadAttention(await response.clone().json());
        return rebuildJsonResponse(response, payload);
      } catch (_) {
        return response;
      }
    }

    if (method === 'POST' && /\/api\/gmail\/messages\/[^/]+\/read$/.test(url.pathname) && response.ok) {
      try {
        const parts = url.pathname.split('/');
        const encodedId = parts[parts.length - 2] || '';
        const id = decodeURIComponent(encodedId);
        queueMicrotask(() => removeAttentionItem(id));
      } catch (_) {}
    }

    return response;
  };
  window.fetch.__mailmateProductV7 = true;

  function dateOf(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatWhen(date) {
    if (!date) return '';
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const sameDay = date.toDateString() === now.toDateString();
    const nextDay = date.toDateString() === tomorrow.toDateString();
    const day = sameDay ? 'Today' : nextDay ? 'Tomorrow' : date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${day} · ${time}`;
  }

  function eventWeight(event) {
    const text = normalize(event?.title).toLowerCase();
    let score = 0;
    if (event?.conflict) score += 80;
    if (/\b(?:mandatory|urgent|remedial|exam|submission|deadline)\b/.test(text)) score += 35;
    if (event?.source === 'deadline') score += 15;
    return score;
  }

  function deriveHero() {
    const context = window.Kyle?.store?.context || {};
    const now = Date.now();
    const attention = Array.isArray(context.needs_attention) ? context.needs_attention : [];
    const emails = Array.isArray(context.emails) ? context.emails : [];
    const emailById = new Map(emails.map(email => [messageId(email), email]).filter(([id]) => id));

    const urgentAttention = attention.map(item => {
      const id = attentionId(item);
      const email = emailById.get(id);
      if (email?.is_read === true) return null;
      const text = `${item.subject || item.title || ''} ${item.description || item.reason || ''} ${item.urgency || ''}`.toLowerCase();
      const deadline = dateOf(item.deadline);
      let score = 0;
      if (/\b(?:urgent|asap|immediately|mandatory|due today|action required)\b/.test(text)) score += 100;
      if (deadline && deadline.getTime() >= now) {
        const hours = (deadline.getTime() - now) / 3600000;
        if (hours <= 6) score += 90;
        else if (hours <= 24) score += 45;
      }
      return { item, deadline, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score || ((a.deadline?.getTime() || Infinity) - (b.deadline?.getTime() || Infinity)));

    if (urgentAttention[0]?.score >= 90) {
      const choice = urgentAttention[0];
      const title = normalize(choice.item.subject || choice.item.title || choice.item.description || 'Needs your attention');
      return { tone: 'urgent', text: choice.deadline ? `${title} · ${formatWhen(choice.deadline)}` : title };
    }

    const events = (Array.isArray(context.calendarEvents) ? context.calendarEvents : Array.isArray(context.calendar_events) ? context.calendar_events : [])
      .map(event => ({ event, start: dateOf(event.start) }))
      .filter(entry => entry.start && entry.start.getTime() >= now - 5 * 60000)
      .sort((a, b) => {
        const timeDiff = a.start - b.start;
        if (Math.abs(timeDiff) < 5 * 60000) return eventWeight(b.event) - eventWeight(a.event);
        return timeDiff;
      });

    const conflict = events.filter(entry => entry.event?.conflict).sort((a, b) => {
      const timeDiff = a.start - b.start;
      if (Math.abs(timeDiff) < 5 * 60000) return eventWeight(b.event) - eventWeight(a.event);
      return timeDiff;
    })[0];
    if (conflict) {
      return { tone: 'watch', text: `${normalize(conflict.event.title || 'Schedule clash')} · ${formatWhen(conflict.start)}` };
    }

    const nextAttention = urgentAttention.find(entry => entry.deadline && entry.deadline.getTime() >= now);
    if (nextAttention) {
      const title = normalize(nextAttention.item.subject || nextAttention.item.title || 'Upcoming deadline');
      return { tone: 'watch', text: `${title} · ${formatWhen(nextAttention.deadline)}` };
    }

    if (events[0]) {
      return { tone: 'neutral', text: `${normalize(events[0].event.title || 'Next event')} · ${formatWhen(events[0].start)}` };
    }

    return { tone: 'clear', text: 'You’re clear for now.' };
  }

  function refreshHero() {
    const card = document.getElementById('mailmateAiOverview');
    if (!card) return;
    const copy = card.querySelector('.mailmate-ai-copy');
    if (!copy) return;
    const hero = deriveHero();
    card.dataset.mailmateV7Tone = hero.tone;
    card.classList.remove('is-loading');
    if (normalize(copy.textContent) !== hero.text) copy.textContent = hero.text;
  }

  function attachHeroObserver() {
    const card = document.getElementById('mailmateAiOverview');
    if (!card || card.dataset.mailmateV7Observed === '1') return;
    card.dataset.mailmateV7Observed = '1';
    heroObserver?.disconnect();
    heroObserver = new MutationObserver(() => {
      if (domRefreshQueued) return;
      domRefreshQueued = true;
      requestAnimationFrame(() => {
        domRefreshQueued = false;
        refreshHero();
      });
    });
    heroObserver.observe(card, { childList: true, subtree: true, characterData: true });
    refreshHero();
  }

  function removeEmailContextChip() {
    document.getElementById('mailmateEmailContextChip')?.remove();
  }

  function wrapKyleSurfaceClose() {
    const ui = window.KyleUi?.active;
    if (!ui?.closeSurface || ui.closeSurface.__mailmateV7) return;
    const original = ui.closeSurface.bind(ui);
    const wrapped = function (...args) {
      if (performance.now() < suppressSurfaceCloseUntil && !ui.isComposerOpen?.()) return;
      return original(...args);
    };
    wrapped.__mailmateV7 = true;
    ui.closeSurface = wrapped;
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || !event.target?.classList?.contains('prompt-input')) return;
    suppressSurfaceCloseUntil = performance.now() + 1800;
    wrapKyleSurfaceClose();
  }, true);

  document.addEventListener('pointerdown', event => {
    if (!event.target?.closest?.('.send-icon')) return;
    suppressSurfaceCloseUntil = performance.now() + 1800;
    wrapKyleSurfaceClose();
  }, true);

  const domObserver = new MutationObserver(() => {
    removeEmailContextChip();
    attachHeroObserver();
    wrapKyleSurfaceClose();
  });

  function boot() {
    removeEmailContextChip();
    attachHeroObserver();
    wrapKyleSurfaceClose();
    if (document.body) domObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
