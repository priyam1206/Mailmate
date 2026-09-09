(function () {
  'use strict';

  if (window.__MAILMATE_PRODUCT_V11__) return;
  window.__MAILMATE_PRODUCT_V11__ = true;

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  let latestContext = window.Kyle?.store?.context || null;
  let renderQueued = false;
  let writingUpcoming = false;
  let upcomingObserver = null;
  let bodyObserver = null;
  let clockTimer = null;

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function dateOf(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function cleanTitle(value) {
    return normalize(value)
      .replace(/^URGENT:\s*/i, '')
      .replace(/^IMPORTANT:\s*/i, '')
      .replace(/\s+-\s+TH$/i, ' – TH');
  }

  function activeContext() {
    const live = window.Kyle?.store?.context;
    if (live && typeof live === 'object') return live;
    return latestContext && typeof latestContext === 'object' ? latestContext : {};
  }

  function contextReady(ctx = activeContext()) {
    if (!ctx || typeof ctx !== 'object') return false;
    const calendar = Array.isArray(ctx.calendarEvents) || Array.isArray(ctx.calendar_events);
    const mail = Array.isArray(ctx.emails) || Boolean(ctx.metrics);
    return calendar && mail;
  }

  function calendarEvents(ctx = activeContext()) {
    if (Array.isArray(ctx?.calendarEvents)) return ctx.calendarEvents;
    if (Array.isArray(ctx?.calendar_events)) return ctx.calendar_events;
    return [];
  }

  function eventEnd(event, start) {
    const explicit = dateOf(event?.end);
    if (explicit && (!start || explicit.getTime() > start.getTime())) return explicit;
    if (!start) return null;
    if (event?.all_day || String(event?.start || '').length <= 10) {
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return end;
    }
    // A missing/broken end must not leave an old class visible forever.
    return new Date(start.getTime() + 60 * MINUTE);
  }

  function eventImportance(event) {
    const text = normalize(event?.title).toLowerCase();
    let score = 0;
    if (event?.conflict) score += 85;
    if (/\b(?:exam|interview)\b/.test(text)) score += 85;
    if (/\b(?:submission|deadline|apply by|register by|registration deadline)\b/.test(text)) score += 65;
    if (/\b(?:quiz|assessment|presentation)\b/.test(text)) score += 32;
    // Words such as urgent/mandatory/remedial are hints, not permission to
    // dominate something actually happening in the next hour.
    if (/\b(?:urgent|mandatory|remedial)\b/.test(text)) score += 18;
    if (event?.source === 'deadline' || event?.source === 'ai') score += 24;
    return score;
  }

  function proximityScore(when, now) {
    const delta = Math.max(0, when.getTime() - now.getTime());
    if (delta <= 30 * MINUTE) return 220;
    if (delta <= 90 * MINUTE) return 195;
    if (delta <= 3 * HOUR) return 160;
    if (delta <= 6 * HOUR) return 126;
    if (delta <= 12 * HOUR) return 94;
    if (delta <= DAY) return 62;
    if (delta <= 2 * DAY) return 34;
    if (delta <= 4 * DAY) return 16;
    return 4;
  }

  function eventCandidates(now) {
    return calendarEvents()
      .map(event => {
        const start = dateOf(event?.start);
        if (!start || event?.status === 'cancelled' || event?.cancelled === true) return null;
        const end = eventEnd(event, start);
        // Core rule: finished means gone. The Overview never shows history.
        if (end && end.getTime() <= now.getTime()) return null;
        if (start.getTime() > now.getTime() + 7 * DAY) return null;
        const inProgress = start.getTime() <= now.getTime() && end && end.getTime() > now.getTime();
        const importance = eventImportance(event);
        return {
          id: String(event.id || ''),
          source: event.source || 'google',
          title: cleanTitle(event.title || 'Upcoming event'),
          when: start,
          end,
          allDay: Boolean(event.all_day || String(event.start || '').length <= 10),
          inProgress,
          importance,
          score: (inProgress ? 235 : proximityScore(start, now)) + importance,
          critical: Boolean(event.conflict) || /\b(?:exam|interview|submission|deadline|apply by|register by)\b/i.test(event.title || ''),
          tone: event.conflict ? 'urgent' : importance >= 60 ? 'watch' : 'neutral'
        };
      })
      .filter(Boolean);
  }

  function deadlineCandidates(now) {
    const ctx = activeContext();
    // Needs Attention is unread-only by design. Reading a message must not
    // erase an unfinished real-world deadline, so V7 preserves those here.
    const attention = [
      ...(Array.isArray(ctx.needs_attention) ? ctx.needs_attention : []),
      ...(Array.isArray(ctx.resolved_attention_deadlines) ? ctx.resolved_attention_deadlines : [])
    ];

    return attention.map(item => {
      const id = String(item.source_message_id || item.message_id || item.email_id || item.id || '');
      const deadline = dateOf(item.deadline);
      if (!deadline || deadline.getTime() <= now.getTime() || deadline.getTime() > now.getTime() + 14 * DAY) return null;
      const text = `${item.subject || item.title || ''} ${item.description || item.reason || ''}`.toLowerCase();
      let importance = 50;
      if (/\b(?:urgent|asap|action required|due today|submission|deadline|apply by|register by|reply by)\b/.test(text)) importance += 65;
      return {
        id: id ? `deadline-${id}` : `deadline-${deadline.getTime()}`,
        source: 'deadline',
        title: cleanTitle(item.subject || item.title || item.description || 'Upcoming deadline'),
        when: deadline,
        end: deadline,
        allDay: false,
        inProgress: false,
        importance,
        score: proximityScore(deadline, now) + importance,
        critical: importance >= 100,
        tone: importance >= 100 ? 'urgent' : 'watch'
      };
    }).filter(Boolean);
  }

  function dedupe(candidates) {
    const result = [];
    for (const candidate of candidates.sort((a, b) => a.when - b.when)) {
      const key = candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const duplicate = result.find(existing => {
        const other = existing.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        return key && key === other && Math.abs(existing.when.getTime() - candidate.when.getTime()) <= 15 * MINUTE;
      });
      if (!duplicate) result.push(candidate);
      else if (candidate.score > duplicate.score) Object.assign(duplicate, candidate);
    }
    return result;
  }

  function candidates(now) {
    return dedupe([...eventCandidates(now), ...deadlineCandidates(now)]);
  }

  function chooseHeadline(now) {
    const list = candidates(now);
    if (!list.length) return { title: 'You’re clear for now.', when: null, tone: 'clear' };

    const near = list.filter(item => item.inProgress || item.when.getTime() - now.getTime() <= 6 * HOUR);
    if (near.length) {
      const next = [...near].sort((a, b) => b.score - a.score || a.when - b.when)[0];
      const criticalToday = list
        .filter(item => item.critical && item.when.getTime() - now.getTime() <= DAY)
        .sort((a, b) => b.score - a.score || a.when - b.when)[0];
      // A farther critical item only overrides the next commitment when it is
      // materially more important, not because its title contains URGENT.
      if (criticalToday && criticalToday.score >= next.score + 70) return criticalToday;
      return next;
    }

    return [...list].sort((a, b) => b.score - a.score || a.when - b.when)[0];
  }

  function relative(date, now) {
    const delta = date.getTime() - now.getTime();
    if (delta > 0 && delta < HOUR) return `in ${Math.max(1, Math.round(delta / MINUTE))} min`;
    if (delta >= HOUR && delta < 6 * HOUR) {
      const hours = delta / HOUR;
      return `in ${hours < 2 ? hours.toFixed(1).replace('.0', '') : Math.round(hours)} hr${hours >= 1.5 ? 's' : ''}`;
    }
    return '';
  }

  function whenLabel(item, now) {
    if (!item?.when) return '';
    if (item.inProgress) {
      const until = item.end?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return until ? `Now · until ${until}` : 'Now';
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const day = item.when.toDateString() === now.toDateString()
      ? 'Today'
      : item.when.toDateString() === tomorrow.toDateString()
        ? 'Tomorrow'
        : item.when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const time = item.allDay ? 'All day' : item.when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return [day, time, relative(item.when, now)].filter(Boolean).join(' · ');
  }

  function renderHero(now) {
    if (!contextReady()) return false;
    const root = document.getElementById('mailmateAiOverview');
    const copy = root?.querySelector('.mailmate-ai-copy');
    if (!root || !copy) return false;
    const item = chooseHeadline(now);
    root.dataset.mailmateV11Owned = '1';
    root.dataset.mailmateV10Tone = item.tone || 'neutral';
    root.dataset.mailmateV8Tone = item.tone || 'neutral';
    root.dataset.mailmateV7Tone = item.tone || 'neutral';
    root.classList.remove('is-loading');
    const html = item.when
      ? `<span class="mailmate-headline-title">${escapeHtml(item.title)}</span><span class="mailmate-headline-time">${escapeHtml(whenLabel(item, now))}</span>`
      : `<span class="mailmate-headline-title">${escapeHtml(item.title)}</span>`;
    if (copy.innerHTML !== html) copy.innerHTML = html;
    return true;
  }

  function dayLabel(date, now) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function renderUpcoming(now) {
    if (!contextReady()) return false;
    const host = document.getElementById('upcomingList');
    if (!host) return false;
    const list = candidates(now)
      .filter(item => item.inProgress || item.when.getTime() >= now.getTime())
      .sort((a, b) => a.when - b.when || b.importance - a.importance)
      .slice(0, 7);

    let html = '<p class="overview-empty-copy">Nothing upcoming.</p>';
    if (list.length) {
      const groups = new Map();
      list.forEach(item => {
        const label = dayLabel(item.when, now);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(item);
      });
      html = [...groups.entries()].map(([label, items]) => `
        <div class="upcoming-day">
          <p>${escapeHtml(label)}</p>
          ${items.map(item => `
            <button type="button" data-v11-upcoming-id="${escapeHtml(item.id)}">
              <time>${item.inProgress ? 'Now' : item.allDay ? 'All day' : escapeHtml(item.when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</time>
              <span><strong>${escapeHtml(item.title)}</strong><small>${item.source === 'deadline' ? 'Deadline' : 'Calendar'}</small></span>
              <i class="fas fa-arrow-right"></i>
            </button>`).join('')}
        </div>`).join('');
    }

    const signature = html.replace(/\s+/g, ' ').trim();
    const currentSignature = String(host.innerHTML || '').replace(/\s+/g, ' ').trim();
    // Core dashboard refreshes can replace innerHTML without touching this
    // dataset value. Compare the actual DOM too or stale, already-finished
    // events can survive until the next full refresh.
    if (host.dataset.mailmateV11Signature === signature && currentSignature === signature) return true;
    writingUpcoming = true;
    host.dataset.mailmateV11Signature = signature;
    host.dataset.mailmateV11Owned = '1';
    host.innerHTML = html;
    host.querySelectorAll('[data-v11-upcoming-id]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelector('nav.nav-tabs [data-tab="calendar"]')?.click();
        const id = button.dataset.v11UpcomingId;
        requestAnimationFrame(() => {
          if (!id || id.startsWith('deadline-')) return;
          document.querySelector(`[data-calendar-event="${CSS.escape(id)}"]`)?.focus?.();
        });
      });
    });
    queueMicrotask(() => { writingUpcoming = false; });
    return true;
  }

  function refresh() {
    latestContext = window.Kyle?.store?.context || latestContext;
    if (!contextReady()) return false;
    const now = new Date();
    const hero = renderHero(now);
    const upcoming = renderUpcoming(now);
    if (hero && upcoming) window.MailmateBoot?.mark?.('timeaware');
    return hero && upcoming;
  }

  function queueRefresh() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      refresh();
    });
  }

  function bindUpcomingObserver() {
    const host = document.getElementById('upcomingList');
    if (!host || upcomingObserver) return;
    upcomingObserver = new MutationObserver(() => {
      if (!writingUpcoming) queueRefresh();
    });
    upcomingObserver.observe(host, { childList: true, subtree: true, characterData: true });
  }

  function boot() {
    latestContext = window.Kyle?.store?.context || latestContext;
    bindUpcomingObserver();
    refresh();

    window.addEventListener('harness:context', event => {
      latestContext = event.detail || window.Kyle?.store?.context || latestContext;
      queueRefresh();
    });
    window.addEventListener('mailmate:context-changed', event => {
      // Some legacy events carry partial UI context. Prefer Kyle's canonical
      // workspace context whenever it exists.
      latestContext = window.Kyle?.store?.context || event.detail || latestContext;
      queueRefresh();
    });

    clockTimer = setInterval(refresh, 15 * 1000);
    window.addEventListener('focus', refresh, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

    bodyObserver = new MutationObserver(() => {
      bindUpcomingObserver();
      if (!document.getElementById('mailmateAiOverview')?.dataset.mailmateV11Owned) queueRefresh();
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    window.MailmateTimeAware = { refresh, ready: true, contextReady: () => contextReady() };
    window.MailmateBoot?.mark?.('timeaware');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();