(function () {
  'use strict';

  if (window.__MAILMATE_PRODUCT_V9__) return;
  window.__MAILMATE_PRODUCT_V9__ = true;

  const priorFetch = window.fetch.bind(window);
  let firstOverviewReady = false;
  let firstCalendarReady = false;
  let bootDone = false;
  let unlockQueued = false;
  let historyOpen = false;
  let toolWrapped = false;
  let canvasPatched = false;

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function createBootGate() {
    if (!document.body || document.getElementById('mailmateBootGate')) return;
    document.body.classList.add('mailmate-boot-lock');
    const gate = document.createElement('div');
    gate.id = 'mailmateBootGate';
    gate.className = 'mailmate-boot-gate';
    gate.setAttribute('role', 'status');
    gate.setAttribute('aria-label', 'Loading MailMate');
    gate.innerHTML = '<span class="mailmate-boot-spinner" aria-hidden="true"></span>';
    document.body.appendChild(gate);
  }

  function currentContextReady() {
    const context = window.Kyle?.store?.context || {};
    if (Array.isArray(context.emails) || context.metrics) firstOverviewReady = true;
    if (Array.isArray(context.calendarEvents) || Array.isArray(context.calendar_events)) firstCalendarReady = true;
    return firstOverviewReady && firstCalendarReady;
  }

  function pokeOverviewHeadline() {
    const copy = document.querySelector('#mailmateAiOverview .mailmate-ai-copy');
    if (!copy) return;
    const marker = document.createTextNode('\u200b');
    copy.appendChild(marker);
    queueMicrotask(() => marker.remove());
  }

  function patchCanvasPollingMotion() {
    if (canvasPatched || !window.KyleCanvas) return;
    canvasPatched = true;

    const originalSetDataLoading = window.KyleCanvas.setDataLoading?.bind(window.KyleCanvas);
    if (originalSetDataLoading) {
      window.KyleCanvas.setDataLoading = function (on) {
        if (bootDone && on) return;
        return originalSetDataLoading(Boolean(on));
      };
    }

    // dashboard.js calls this after every render. After the first boot, a poll
    // must not replay the entrance/typewriter/number animations.
    window.KyleCanvas.animateDashboardArrival = function () {};
  }

  function finishBoot() {
    if (bootDone) return;
    bootDone = true;
    patchCanvasPollingMotion();
    document.getElementById('mailmateInitialLoader')?.remove();
    document.body?.classList.add('mailmate-live-ready');

    // Kyle receives Calendar context immediately after the calendar request
    // resolves. Trigger one hidden headline reconciliation before revealing UI.
    pokeOverviewHeadline();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pokeOverviewHeadline();
      const gate = document.getElementById('mailmateBootGate');
      gate?.classList.add('is-done');
      document.body?.classList.remove('mailmate-boot-lock');
      setTimeout(() => gate?.remove(), 260);
    }));
  }

  function maybeFinishBoot() {
    if (bootDone || unlockQueued || !firstOverviewReady || !firstCalendarReady) return;
    unlockQueued = true;
    let attempts = 0;
    const settle = () => {
      attempts += 1;
      const context = window.Kyle?.store?.context || {};
      const hasMailContext = Array.isArray(context.emails) || Boolean(context.metrics);
      const hasCalendarContext = Array.isArray(context.calendarEvents) || Array.isArray(context.calendar_events);
      if ((hasMailContext && hasCalendarContext) || attempts >= 24) {
        setTimeout(finishBoot, 80);
        return;
      }
      setTimeout(settle, 35);
    };
    settle();
  }

  function parseTime(text, fallback = '08:00') {
    const match = String(text || '').match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);
    if (!match) return fallback;
    let hour = Number(match[1]);
    const minute = Math.max(0, Math.min(59, Number(match[2] || 0)));
    const meridiem = String(match[3] || '').replace(/\./g, '').toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (!meridiem && hour > 23) return fallback;
    hour = Math.max(0, Math.min(23, hour));
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function cleanAutomationGoal(message) {
    let goal = normalize(message);
    goal = goal
      .replace(/^\s*(?:please\s+)?(?:create|make|set up|setup|add)\s+(?:an?\s+)?automation\s+(?:to\s+)?/i, '')
      .replace(/^\s*(?:every|each)\s+(?:single\s+)?(?:morning|afternoon|evening|day|night)\s*(?:at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)?\s*[,;:-]?\s*/i, '')
      .replace(/^\s*daily\s*(?:at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)?\s*[,;:-]?\s*/i, '')
      .replace(/^\s*(?:every|each)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)?\s*[,;:-]?\s*/i, '')
      .replace(/^\s*every\s+\d+\s+(?:minutes?|hours?)\s*[,;:-]?\s*/i, '')
      .replace(/[.\s]+$/, '')
      .trim();
    return goal || normalize(message);
  }

  function automationName(goal, message) {
    const text = `${goal} ${message}`.toLowerCase();
    const morning = /\bmorning\b/.test(String(message || '').toLowerCase());
    if (/\b(?:gmail|email|mail|inbox)\b/.test(text) && /\b(?:urgent|attention|priority)\b/.test(text)) {
      return morning ? 'Morning Gmail Attention Brief' : 'Gmail Attention Brief';
    }
    if (/\b(?:gmail|email|mail|inbox)\b/.test(text)) return morning ? 'Morning Gmail Brief' : 'Gmail Brief';
    if (/\b(?:calendar|schedule|events?)\b/.test(text)) return 'Calendar Check';
    const words = normalize(goal).split(' ').filter(Boolean).slice(0, 6);
    const title = words.join(' ').replace(/\b\w/g, letter => letter.toUpperCase());
    return (title || 'Kyle Automation').slice(0, 80);
  }

  function scheduleLabel(schedule) {
    if (schedule.type === 'interval') {
      const minutes = Number(schedule.minutes || 60);
      if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return `every ${hours} hour${hours === 1 ? '' : 's'}`;
      }
      return `every ${minutes} minutes`;
    }
    const [hour, minute] = String(schedule.time || '08:00').split(':').map(Number);
    const date = new Date(2000, 0, 1, hour || 0, minute || 0);
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (schedule.type === 'weekly') {
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      return `every ${days[Number(schedule.weekday || 0)]} at ${time}`;
    }
    return `every day at ${time}`;
  }

  function parseAutomationPrompt(message) {
    const text = normalize(message);
    const lower = text.toLowerCase();
    const explicitAutomation = /\b(?:automation|automate|recurring|schedule this|scheduled task)\b/i.test(text);
    const cadence = /\b(?:every|each)\s+(?:morning|afternoon|evening|night|day|weekday|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s+(?:minutes?|hours?))\b|\bdaily\b|\bweekly\b/i.test(text);
    const actionable = /\b(?:check|scan|monitor|look|summari[sz]e|prepare|review|find|watch|run|notify|email|gmail|calendar|inbox)\b/i.test(text);
    if (!(actionable && (cadence || explicitAutomation))) return null;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    let schedule = null;

    const interval = lower.match(/\bevery\s+(\d+)\s*(minutes?|hours?)\b/i);
    if (interval) {
      let minutes = Number(interval[1]);
      if (/hour/i.test(interval[2])) minutes *= 60;
      schedule = { type: 'interval', minutes: Math.max(5, Math.min(10080, minutes)), timezone };
    }

    if (!schedule) {
      const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const dayIndex = weekdays.findIndex(day => new RegExp(`\\b(?:every|each)\\s+${day}\\b`, 'i').test(text));
      if (dayIndex >= 0 || /\bweekly\b/i.test(text)) {
        schedule = {
          type: 'weekly',
          weekday: dayIndex >= 0 ? dayIndex : 0,
          time: parseTime(text, /\bevening\b/i.test(text) ? '19:00' : /\bafternoon\b/i.test(text) ? '15:00' : '08:00'),
          timezone
        };
      }
    }

    if (!schedule) {
      const fallback = /\bevening\b/i.test(text) ? '19:00'
        : /\bafternoon\b/i.test(text) ? '15:00'
          : /\bnight\b/i.test(text) ? '21:00'
            : '08:00';
      schedule = { type: 'daily', time: parseTime(text, fallback), timezone };
    }

    const goal = cleanAutomationGoal(text);
    const name = automationName(goal, text);
    return { name, goal, schedule, enabled: true };
  }

  function automationAgentResponse(parsed) {
    const label = scheduleLabel(parsed.schedule);
    const shortGoal = parsed.goal.length > 150 ? `${parsed.goal.slice(0, 147)}...` : parsed.goal;
    const reply = `Scheduled. Kyle will ${shortGoal.charAt(0).toLowerCase()}${shortGoal.slice(1)} ${label}.`;
    return {
      mode: 'semantic-agent',
      intent: 'create_automation',
      presentation: 'navigate',
      reply,
      voice: reply,
      actions: [{
        tool: 'automation.create',
        args: {
          name: parsed.name,
          enabled: true,
          schedule: parsed.schedule,
          goal: parsed.goal,
          explicit_user_request: true
        },
        reason: 'The user explicitly requested a recurring Kyle automation.'
      }]
    };
  }

  function jsonResponse(payload) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  window.fetch = async function (input, init = {}) {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input?.url, window.location.href); }
    catch (_) { return priorFetch(input, init); }

    const method = String(init.method || input?.method || 'GET').toUpperCase();

    // Recurring requests are deterministic product commands. Do not send them
    // through the generic mail planner, where "prepare a summary" can be
    // mistaken for "prepare an email draft".
    if (method === 'POST' && url.pathname === '/api/kyle/agent') {
      try {
        const rawBody = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        const parsed = parseAutomationPrompt(rawBody?.message || '');
        if (parsed) return jsonResponse(automationAgentResponse(parsed));
      } catch (_) {}
    }

    const response = await priorFetch(input, init);

    if (method === 'GET' && url.pathname === '/api/dashboard/overview' && response.ok) {
      firstOverviewReady = true;
      maybeFinishBoot();
    }
    if (method === 'GET' && url.pathname === '/api/calendar/events' && response.ok) {
      firstCalendarReady = true;
      maybeFinishBoot();
    }

    return response;
  };
  window.fetch.__mailmateProductV9 = true;

  function installAutomationTool() {
    if (toolWrapped || !window.KyleTools?.run) return false;
    toolWrapped = true;
    const originalRun = window.KyleTools.run.bind(window.KyleTools);
    window.KyleTools.run = async function (toolName, args = {}, transaction) {
      if (toolName !== 'automation.create') return originalRun(toolName, args, transaction);
      if (!args.explicit_user_request) throw new Error('Automation creation requires an explicit recurring request.');
      const name = normalize(args.name).slice(0, 100);
      const goal = normalize(args.goal).slice(0, 1200);
      if (!name || !goal || !args.schedule) throw new Error('Automation name, schedule, and goal are required.');
      const response = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          enabled: args.enabled !== false,
          schedule: args.schedule,
          action: { type: 'kyle_goal', goal },
          output: { type: 'work_summary' }
        })
      });
      const automation = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(automation.error || `Automation create returned ${response.status}`);
      try { await window.AgentAutomations?.refresh?.(); } catch (_) {}
      return {
        ok: true,
        automation,
        reference: {
          type: 'automation',
          id: String(automation.id || ''),
          label: automation.name || name
        }
      };
    };
    return true;
  }

  function applyHistoryPreference() {
    const mount = document.getElementById('kyleMount');
    const widget = mount?.querySelector('.kyle-widget');
    if (!mount || !widget) return;
    const overview = mount.classList.contains('kyle-overview-mount');
    widget.classList.toggle('mailmate-history-closed', overview || !historyOpen);
    if (overview) widget.classList.add('is-conversation-minimized');
    else widget.classList.toggle('is-conversation-minimized', !historyOpen);

    const toggle = widget.querySelector('.kyle-history-toggle');
    if (toggle && !toggle.hidden) {
      const nextIcon = historyOpen && !overview
        ? '<i class="fas fa-minus"></i>'
        : '<i class="fas fa-plus"></i>';
      const nextTitle = historyOpen && !overview ? 'Hide conversation' : 'Show conversation';
      if (toggle.innerHTML !== nextIcon) toggle.innerHTML = nextIcon;
      if (toggle.title !== nextTitle) toggle.title = nextTitle;
      if (toggle.getAttribute('aria-label') !== nextTitle) {
        toggle.setAttribute('aria-label', nextTitle);
      }
    }
  }

  function bindHistoryToggle() {
    document.addEventListener('click', event => {
      const toggle = event.target?.closest?.('.kyle-history-toggle');
      if (!toggle) return;
      const mount = document.getElementById('kyleMount');
      if (!mount || mount.classList.contains('kyle-overview-mount')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      historyOpen = !historyOpen;
      applyHistoryPreference();
    }, true);
  }

  function observeKyleMount() {
    const mount = document.getElementById('kyleMount');
    if (!mount) return;

    let scheduled = false;
    const applyMountState = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        installAutomationTool();
        patchCanvasPollingMotion();
        applyHistoryPreference();
        if (!bootDone && currentContextReady()) maybeFinishBoot();
      });
    };

    const observer = new MutationObserver(applyMountState);
    observer.observe(mount, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'data-state']
    });
  }

  function boot() {
    createBootGate();
    document.getElementById('mailmateInitialLoader')?.remove();
    bindHistoryToggle();
    installAutomationTool();
    patchCanvasPollingMotion();
    applyHistoryPreference();
    observeKyleMount();

    if (currentContextReady()) maybeFinishBoot();
    const readinessTimer = setInterval(() => {
      installAutomationTool();
      patchCanvasPollingMotion();
      applyHistoryPreference();
      if (currentContextReady()) maybeFinishBoot();
      if (bootDone) clearInterval(readinessTimer);
    }, 80);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
