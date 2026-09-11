(function () {
  'use strict';

  if (window.__MAILMATE_PRODUCT_V5__) return;
  window.__MAILMATE_PRODUCT_V5__ = true;

  const priorFetch = window.fetch.bind(window);
  let cleanupTimer = null;

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  function simpleNavigation(message) {
    const text = normalize(message).toLowerCase();
    const pages = [
      ['overview', /\b(?:open|show|go(?:\s+back)?\s+to|take me to)\s+(?:the\s+)?overview\b/],
      ['inbox', /\b(?:open|show|go\s+to|take me to)\s+(?:my\s+)?inbox\b/],
      ['work', /\b(?:open|show|go\s+to|take me to)\s+(?:my\s+)?work(?:space)?\b/],
      ['calendar', /\b(?:open|show|go\s+to|take me to)\s+(?:my\s+)?calendar\b/],
      ['automations', /\b(?:open|show|go\s+to|take me to)\s+(?:my\s+)?automations?\b/],
      ['settings', /\b(?:open|show|go\s+to|take me to)\s+(?:my\s+)?settings\b/]
    ];
    for (const [page, pattern] of pages) {
      if (pattern.test(text)) return page;
    }
    return null;
  }

  function topMailIntent(message) {
    const text = normalize(message).toLowerCase();
    if (/\b(?:this|that|selected|open|current)\s+(?:email|mail|message|thread)\b/i.test(text)) return false;
    if (/\bsummari[sz]e\b/i.test(text)) return false;
    if (!/\b(?:email|emails|mail|mails|messages)\b/.test(text)) return false;
    return /\b(?:top|important|priority|urgent|most important|what matters|worth reading|need attention)\b/.test(text)
      || /\b(?:show|tell|give|list)\b.*\b(?:important|priority|top)\b/.test(text);
  }

  function senderName(email) {
    const raw = String(email?.sender || email?.from?.name || email?.from?.email || 'Unknown sender');
    return raw.split('<')[0].replace(/["']/g, '').trim() || raw;
  }

  function emailId(email) {
    return String(email?.id || email?.gmail_id || email?.message_id || '');
  }

  function rankTopEmails(context) {
    const emails = Array.isArray(context?.emails) ? context.emails : [];
    const attentionIds = new Set((context?.needs_attention || []).map(item => String(item?.source_message_id || item?.message_id || item?.email_id || item?.id || '')).filter(Boolean));
    const now = Date.now();

    return emails.map((email, index) => {
      const labels = new Set(email?.labels || []);
      const text = `${email?.subject || ''} ${email?.snippet || ''}`.toLowerCase();
      let score = 0;
      const reasons = [];
      if (attentionIds.has(emailId(email))) { score += 60; reasons.push('needs attention'); }
      if (email?.is_important || email?.is_starred || labels.has('IMPORTANT') || labels.has('STARRED')) { score += 35; reasons.push('important'); }
      if (email?.is_read === false || labels.has('UNREAD')) { score += 12; reasons.push('unread'); }
      if (/\b(?:urgent|asap|deadline|due today|action required|reply required|approval|mandatory|interview|exam|submission)\b/.test(text)) { score += 28; reasons.push('time-sensitive'); }
      if (/\b(?:newsletter|promotion|sale|discount|offer|unsubscribe)\b/.test(text)) score -= 18;

      let timestamp = 0;
      const rawTime = email?.internal_date || email?.internalDate || email?.timestamp || email?.date;
      if (rawTime) {
        const numeric = Number(rawTime);
        timestamp = Number.isFinite(numeric) && numeric > 1000000000
          ? (numeric > 1000000000000 ? numeric : numeric * 1000)
          : Date.parse(rawTime) || 0;
      }
      if (timestamp) {
        const ageHours = Math.max(0, (now - timestamp) / 3600000);
        score += Math.max(0, 16 - Math.min(16, ageHours / 6));
      }
      score += Math.max(0, 4 - index * 0.05);
      return { email, score, reasons };
    }).sort((a, b) => b.score - a.score).slice(0, 5);
  }

  function topMailPayload(message, body) {
    const context = body?.context || window.Kyle?.store?.context || {};
    const ranked = rankTopEmails(context);
    if (!ranked.length) {
      return {
        mode: 'semantic-agent',
        handled: true,
        actions: [],
        reply: 'I do not have enough current inbox context to rank your emails yet. Refresh Inbox once and ask me again.',
        text: 'I do not have enough current inbox context to rank your emails yet. Refresh Inbox once and ask me again.',
        voice: 'I need the current inbox context first. Refresh Inbox once and ask me again.'
      };
    }

    const lines = ranked.map(({ email, reasons }, index) => {
      const subject = normalize(email?.subject || 'No subject');
      const sender = senderName(email);
      const reason = reasons.length ? ` — ${[...new Set(reasons)].slice(0, 2).join(', ')}` : '';
      return `${index + 1}. **${subject}** — ${sender}${reason}`;
    });
    const reply = `Your top emails right now:\n${lines.join('\n')}\n\nI ranked these from current attention signals, importance, unread state, urgency language, and recency.`;
    return {
      mode: 'semantic-agent',
      handled: true,
      actions: [],
      presentation: 'chat',
      reply,
      text: reply,
      voice: `I ranked ${ranked.length} emails for you. The most important one is ${normalize(ranked[0].email?.subject || 'the first message')}. The full list is written in the chat.`
    };
  }

  const WEEKDAYS = {
    monday: 0, mon: 0,
    tuesday: 1, tue: 1, tues: 1,
    wednesday: 2, wed: 2,
    thursday: 3, thu: 3, thurs: 3,
    friday: 4, fri: 4,
    saturday: 5, sat: 5,
    sunday: 6, sun: 6
  };

  function parseClock(text, fallback = '08:00') {
    const match = text.match(/\b(?:at\s+)?([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?\b/i);
    if (!match) return fallback;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridiem = String(match[3] || '').toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function automationIntent(message) {
    const text = normalize(message);
    const lower = text.toLowerCase();
    if (/\b(?:open|show|go to)\s+(?:my\s+)?automations?\b/.test(lower)) return null;

    const hasCadence = /\b(?:every|each|daily|weekly|hourly|morning|evening|night|automatically|automation|automate|scheduled?)\b/.test(lower);
    const hasTask = /\b(?:check|watch|monitor|scan|summari[sz]e|tell|notify|look|review|find|remind|track|prepare|run)\b/.test(lower);
    if (!hasCadence || !hasTask) return null;

    let schedule = null;
    let cadenceText = '';
    const interval = lower.match(/\bevery\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/);
    if (interval) {
      const amount = Math.max(1, Number(interval[1]));
      const minutes = /hour|hr/.test(interval[2]) ? amount * 60 : amount;
      schedule = { type: 'interval', minutes: Math.max(5, minutes) };
      cadenceText = interval[0];
    }

    if (!schedule) {
      const weekdayMatch = lower.match(/\b(?:every|each)\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat|sunday|sun)\b/);
      if (weekdayMatch) {
        const fallback = /evening/.test(lower) ? '19:00' : /night/.test(lower) ? '21:00' : '08:00';
        schedule = { type: 'weekly', weekday: WEEKDAYS[weekdayMatch[1]], time: parseClock(lower, fallback) };
        cadenceText = weekdayMatch[0];
      }
    }

    if (!schedule && /\b(?:every day|each day|daily|every morning|each morning|every evening|each evening|every night|each night)\b/.test(lower)) {
      const fallback = /morning/.test(lower) ? '08:00' : /evening/.test(lower) ? '19:00' : /night/.test(lower) ? '21:00' : '08:00';
      schedule = { type: 'daily', time: parseClock(lower, fallback) };
      cadenceText = (lower.match(/\b(?:every day|each day|daily|every morning|each morning|every evening|each evening|every night|each night)\b/) || [''])[0];
    }

    if (!schedule && /\bhourly\b/.test(lower)) {
      schedule = { type: 'interval', minutes: 60 };
      cadenceText = 'hourly';
    }

    if (!schedule) return null;

    let goal = text
      .replace(/\b(?:create|make|set up|setup|add)\s+(?:me\s+)?(?:an?\s+)?automation\s*(?:that|to|for)?\s*/ig, '')
      .replace(/\bautomate\s+/ig, '')
      .replace(/\bautomatically\b/ig, '')
      .replace(new RegExp(cadenceText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '')
      .replace(/\b(?:daily|weekly|hourly)\b/ig, '')
      .replace(/\b(?:at\s+)?(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?\b/ig, '')
      .replace(/\s+/g, ' ')
      .replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, '')
      .trim();

    goal = goal.replace(/^please\s+/i, '').trim();
    if (!goal) goal = 'Check my workspace and summarize anything that needs attention.';
    goal = goal.charAt(0).toUpperCase() + goal.slice(1);
    if (!/[.!?]$/.test(goal)) goal += '.';

    const baseName = /\b(?:email|mail|inbox)\b/i.test(goal)
      ? 'Inbox check'
      : /\b(?:calendar|schedule|class|meeting)\b/i.test(goal)
        ? 'Calendar check'
        : /\b(?:assignment|deadline|submission)\b/i.test(goal)
          ? 'Deadline check'
          : 'Kyle scheduled check';

    return { schedule, goal, name: baseName };
  }

  function automationScheduleLabel(schedule) {
    if (schedule.type === 'interval') {
      if (schedule.minutes % 60 === 0) {
        const hours = schedule.minutes / 60;
        return `every ${hours} hour${hours === 1 ? '' : 's'}`;
      }
      return `every ${schedule.minutes} minutes`;
    }
    if (schedule.type === 'weekly') {
      const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      return `every ${names[schedule.weekday] || 'week'} at ${schedule.time}`;
    }
    return `every day at ${schedule.time}`;
  }

  async function createAutomationFromPrompt(spec, originalMessage) {
    const payload = {
      name: spec.name,
      enabled: true,
      schedule: spec.schedule,
      action: { type: 'kyle_goal', goal: spec.goal },
      output: { type: 'work_summary' }
    };

    const response = await priorFetch('/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const created = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(created.error || `Automation create returned ${response.status}`);

    const id = String(created.id || created.automation?.id || '');
    let started = false;
    if (id) {
      try {
        const runResponse = await priorFetch(`/api/automations/${encodeURIComponent(id)}/run`, { method: 'POST' });
        started = runResponse.ok;
      } catch (_) {}
    }

    try { await window.AgentAutomations?.refresh?.(); } catch (_) {}

    const scheduleText = automationScheduleLabel(spec.schedule);
    const reply = started
      ? `Created **${spec.name}** and started its first run. It will run ${scheduleText}.\n\nAutomation prompt: ${spec.goal}`
      : `Created **${spec.name}**. It is enabled and will run ${scheduleText}.\n\nAutomation prompt: ${spec.goal}`;

    return {
      mode: 'semantic-agent',
      handled: true,
      actions: [],
      presentation: 'chat',
      reply,
      text: reply,
      voice: started
        ? `I created the automation and started its first run. It will continue ${scheduleText}.`
        : `I created and enabled the automation. It will run ${scheduleText}.`,
      automation: created,
      original_request: originalMessage
    };
  }

  function installAgentInterceptors() {
    if (window.fetch.__mailmateProductV5) return;

    const wrapped = async function (input, init = {}) {
      let url;
      try { url = new URL(typeof input === 'string' ? input : input?.url, window.location.href); }
      catch (_) { return priorFetch(input, init); }

      if (url.pathname !== '/api/kyle/agent' || String(init.method || 'GET').toUpperCase() !== 'POST') {
        return priorFetch(input, init);
      }

      let body = null;
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch (_) {}
      const message = normalize(body?.message || '');
      if (!body || !message || body?.uiContext?.briefingOnly) return priorFetch(input, init);

      const page = simpleNavigation(message);
      if (page) {
        return jsonResponse({
          mode: 'semantic-agent',
          handled: true,
          reply: `${page.charAt(0).toUpperCase()}${page.slice(1)} opened.`,
          text: `${page.charAt(0).toUpperCase()}${page.slice(1)} opened.`,
          voice: `${page.charAt(0).toUpperCase()}${page.slice(1)} opened.`,
          actions: [{ tool: 'navigation.open', args: { page } }]
        });
      }

      if (topMailIntent(message) && !body?.selectedEmail && !body?.resolvedReferences?.length) {
        return jsonResponse(topMailPayload(message, body));
      }

      const automation = automationIntent(message);
      if (automation) {
        try {
          return jsonResponse(await createAutomationFromPrompt(automation, message));
        } catch (error) {
          const reply = `I couldn't create that automation: ${error.message || error}`;
          return jsonResponse({ mode: 'semantic-agent', handled: true, actions: [], reply, text: reply, voice: reply });
        }
      }

      return priorFetch(input, init);
    };

    wrapped.__mailmateProductV5 = true;
    window.fetch = wrapped;
  }

  function closeStaleSurface(delay = 1500) {
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(() => {
      const ui = window.KyleUi?.active;
      const panel = document.getElementById('kyleActionPanel');
      const mode = String(panel?.dataset?.mode || '');
      if (!ui || !panel) return;
      if (ui.isComposerOpen?.()) return;
      if (window.KyleExecutor?.pending?.()) return;
      if (!['command', 'activity', 'result'].includes(mode)) return;
      ui.closeSurface?.();
    }, delay);
  }

  function installSurfaceLifecycle() {
    document.addEventListener('submit', event => {
      if (!event.target?.classList?.contains('kyle-shell')) return;
      const ui = window.KyleUi?.active;
      if (!ui?.isComposerOpen?.()) ui?.closeSurface?.();
    }, true);

    window.addEventListener('kyle:action-complete', event => {
      if (event.detail?.error) return;
      closeStaleSurface(1300);
    });

    window.addEventListener('kyle:state', event => {
      const state = String(event.detail?.state || '').toUpperCase();
      if (['DONE', 'SUCCESS', 'IDLE'].includes(state)) closeStaleSurface(1600);
    });
  }

  installAgentInterceptors();
  installSurfaceLifecycle();
})();
