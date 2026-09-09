(function () {
  'use strict';

  if (window.__MAILMATE_KYLE_MAIN_FIXES__) return;
  window.__MAILMATE_KYLE_MAIN_FIXES__ = true;

  const nativeFetch = window.fetch.bind(window);
  const LAST_SENT_KEY = 'mailmate.kyle.last-sent.v2';
  let canonicalDraft = null;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  }

  function operationId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `mail_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  }

  function extractEmail(value) {
    const raw = String(value || '').trim();
    const bracket = raw.match(/<([^>]+)>/);
    return String(bracket?.[1] || raw).trim();
  }

  function readLastSent() {
    try {
      const parsed = JSON.parse(window.sessionStorage?.getItem?.(LAST_SENT_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.to || !parsed.body) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function rememberLastSent(draft, result = {}) {
    if (!draft) return;
    const record = {
      to: extractEmail(draft.to || draft.recipient),
      recipient: String(draft.recipient || draft.to || ''),
      subject: String(draft.subject || ''),
      body: String(draft.body || ''),
      thread_id: draft.thread_id || null,
      in_reply_to: draft.in_reply_to || null,
      message_id: result.messageId || result.message_id || null,
      sent_at: new Date().toISOString()
    };
    if (!record.to || !record.body) return;
    try { window.sessionStorage?.setItem?.(LAST_SENT_KEY, JSON.stringify(record)); } catch (_) {}
    window.__MailmateLastSent = record;
  }

  function isResendIntent(message) {
    const text = String(message || '').trim();
    return /^(?:please\s+)?(?:re[-\s]?send\s+(?:that|it|the\s+(?:same\s+)?(?:email|mail|message))|send\s+(?:that|it|the\s+same\s+(?:email|mail|message))\s+again)(?:\s+please)?[.!?]*$/i.test(text);
  }

  function addDays(date, amount) {
    const next = new Date(date);
    next.setHours(12, 0, 0, 0);
    next.setDate(next.getDate() + amount);
    return next;
  }

  function requestedDay(message) {
    const text = String(message || '').toLowerCase();
    const now = new Date();

    if (/\b(?:tomorrow|tmrw|tmr|tommorrow)\b/.test(text)) {
      return { date: addDays(now, 1), label: 'Tomorrow' };
    }
    if (/\b(?:today|tonight)\b/.test(text)) {
      return { date: addDays(now, 0), label: 'Today' };
    }

    const weekdays = [
      ['sunday', 0], ['monday', 1], ['tuesday', 2], ['wednesday', 3],
      ['thursday', 4], ['friday', 5], ['saturday', 6]
    ];
    const match = weekdays.find(([name]) => new RegExp(`\\b${name}\\b`).test(text));
    if (!match) return null;

    const [name, target] = match;
    let delta = (target - now.getDay() + 7) % 7;
    if (/\bnext\s+/.test(text)) delta = delta === 0 ? 7 : delta + 7;
    return { date: addDays(now, delta), label: name.charAt(0).toUpperCase() + name.slice(1) };
  }

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function calendarReadIntent(message) {
    const text = String(message || '');
    const day = requestedDay(text);
    if (!day) return null;
    if (!/\b(?:class(?:es)?|lecture(?:s)?|lab(?:s)?|calendar|schedule|events?|appointments?)\b/i.test(text)) return null;
    if (/\b(?:add|create|book|move|change|delete|remove|cancel)\b/i.test(text)) return null;
    return day;
  }

  function eventStartMs(event) {
    const raw = String(event?.start || '');
    if (!raw) return Number.MAX_SAFE_INTEGER;
    if (!raw.includes('T')) return new Date(`${raw}T00:00:00`).getTime();
    const value = new Date(raw).getTime();
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  function formatEventTime(event) {
    const startRaw = String(event?.start || '');
    const endRaw = String(event?.end || '');
    if (event?.all_day || !startRaw.includes('T')) return 'All day';
    const start = new Date(startRaw);
    const end = endRaw ? new Date(endRaw) : null;
    const options = { hour: 'numeric', minute: '2-digit' };
    if (Number.isNaN(start.getTime())) return startRaw;
    const startText = start.toLocaleTimeString([], options);
    if (!end || Number.isNaN(end.getTime())) return startText;
    return `${startText} – ${end.toLocaleTimeString([], options)}`;
  }

  function sectionForEvent(event) {
    const startRaw = String(event?.start || '');
    if (event?.all_day || !startRaw.includes('T')) return 'All day';
    const hour = new Date(startRaw).getHours();
    if (hour < 12) return 'Morning';
    if (hour < 17) return 'Afternoon';
    return 'Evening';
  }

  function calendarItem(event) {
    const location = String(event?.location || '').trim();
    const description = String(event?.description || '').replace(/\s+/g, ' ').trim();
    return {
      title: String(event?.title || 'Calendar event'),
      detail: location || description.slice(0, 220),
      meta: formatEventTime(event),
      reference: event?.id ? {
        type: 'calendar-event',
        id: String(event.id),
        label: String(event?.title || 'Calendar event')
      } : null
    };
  }

  async function exactDayCalendarPayload(message, request) {
    const key = dateKey(request.date);
    const url = new URL('/api/calendar/events', window.location.origin);
    url.searchParams.set('start', key);
    url.searchParams.set('end', key);
    url.searchParams.set('limit', '250');

    const response = await nativeFetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json().catch(() => []);
    const events = (Array.isArray(data) ? data : (data.events || []))
      .filter(event => event && event.status !== 'cancelled')
      .sort((a, b) => eventStartMs(a) - eventStartMs(b));

    const order = ['All day', 'Morning', 'Afternoon', 'Evening'];
    const groups = new Map(order.map(name => [name, []]));
    events.forEach(event => groups.get(sectionForEvent(event))?.push(calendarItem(event)));
    const sections = order
      .map(heading => ({ heading, items: groups.get(heading) || [] }))
      .filter(section => section.items.length);

    const longDate = request.date.toLocaleDateString([], {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const count = events.length;
    const reply = count
      ? `You have ${count} calendar event${count === 1 ? '' : 's'} on ${request.label.toLowerCase()}. I fetched the complete requested day from Google Calendar.`
      : `You have no calendar events on ${request.label.toLowerCase()}. I checked the complete requested day.`;

    return {
      reply,
      text: reply,
      voice: count
        ? `You have ${count} event${count === 1 ? '' : 's'} ${request.label.toLowerCase()}. I found the full day.`
        : `You have no events ${request.label.toLowerCase()}.`,
      actions: [],
      mode: 'semantic-agent',
      presentation: 'canvas',
      canvas: {
        title: `Classes & Events for ${request.label}`,
        lede: count
          ? `Here is the complete schedule for ${longDate}. Events are grouped by time of day so later classes are not dropped.`
          : `I checked the full Google Calendar window for ${longDate} and found no scheduled events.`,
        highlights: [
          { label: 'Events', value: String(count) },
          { label: 'Coverage', value: 'Full day' }
        ],
        sections
      },
      brief: {
        title: `Schedule for ${request.label}`,
        items: events.map(event => ({
          id: event.id,
          title: event.title || 'Calendar event',
          meta: formatEventTime(event),
          conflict: Boolean(event.conflict)
        }))
      },
      handled: true,
      exact_calendar_scope: { start: key, end: key, complete: true }
    };
  }

  async function resendPayload() {
    const last = readLastSent();
    if (!last) {
      const reply = 'I do not have a confirmed sent email to resend in this session. Open or send the email first, then say “resend that”.';
      return {
        reply, text: reply, voice: reply,
        actions: [], mode: 'semantic-agent', presentation: 'compact'
      };
    }

    const payload = {
      operation_id: operationId(),
      to: last.to,
      subject: last.subject || '',
      body: last.body,
      thread_id: last.thread_id || null,
      in_reply_to: last.in_reply_to || null
    };

    try {
      const response = await nativeFetch('/api/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `Gmail returned ${response.status}`);
      }

      rememberLastSent({ ...last, operation_id: payload.operation_id }, {
        messageId: data.message_id || data.messageId
      });
      const reply = `Okay, I resent that to ${last.to}.`;
      return {
        reply, text: reply, voice: reply,
        actions: [], mode: 'semantic-agent', presentation: 'compact',
        resend: { ok: true, message_id: data.message_id || data.messageId || null }
      };
    } catch (error) {
      const reply = `I could not resend that: ${error.message || error}`;
      return {
        reply, text: reply, voice: reply,
        actions: [], mode: 'semantic-agent', presentation: 'compact',
        resend: { ok: false }
      };
    }
  }

  function installAgentFetchGuard() {
    if (window.fetch.__mailmateKyleMainFixes) return;

    const guardedFetch = async function (input, init = {}) {
      let url;
      try { url = new URL(typeof input === 'string' ? input : input?.url, window.location.href); }
      catch (_) { return nativeFetch(input, init); }

      if (url.pathname === '/api/kyle/agent' && String(init?.method || 'GET').toUpperCase() === 'POST') {
        let body = null;
        try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch (_) {}
        const message = String(body?.message || '').trim();

        if (message && isResendIntent(message)) {
          return jsonResponse(await resendPayload());
        }

        const request = message ? calendarReadIntent(message) : null;
        if (request) {
          try {
            const payload = await exactDayCalendarPayload(message, request);
            if (payload) return jsonResponse(payload);
          } catch (error) {
            console.warn('[Kyle Main Fixes] exact-day Calendar read failed; falling back to agent:', error);
          }
        }
      }

      return nativeFetch(input, init);
    };

    guardedFetch.__mailmateKyleMainFixes = true;
    window.fetch = guardedFetch;
  }

  function installComposerGuard() {
    const ui = window.KyleUi?.active;
    if (!ui || ui.__mailmateFullDraftGuard) return Boolean(ui?.__mailmateFullDraftGuard);

    const originalOpenComposer = ui.openComposer?.bind(ui);
    const originalSetComposerDraft = ui.setComposerDraft?.bind(ui);
    const originalSendCurrentComposer = ui.sendCurrentComposer?.bind(ui);
    if (!originalOpenComposer || !originalSetComposerDraft || !originalSendCurrentComposer) return false;

    ui.openComposer = function (draft = {}, mode = 'reply') {
      canonicalDraft = { ...draft, mode };
      return originalOpenComposer(draft, mode);
    };

    ui.setComposerDraft = function (patch = {}) {
      canonicalDraft = { ...(canonicalDraft || ui.getActiveDraft?.() || {}), ...patch };
      return originalSetComposerDraft(patch);
    };

    ui.sendCurrentComposer = async function () {
      const snapshot = ui.getComposerSnapshot?.() || {};
      if (['preparing', 'generating'].includes(String(snapshot.state || '')) && canonicalDraft) {
        const subject = document.getElementById('kyleComposerSubject');
        const body = document.getElementById('kyleComposerText');
        if (subject && canonicalDraft.subject !== undefined) subject.value = String(canonicalDraft.subject || '');
        if (body && canonicalDraft.body !== undefined) body.value = String(canonicalDraft.body || '');
      }

      const before = ui.getActiveDraft?.() || canonicalDraft || null;
      const result = await originalSendCurrentComposer();
      if (result?.ok) {
        // `before` is captured synchronously after the full-draft guard runs.
        // Do not re-read the animated fields after Gmail returns; they may still
        // be painting and could otherwise corrupt the resend receipt.
        rememberLastSent(before, result);
      }
      return result;
    };

    ui.__mailmateFullDraftGuard = true;
    return true;
  }

  function installDraftObservationGuard() {
    const observation = window.KyleObservation;
    if (!observation?.after || observation.__mailmateDraftWaitGuard) {
      return Boolean(observation?.__mailmateDraftWaitGuard);
    }

    const originalAfter = observation.after.bind(observation);
    observation.after = async function (action, before, result) {
      const initial = await originalAfter(action, before, result);
      if (action?.tool !== 'mail.update_draft' || initial?.satisfied) return initial;

      const deadline = Date.now() + 2600;
      while (Date.now() < deadline) {
        const composer = observation.composerSnapshot?.() || {};
        const subjectOk = action.args?.subject === undefined || composer.subject === String(action.args.subject);
        const bodyOk = action.args?.body === undefined || composer.body === String(action.args.body);
        if (composer.visible && subjectOk && bodyOk) {
          return {
            ...initial,
            satisfied: true,
            details: { ...(initial.details || {}), composer }
          };
        }
        await sleep(45);
      }
      return initial;
    };

    observation.__mailmateDraftWaitGuard = true;
    return true;
  }

  function installRuntimeGuards() {
    const composerReady = installComposerGuard();
    const observationReady = installDraftObservationGuard();
    return composerReady && observationReady;
  }

  installAgentFetchGuard();

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (installRuntimeGuards() || attempts > 120) clearInterval(timer);
  }, 50);
  installRuntimeGuards();

  window.MailmateKyleMainFixes = {
    readLastSent,
    isResendIntent,
    calendarReadIntent,
    installRuntimeGuards
  };
})();
