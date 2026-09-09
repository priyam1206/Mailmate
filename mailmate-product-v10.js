(function () {
  'use strict';

  if (window.__MAILMATE_PRODUCT_V10__) return;
  window.__MAILMATE_PRODUCT_V10__ = true;

  let heroRoot = null;
  let heroObserver = null;
  let upcomingObserver = null;
  let refreshTimer = null;
  let refreshQueued = false;
  let lastUpcomingSignature = '';

  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;
  const DAY = 24 * HOUR;

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

  function context() {
    return window.Kyle?.store?.context || {};
  }

  function eventEnd(event, start) {
    const parsed = dateOf(event?.end);
    if (parsed) return parsed;
    if (event?.all_day && start) {
      const next = new Date(start);
      next.setDate(next.getDate() + 1);
      return next;
    }
    if (start) return new Date(start.getTime() + 60 * MINUTE);
    return null;
  }

  function isEventRelevant(event, now) {
    const start = dateOf(event?.start);
    if (!start) return false;
    const end = eventEnd(event, start);
    if (event?.status === 'cancelled' || event?.cancelled === true) return false;
    // Once the event has actually ended it is gone from Overview/Upcoming.
    if (end && end.getTime() <= now.getTime()) return false;
    // Keep only a useful planning horizon in the overview surface.
    return start.getTime() <= now.getTime() + 7 * DAY;
  }

  function eventImportance(event) {
    const text = normalize(event?.title).toLowerCase();
    let score = 0;
    if (event?.conflict) score += 80;
    if (/\b(?:exam|interview|submission|deadline)\b/.test(text)) score += 70;
    if (/\b(?:quiz|assessment|presentation|review)\b/.test(text)) score += 35;
    // Do not trust dramatic title wording enough to let a far-away calendar item
    // beat the next real commitment. It is only a modest signal.
    if (/\b(?:mandatory|remedial|urgent)\b/.test(text)) score += 22;
    if (event?.source === 'deadline' || event?.source === 'ai') score += 28;
    return score;
  }

  function proximityScore(when, now) {
    const delta = Math.max(0, when.getTime() - now.getTime());
    if (delta <= 30 * MINUTE) return 190;
    if (delta <= 90 * MINUTE) return 170;
    if (delta <= 3 * HOUR) return 145;
    if (delta <= 6 * HOUR) return 118;
    if (delta <= 12 * HOUR) return 90;
    if (delta <= DAY) return 62;
    if (delta <= 2 * DAY) return 36;
    if (delta <= 4 * DAY) return 18;
    return 6;
  }

  function buildEventCandidates(now) {
    const ctx = context();
    const events = Array.isArray(ctx.calendarEvents)
      ? ctx.calendarEvents
      : Array.isArray(ctx.calendar_events)
        ? ctx.calendar_events
        : [];

    return events
      .filter(event => isEventRelevant(event, now))
      .map(event => {
        const start = dateOf(event.start);
        const end = eventEnd(event, start);
        const inProgress = start && start.getTime() <= now.getTime() && end && end.getTime() > now.getTime();
        const importance = eventImportance(event);
        const score = (inProgress ? 205 : proximityScore(start, now)) + importance;
        return {
          id: String(event.id || ''),
          source: event.source || 'google',
          title: cleanTitle(event.title || 'Upcoming event'),
          when: start,
          end,
          allDay: Boolean(event.all_day),
          inProgress,
          score,
          importance,
          critical: Boolean(event.conflict) || /\b(?:exam|interview|submission|deadline)\b/i.test(event.title || ''),
          tone: event.conflict ? 'urgent' : importance >= 60 ? 'watch' : 'neutral',
          raw: event
        };
      });
  }

  function buildDeadlineCandidates(now) {
    const ctx = context();
    const emails = Array.isArray(ctx.emails) ? ctx.emails : [];
    const byId = new Map(emails.map(email => [String(email.id || email.gmail_id || email.message_id || ''), email]));
    const attention = Array.isArray(ctx.needs_attention) ? ctx.needs_attention : [];

    return attention.map(item => {
      const id = String(item.source_message_id || item.message_id || item.email_id || item.id || '');
      if (id && byId.get(id)?.is_read === true) return null;
      const deadline = dateOf(item.deadline);
      if (!deadline || deadline.getTime() <= now.getTime() || deadline.getTime() > now.getTime() + 14 * DAY) return null;
      const text = `${item.subject || item.title || ''} ${item.description || item.reason || ''}`.toLowerCase();
      let importance = 55;
      if (/\b(?:urgent|asap|action required|mandatory|due today|submission|deadline|apply by|register by)\b/.test(text)) importance += 70;
      const score = proximityScore(deadline, now) + importance;
      return {
        id: id ? `deadline-${id}` : `deadline-${deadline.getTime()}`,
        source: 'deadline',
        title: cleanTitle(item.subject || item.title || item.description || 'Upcoming deadline'),
        when: deadline,
        end: deadline,
        allDay: false,
        inProgress: false,
        score,
        importance,
        critical: importance >= 100,
        tone: importance >= 100 ? 'urgent' : 'watch',
        raw: item
      };
    }).filter(Boolean);
  }

  function dedupeCandidates(candidates) {
    const result = [];
    for (const candidate of candidates.sort((a, b) => a.when - b.when)) {
      const normalized = candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const duplicate = result.find(existing => {
        const other = existing.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        return normalized && normalized === other && Math.abs(existing.when - candidate.when) <= 15 * MINUTE;
      });
      if (!duplicate) result.push(candidate);
      else if (candidate.score > duplicate.score) Object.assign(duplicate, candidate);
    }
    return result;
  }

  function allCandidates(now = new Date()) {
    return dedupeCandidates([...buildEventCandidates(now), ...buildDeadlineCandidates(now)]);
  }

  function chooseHeadline(now = new Date()) {
    const candidates = allCandidates(now);
    if (!candidates.length) return { title: 'You’re clear for now.', when: null, end: null, tone: 'clear' };

    const near = candidates.filter(candidate => candidate.inProgress || candidate.when.getTime() - now.getTime() <= 6 * HOUR);
    const criticalSoon = candidates.filter(candidate => candidate.critical && candidate.when.getTime() - now.getTime() <= DAY);

    // The next few hours are the default focus. A genuinely critical deadline/event
    // inside the next day may override them; dramatic wording alone cannot.
    let pool;
    if (near.length) {
      const strongestCritical = criticalSoon.sort((a, b) => b.score - a.score || a.when - b.when)[0];
      const strongestNear = near.sort((a, b) => b.score - a.score || a.when - b.when)[0];
      pool = strongestCritical && strongestCritical.score >= strongestNear.score + 55
        ? [strongestCritical]
        : near;
    } else {
      pool = candidates;
    }

    const best = [...pool].sort((a, b) => b.score - a.score || a.when - b.when)[0];
    return best || { title: 'You’re clear for now.', when: null, end: null, tone: 'clear' };
  }

  function relativeLabel(date, now) {
    if (!date) return '';
    const delta = date.getTime() - now.getTime();
    if (delta > 0 && delta < 60 * MINUTE) return `in ${Math.max(1, Math.round(delta / MINUTE))} min`;
    if (delta >= 60 * MINUTE && delta < 6 * HOUR) {
      const hours = delta / HOUR;
      return `in ${hours < 2 ? hours.toFixed(1).replace('.0', '') : Math.round(hours)} hr${hours >= 1.5 ? 's' : ''}`;
    }
    return '';
  }

  function formatWhen(candidate, now = new Date()) {
    if (!candidate?.when) return '';
    if (candidate.inProgress) {
      const until = candidate.end ? candidate.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      return until ? `Now · until ${until}` : 'Now';
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const day = candidate.when.toDateString() === now.toDateString()
      ? 'Today'
      : candidate.when.toDateString() === tomorrow.toDateString()
        ? 'Tomorrow'
        : candidate.when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const time = candidate.allDay ? 'All day' : candidate.when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const relative = relativeLabel(candidate.when, now);
    return [day, time, relative].filter(Boolean).join(' · ');
  }

  function ownHero() {
    const current = document.getElementById('mailmateAiOverview');
    if (!current) return null;
    if (current.dataset.mailmateV10Owned === '1') return current;
    const clone = current.cloneNode(true);
    clone.dataset.mailmateV10Owned = '1';
    clone.dataset.mailmateV8Owned = '1';
    clone.dataset.mailmateV7Observed = '1';
    current.replaceWith(clone);
    heroRoot = clone;
    heroObserver?.disconnect();
    heroObserver = new MutationObserver(queueRefresh);
    heroObserver.observe(clone, { childList: true, subtree: true, characterData: true });
    return clone;
  }

  function renderHeadline(now = new Date()) {
    const root = ownHero() || heroRoot;
    const copy = root?.querySelector('.mailmate-ai-copy');
    if (!root || !copy) return;
    const chosen = chooseHeadline(now);
    root.dataset.mailmateV10Tone = chosen.tone || 'neutral';
    root.dataset.mailmateV8Tone = chosen.tone || 'neutral';
    root.dataset.mailmateV7Tone = chosen.tone || 'neutral';
    root.classList.remove('is-loading');
    const html = chosen.when
      ? `<span class="mailmate-headline-title">${escapeHtml(chosen.title)}</span><span class="mailmate-headline-time">${escapeHtml(formatWhen(chosen, now))}</span>`
      : `<span class="mailmate-headline-title">${escapeHtml(chosen.title)}</span>`;
    if (copy.innerHTML !== html) copy.innerHTML = html;
  }

  function dayLabel(date, now) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function upcomingHtml(now = new Date()) {
    const candidates = allCandidates(now)
      .filter(candidate => candidate.inProgress || candidate.when.getTime() >= now.getTime())
      .sort((a, b) => a.when - b.when || b.importance - a.importance)
      .slice(0, 7);

    if (!candidates.length) return '<p class="overview-empty-copy">Nothing upcoming.</p>';

    const groups = new Map();
    candidates.forEach(candidate => {
      const label = dayLabel(candidate.when, now);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(candidate);
    });

    return [...groups.entries()].map(([label, items]) => `
      <div class="upcoming-day">
        <p>${escapeHtml(label)}</p>
        ${items.map(candidate => `
          <button type="button" data-v10-upcoming-id="${escapeHtml(candidate.id)}">
            <time>${candidate.inProgress ? 'Now' : candidate.allDay ? 'All day' : escapeHtml(candidate.when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</time>
            <span>
              <strong>${escapeHtml(candidate.title)}</strong>
              <small>${candidate.source === 'deadline' ? 'Deadline' : 'Calendar'}</small>
            </span>
            <i class="fas fa-arrow-right"></i>
          </button>`).join('')}
      </div>`).join('');
  }

  function renderUpcoming(now = new Date()) {
    const host = document.getElementById('upcomingList');
    if (!host) return;
    const html = upcomingHtml(now);
    const signature = html.replace(/\s+/g, ' ').trim();
    if (signature === lastUpcomingSignature && host.dataset.mailmateV10Owned === '1') return;
    lastUpcomingSignature = signature;
    host.dataset.mailmateV10Owned = '1';
    host.innerHTML = html;
    host.querySelectorAll('[data-v10-upcoming-id]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelector('nav.nav-tabs [data-tab="calendar"]')?.click();
        const id = button.dataset.v10UpcomingId;
        requestAnimationFrame(() => {
          if (!id || id.startsWith('deadline-')) return;
          document.querySelector(`[data-calendar-event="${CSS.escape(id)}"]`)?.focus?.();
        });
      });
    });
  }

  function refreshTimeAwareSurfaces() {
    const now = new Date();
    renderHeadline(now);
    renderUpcoming(now);
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refreshTimeAwareSurfaces();
    });
  }

  function observeUpcoming() {
    const host = document.getElementById('upcomingList');
    if (!host || upcomingObserver) return;
    upcomingObserver = new MutationObserver(() => {
      // dashboard.js may refresh Calendar/Overview after network sync. Reconcile
      // only this surface back to current-time state without another API call.
      queueRefresh();
    });
    upcomingObserver.observe(host, { childList: true, subtree: true, characterData: true });
  }

  function boot() {
    ownHero();
    observeUpcoming();
    refreshTimeAwareSurfaces();

    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshTimeAwareSurfaces, 30 * 1000);
    window.addEventListener('focus', refreshTimeAwareSurfaces, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshTimeAwareSurfaces();
    });

    // Context changes from Gmail/Calendar should update only the affected text/list.
    window.addEventListener('kyle:context', queueRefresh);
    window.addEventListener('mailmate:context-changed', queueRefresh);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
