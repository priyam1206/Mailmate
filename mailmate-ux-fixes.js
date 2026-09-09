(function () {
  'use strict';

  if (window.__MAILMATE_UX_FIXES_V3__) return;
  window.__MAILMATE_UX_FIXES_V3__ = true;

  const previousFetch = window.fetch.bind(window);
  const SENT_HISTORY_KEY = 'mailmate.kyle.sent-history.v1';
  const LAST_SENT_KEY = 'mailmate.kyle.last-sent.v2';
  const LONG_MAIL_WORDS = 140;
  const LONG_MAIL_CHARS = 1100;
  const AUTO_SEND_DELAY_MS = 10000;
  let captionGeneration = 0;
  let countdownGeneration = 0;
  let inboxSearch = '';
  let inboxSort = 'smart';
  let applyingInboxView = false;

  function injectStyles() {
    if (document.querySelector('link[data-mailmate-ux-fixes]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './mailmate-ux-fixes.css?v=1';
    link.dataset.mailmateUxFixes = '1';
    document.head.appendChild(link);
  }

  function jsonResponse(payload, status = 200, headers = {}) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
    });
  }

  function parseJsonBody(init) {
    try {
      return typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    } catch (_) {
      return null;
    }
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function wordCount(value) {
    const text = normalizeText(value);
    return text ? text.split(' ').length : 0;
  }

  function isLongMail(body) {
    const text = String(body || '').trim();
    return wordCount(text) >= LONG_MAIL_WORDS || text.length >= LONG_MAIL_CHARS;
  }

  function isDraftControlIntent(message) {
    const text = normalizeText(message).toLowerCase();
    if (!text) return false;
    if (/\b(?:re[- ]?send|send\s+(?:it|that|draft|email|mail|message)|looks good.*send)\b/.test(text)) return true;
    if (/\b(?:edit|rewrite|revise|change|modify|shorter|longer|brief|concise|formal|casual|friendly|polite|professional)\b/.test(text)) return true;
    if (/\b(?:add|remove|replace|fix)\b/.test(text) && !/\b(?:calendar|schedule|assignment|class|event)\b/.test(text)) return true;
    if (/\b(?:subject|recipient|email body|mail body|draft)\b/.test(text)) return true;
    return false;
  }

  function composerWasSent() {
    return document.getElementById('kyleActionPanel')?.dataset?.composerState === 'sent';
  }

  function shouldDetachDraft(message) {
    if (composerWasSent()) return true;
    return !isDraftControlIntent(message);
  }

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);
  }

  function assignmentRangeIntent(message) {
    const text = normalizeText(message).toLowerCase();
    if (!/\b(?:assignment|assignments|deadline|deadlines|submission|submissions|assessment|assessments|case study|project due|pending work)\b/.test(text)) return null;
    if (!/\b(?:pending|due|left|remaining|have|what|which|show|list|any)\b/.test(text)) return null;
    const now = new Date();
    if (/\bthis\s+month\b/.test(text)) {
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1, 12),
        end: endOfMonth(now),
        label: now.toLocaleDateString([], { month: 'long', year: 'numeric' })
      };
    }
    if (/\bnext\s+month\b/.test(text)) {
      const start = new Date(now.getFullYear(), now.getMonth() + 1, 1, 12);
      return { start, end: endOfMonth(start), label: start.toLocaleDateString([], { month: 'long', year: 'numeric' }) };
    }
    return null;
  }

  function parseDeadline(value) {
    if (!value) return null;
    const raw = String(value).trim();
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    return null;
  }

  function assignmentLike(value) {
    return /\b(?:assignment|submission|deadline|assessment|case study|project|\bda\b|deliverable|homework|task)\b/i.test(String(value || ''));
  }

  function formatDue(date) {
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  async function assignmentPayload(request) {
    const url = new URL('/api/calendar/events', window.location.origin);
    url.searchParams.set('start', dateKey(request.start));
    url.searchParams.set('end', dateKey(request.end));
    url.searchParams.set('limit', '250');
    const response = await previousFetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const raw = await response.json().catch(() => []);
    const events = (Array.isArray(raw) ? raw : raw.events || [])
      .filter(event => event && event.status !== 'cancelled')
      .filter(event => assignmentLike(`${event.title || ''} ${event.description || ''}`))
      .map(event => ({
        id: event.id,
        title: event.title || 'Assignment',
        due: parseDeadline(event.start),
        source: event.source || 'google',
        detail: normalizeText(event.description || event.location || '').slice(0, 220)
      }))
      .filter(item => item.due);

    const context = window.Kyle?.store?.context || {};
    const attention = Array.isArray(context.needs_attention) ? context.needs_attention : [];
    attention.forEach(item => {
      if (!assignmentLike(`${item.subject || item.title || ''} ${item.description || item.reason || ''}`)) return;
      const due = parseDeadline(item.deadline);
      if (!due || due < request.start || due > request.end) return;
      const id = `attention-${item.source_message_id || item.message_id || item.id || due.getTime()}`;
      if (events.some(existing => existing.title === (item.subject || item.title) && Math.abs(existing.due - due) < 3600000)) return;
      events.push({
        id,
        title: item.subject || item.title || 'Assignment',
        due,
        source: 'email',
        detail: normalizeText(item.description || item.reason || '').slice(0, 220)
      });
    });

    events.sort((a, b) => a.due - b.due);
    const now = new Date();
    const pending = events.filter(item => item.due >= now);
    const reply = pending.length
      ? `You have ${pending.length} pending assignment${pending.length === 1 ? '' : 's'} or submission${pending.length === 1 ? '' : 's'} in ${request.label}.`
      : `I found no pending assignments or submissions in ${request.label}.`;

    return {
      reply,
      text: reply,
      voice: reply,
      actions: [],
      mode: 'semantic-agent',
      presentation: 'canvas',
      canvas: {
        title: `Pending work · ${request.label}`,
        lede: pending.length ? 'These are the dated assignment and submission items I found across Calendar and current mail context.' : 'No dated assignment or submission items remain in this range.',
        highlights: [
          { label: 'Pending', value: String(pending.length) },
          { label: 'Range', value: request.label }
        ],
        sections: pending.length ? [{
          heading: 'Assignments & submissions',
          items: pending.map(item => ({
            title: item.title,
            detail: item.detail,
            meta: `${formatDue(item.due)} · ${item.source === 'email' ? 'Mail deadline' : 'Calendar'}`
          }))
        }] : []
      },
      handled: true
    };
  }

  function draftFromActions(actions) {
    const writeActions = (actions || []).filter(action => ['mail.compose', 'mail.reply', 'mail.update_draft'].includes(action?.tool));
    const action = writeActions[writeActions.length - 1];
    return action?.args || null;
  }

  function applySendPolicy(payload) {
    if (!payload || !Array.isArray(payload.actions)) return payload;
    const sendIndex = payload.actions.findIndex(action => action?.tool === 'mail.send_draft');
    if (sendIndex < 0) return payload;
    const draft = draftFromActions(payload.actions) || window.KyleUi?.active?.getActiveDraft?.() || {};
    const body = draft.body || '';

    if (isLongMail(body)) {
      payload.actions = payload.actions.filter(action => action?.tool !== 'mail.send_draft');
      payload.manual_send_required = true;
      payload.reply = 'Draft ready for review. This is a longer email, so I will not auto-send it. Read it and click Send when you approve it.';
      payload.text = payload.reply;
      payload.voice = 'The draft is ready. It is a longer email, so I left sending for you to approve manually.';
      return payload;
    }

    payload.actions[sendIndex] = {
      ...payload.actions[sendIndex],
      args: { ...(payload.actions[sendIndex].args || {}), send_delay_ms: AUTO_SEND_DELAY_MS }
    };
    payload.auto_send_delay_ms = AUTO_SEND_DELAY_MS;
    payload.reply = 'Draft ready. I will send it in 10 seconds so you have time to read it first.';
    payload.text = payload.reply;
    payload.voice = 'The draft is ready. I will send it in ten seconds unless you send it yourself first.';
    return payload;
  }

  function responseFrom(original, payload) {
    const headers = {};
    original.headers?.forEach?.((value, key) => { if (key.toLowerCase() !== 'content-length') headers[key] = value; });
    headers['Content-Type'] = 'application/json';
    headers['Cache-Control'] = 'no-store';
    return jsonResponse(payload, original.status, headers);
  }

  function installAgentGuard() {
    if (window.fetch.__mailmateUxV3) return;
    const guarded = async function (input, init = {}) {
      let url;
      try { url = new URL(typeof input === 'string' ? input : input?.url, window.location.href); }
      catch (_) { return previousFetch(input, init); }

      if (url.pathname !== '/api/kyle/agent' || String(init.method || 'GET').toUpperCase() !== 'POST') {
        return previousFetch(input, init);
      }

      let body = parseJsonBody(init);
      const message = normalizeText(body?.message || '');
      if (!body || !message) return previousFetch(input, init);

      const assignmentRequest = assignmentRangeIntent(message);
      if (assignmentRequest) {
        try {
          const payload = await assignmentPayload(assignmentRequest);
          if (payload) return jsonResponse(payload);
        } catch (error) {
          console.warn('[Mailmate UX] assignment range read failed:', error);
        }
      }

      if (body.activeDraft && shouldDetachDraft(message)) {
        body = { ...body, activeDraft: null };
        init = { ...init, body: JSON.stringify(body) };
      }

      const response = await previousFetch(input, init);
      if (!response.ok) return response;
      const contentType = response.headers?.get?.('content-type') || '';
      if (!contentType.includes('application/json')) return response;
      const payload = await response.clone().json().catch(() => null);
      if (!payload) return response;
      return responseFrom(response, applySendPolicy(payload));
    };
    guarded.__mailmateUxV3 = true;
    window.fetch = guarded;
  }

  function readSentHistory() {
    try {
      const data = JSON.parse(sessionStorage.getItem(SENT_HISTORY_KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch (_) {
      return [];
    }
  }

  function writeSentHistory(items) {
    try { sessionStorage.setItem(SENT_HISTORY_KEY, JSON.stringify(items.slice(-8))); } catch (_) {}
  }

  function archiveSentDraft(draft, result = {}) {
    if (!draft?.to && !draft?.recipient) return;
    const entry = {
      id: result.messageId || result.message_id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      to: normalizeText(draft.to || draft.recipient),
      subject: normalizeText(draft.subject || '') || '(no subject)',
      body: String(draft.body || '').trim(),
      sentAt: new Date().toISOString()
    };
    const history = readSentHistory().filter(item => item.id !== entry.id);
    history.push(entry);
    writeSentHistory(history);
    renderSentHistory();
  }

  function renderSentHistory() {
    const canvasHistory = document.getElementById('kyleCanvasHistory');
    if (!canvasHistory?.parentElement) return;
    let host = document.getElementById('mailmateSentHistory');
    if (!host) {
      host = document.createElement('div');
      host.id = 'mailmateSentHistory';
      host.className = 'mailmate-sent-history';
      canvasHistory.insertAdjacentElement('afterend', host);
    }
    const history = readSentHistory().slice(-3).reverse();
    host.hidden = history.length === 0;
    host.innerHTML = history.map(item => `
      <details class="mailmate-sent-card">
        <summary>
          <span class="mailmate-sent-dot"><i class="fas fa-check"></i></span>
          <span><strong>Email sent</strong><small>${escapeHtml(item.to)} · ${escapeHtml(item.subject)}</small></span>
          <time>${escapeHtml(new Date(item.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</time>
        </summary>
        <div class="mailmate-sent-body">${escapeHtml(item.body)}</div>
      </details>`).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function lastSentReceipt() {
    try { return JSON.parse(sessionStorage.getItem(LAST_SENT_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function installComposerRuntime() {
    const ui = window.KyleUi?.active;
    if (!ui || ui.__mailmateUxV3) return false;

    const originalOpen = ui.openComposer?.bind(ui);
    const originalSend = ui.sendCurrentComposer?.bind(ui);
    const originalSubtitle = ui.setSubtitle?.bind(ui);
    if (!originalOpen || !originalSend || !originalSubtitle) return false;

    ui.openComposer = function (draft = {}, mode = 'reply') {
      const result = originalOpen(draft, mode);
      setTimeout(() => {
        const status = isLongMail(draft.body)
          ? 'Long email · manual review required before sending'
          : 'Review ready · auto-send waits 10 seconds when Kyle is asked to send';
        ui.setComposerStatus?.(status);
        document.getElementById('kyleActionPanel')?.classList.toggle('mailmate-long-draft', isLongMail(draft.body));
      }, 40);
      return result;
    };

    ui.sendCurrentComposer = async function () {
      const draft = ui.getActiveDraft?.() || null;
      const result = await originalSend();
      if (result?.ok && draft) {
        archiveSentDraft(draft, result);
        if (window.KyleCanvas?.state) window.KyleCanvas.state.composerOwnsCanvas = false;
        setTimeout(() => {
          if (document.getElementById('kyleActionPanel')?.dataset?.composerState === 'sent') {
            ui.closeSurface?.();
          }
        }, 1400);
      }
      return result;
    };

    ui.setSubtitle = function (text, options = {}) {
      const generation = ++captionGeneration;
      originalSubtitle(text, options);
      const value = normalizeText(text);
      if (!value) return;
      const retryLike = /retry|did not complete|working|checking|thinking|opening|sending/i.test(value);
      const timeout = retryLike ? 2400 : 5200;
      setTimeout(() => {
        if (generation !== captionGeneration) return;
        originalSubtitle('', {});
      }, timeout);
    };

    const input = document.querySelector('.kyle-floating-mount .prompt-input, .prompt-input');
    input?.addEventListener('focus', () => ui.setSubtitle?.(''));
    input?.addEventListener('input', () => ui.setSubtitle?.(''));

    ui.__mailmateUxV3 = true;
    return true;
  }

  async function runDelayedSend(originalRun, tool, args, transaction) {
    const ui = window.KyleUi?.active;
    const initial = ui?.getActiveDraft?.() || {};
    if (isLongMail(initial.body)) {
      ui?.setComposerStatus?.('Long email · review it and click Send when you approve.');
      return { ok: false, manualReview: true, error: 'Long email requires manual review before sending.' };
    }

    const token = ++countdownGeneration;
    let deadline = Date.now() + Math.max(1000, Number(args?.send_delay_ms || AUTO_SEND_DELAY_MS));
    let lastSubject = String(initial.subject || '');
    let lastBody = String(initial.body || '');

    while (token === countdownGeneration) {
      const snapshot = ui?.getComposerSnapshot?.() || {};
      if (snapshot.state === 'sent') {
        const receipt = lastSentReceipt() || {};
        return { ok: true, messageId: receipt.message_id || receipt.messageId || 'already-sent' };
      }

      const active = ui?.getActiveDraft?.() || {};
      const subject = String(active.subject || '');
      const body = String(active.body || '');
      if (subject !== lastSubject || body !== lastBody) {
        lastSubject = subject;
        lastBody = body;
        deadline = Date.now() + AUTO_SEND_DELAY_MS;
      }

      const remaining = Math.max(0, deadline - Date.now());
      if (remaining <= 0) break;
      ui?.setComposerStatus?.(`Sending in ${Math.ceil(remaining / 1000)}s · read or edit first · click Send to send now`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    ui?.setComposerStatus?.('Sending through Gmail…');
    return originalRun(tool, { ...args, send_delay_ms: 0 }, transaction);
  }

  function installToolSendDelay() {
    const tools = window.KyleTools;
    if (!tools?.run || tools.__mailmateUxV3) return false;
    const originalRun = tools.run.bind(tools);
    tools.run = function (tool, args = {}, transaction) {
      if (tool === 'mail.send_draft' && Number(args?.send_delay_ms || 0) > 0) {
        return runDelayedSend(originalRun, tool, args, transaction);
      }
      return originalRun(tool, args, transaction);
    };
    tools.__mailmateUxV3 = true;
    return true;
  }

  function emailContextMap() {
    const emails = window.Kyle?.store?.context?.emails || [];
    const map = new Map();
    emails.forEach(email => {
      const id = String(email.id || email.gmail_id || email.message_id || '');
      if (id) map.set(id, email);
    });
    return map;
  }

  function emailTimestamp(email, item) {
    const value = email?.date || email?.timestamp || item?.querySelector('time')?.dateTime || '';
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function smartScore(email, item) {
    const context = email?.context_scores || {};
    let score = 0;
    if (item.classList.contains('is-important') || email?.important) score += 100;
    if (context.requires_reply) score += 90;
    if (context.work_allowed) score += 80;
    if (context.attention_allowed) score += 70;
    if (item.classList.contains('is-unread') || email?.is_read === false) score += 35;
    const ageHours = Math.max(0, (Date.now() - emailTimestamp(email, item)) / 3600000);
    score += Math.max(0, 40 - Math.min(40, ageHours / 6));
    return score;
  }

  function animateInboxResults(list) {
    list.classList.remove('mailmate-results-arrive');
    void list.offsetWidth;
    list.classList.add('mailmate-results-arrive');
  }

  function applyInboxView() {
    if (applyingInboxView) return;
    const list = document.getElementById('emailList');
    if (!list) return;
    const items = [...list.querySelectorAll('.email-item')];
    if (!items.length) return;
    applyingInboxView = true;
    const contextMap = emailContextMap();
    const query = inboxSearch.toLowerCase();

    items.forEach(item => {
      const haystack = normalizeText(item.textContent).toLowerCase();
      item.hidden = Boolean(query) && !haystack.includes(query);
    });

    const visible = items.filter(item => !item.hidden);
    visible.sort((a, b) => {
      const aEmail = contextMap.get(String(a.dataset.kyleId || '')) || {};
      const bEmail = contextMap.get(String(b.dataset.kyleId || '')) || {};
      const aTime = emailTimestamp(aEmail, a);
      const bTime = emailTimestamp(bEmail, b);
      if (inboxSort === 'oldest') return aTime - bTime;
      if (inboxSort === 'newest') return bTime - aTime;
      if (inboxSort === 'important') {
        const ai = a.classList.contains('is-important') ? 1 : 0;
        const bi = b.classList.contains('is-important') ? 1 : 0;
        return bi - ai || bTime - aTime;
      }
      return smartScore(bEmail, b) - smartScore(aEmail, a) || bTime - aTime;
    });
    visible.forEach(item => list.appendChild(item));

    const count = document.getElementById('inboxCount');
    if (count && query) count.textContent = `${visible.length} result${visible.length === 1 ? '' : 's'} for “${inboxSearch}”`;
    animateInboxResults(list);
    setTimeout(() => { applyingInboxView = false; }, 0);
  }

  function ensureInboxTools() {
    const toolbar = document.querySelector('#tab-inbox .inbox-toolbar');
    if (!toolbar || document.getElementById('mailmateInboxTools')) return;
    const count = document.getElementById('inboxCount');
    const tools = document.createElement('div');
    tools.id = 'mailmateInboxTools';
    tools.className = 'mailmate-inbox-tools';
    tools.innerHTML = `
      <div class="mailmate-search-wrap" id="mailmateSearchWrap">
        <button class="mailmate-tool-btn" id="mailmateSearchToggle" type="button" aria-label="Search inbox"><i class="fas fa-magnifying-glass"></i><span>Search</span></button>
        <label class="mailmate-search-field" for="mailmateInboxSearch"><i class="fas fa-magnifying-glass"></i><input id="mailmateInboxSearch" type="search" placeholder="Search sender, subject or message"><button id="mailmateSearchClose" type="button" aria-label="Close search"><i class="fas fa-xmark"></i></button></label>
      </div>
      <div class="mailmate-sort-wrap">
        <button class="mailmate-tool-btn" id="mailmateSortToggle" type="button" aria-haspopup="menu" aria-expanded="false"><i class="fas fa-arrow-down-wide-short"></i><span>Sort</span></button>
        <div class="mailmate-sort-menu" id="mailmateSortMenu" role="menu">
          <button type="button" data-sort="smart"><span>Smart priority</span><small>AI signals + urgency</small></button>
          <button type="button" data-sort="newest"><span>Newest first</span><small>Latest received</small></button>
          <button type="button" data-sort="oldest"><span>Oldest first</span><small>Earliest received</small></button>
          <button type="button" data-sort="important"><span>Important first</span><small>Gmail + MailMate importance</small></button>
        </div>
      </div>`;
    if (count?.parentElement === toolbar) toolbar.insertBefore(tools, count);
    else toolbar.appendChild(tools);

    const wrap = document.getElementById('mailmateSearchWrap');
    const input = document.getElementById('mailmateInboxSearch');
    document.getElementById('mailmateSearchToggle')?.addEventListener('click', () => {
      wrap.classList.add('is-open');
      setTimeout(() => input?.focus(), 180);
    });
    document.getElementById('mailmateSearchClose')?.addEventListener('click', () => {
      inboxSearch = '';
      if (input) input.value = '';
      wrap.classList.remove('is-open');
      applyInboxView();
    });
    let searchTimer = null;
    input?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        inboxSearch = input.value.trim();
        applyInboxView();
      }, 70);
    });

    const menu = document.getElementById('mailmateSortMenu');
    const sortToggle = document.getElementById('mailmateSortToggle');
    sortToggle?.addEventListener('click', event => {
      event.stopPropagation();
      const open = menu.classList.toggle('is-open');
      sortToggle.setAttribute('aria-expanded', String(open));
    });
    menu?.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
      inboxSort = button.dataset.sort || 'smart';
      menu.classList.remove('is-open');
      sortToggle?.setAttribute('aria-expanded', 'false');
      sortToggle?.querySelector('span') && (sortToggle.querySelector('span').textContent = button.querySelector('span')?.textContent || 'Sort');
      applyInboxView();
    }));
    document.addEventListener('click', event => {
      if (!event.target.closest('.mailmate-sort-wrap')) {
        menu?.classList.remove('is-open');
        sortToggle?.setAttribute('aria-expanded', 'false');
      }
    });

    const list = document.getElementById('emailList');
    if (list && !list.__mailmateSearchObserver) {
      const observer = new MutationObserver(() => {
        if (applyingInboxView) return;
        clearTimeout(list.__mailmateApplyTimer);
        list.__mailmateApplyTimer = setTimeout(applyInboxView, 30);
      });
      observer.observe(list, { childList: true });
      list.__mailmateSearchObserver = observer;
    }
  }

  function setInboxLayoutClass() {
    document.body.classList.toggle('mailmate-inbox-active', Boolean(document.getElementById('tab-inbox')?.classList.contains('active')));
  }

  function formatEventWindow(event) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (Number.isNaN(start.getTime())) return '';
    const options = { hour: 'numeric', minute: '2-digit' };
    if (Number.isNaN(end.getTime())) return start.toLocaleTimeString([], options);
    return `${start.toLocaleTimeString([], options)}–${end.toLocaleTimeString([], options)}`;
  }

  async function renderOverviewConflicts() {
    const upcoming = document.querySelector('#tab-overview .upcoming-section');
    if (!upcoming || !window.CalendarConflicts?.annotate) return;
    const now = new Date();
    const start = new Date(now);
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    try {
      const url = new URL('/api/calendar/events', window.location.origin);
      url.searchParams.set('start', dateKey(start));
      url.searchParams.set('end', dateKey(end));
      url.searchParams.set('limit', '250');
      const response = await previousFetch(url, { cache: 'no-store' });
      if (!response.ok) return;
      const raw = await response.json().catch(() => []);
      const events = Array.isArray(raw) ? raw : raw.events || [];
      const result = window.CalendarConflicts.annotate(events);
      const pairs = result.pairs || [];
      const byId = new Map((result.events || []).map(event => [String(event.id), event]));
      let card = document.getElementById('mailmateOverviewConflicts');
      if (!pairs.length) {
        card?.remove();
        return;
      }
      if (!card) {
        card = document.createElement('div');
        card.id = 'mailmateOverviewConflicts';
        card.className = 'mailmate-overview-conflicts';
        upcoming.querySelector('.section-heading')?.insertAdjacentElement('afterend', card);
      }
      card.innerHTML = `
        <button type="button" class="mailmate-conflict-head">
          <span><i class="fas fa-triangle-exclamation"></i></span>
          <div><strong>${pairs.length} schedule clash${pairs.length === 1 ? '' : 'es'} this week</strong><small>Open Calendar to inspect the overlapping events.</small></div>
          <i class="fas fa-arrow-right"></i>
        </button>
        <div class="mailmate-conflict-list">
          ${pairs.slice(0, 3).map(pair => {
            const a = byId.get(String(pair.a)) || {};
            const b = byId.get(String(pair.b)) || {};
            return `<div><span>${escapeHtml(a.title || 'Event')} <small>${escapeHtml(formatEventWindow(a))}</small></span><i class="fas fa-code-branch"></i><span>${escapeHtml(b.title || 'Event')} <small>${escapeHtml(formatEventWindow(b))}</small></span></div>`;
          }).join('')}
        </div>`;
      card.querySelector('.mailmate-conflict-head')?.addEventListener('click', () => document.querySelector('.nav-tab[data-tab="calendar"]')?.click());
    } catch (error) {
      console.warn('[Mailmate UX] overview conflict read failed:', error);
    }
  }

  function installLayoutObservers() {
    ensureInboxTools();
    setInboxLayoutClass();
    renderSentHistory();
    renderOverviewConflicts();

    document.querySelectorAll('.nav-tab').forEach(button => {
      if (button.dataset.mailmateUxBound === '1') return;
      button.dataset.mailmateUxBound = '1';
      button.addEventListener('click', () => {
        setTimeout(() => {
          setInboxLayoutClass();
          ensureInboxTools();
          if (button.dataset.tab === 'overview') renderOverviewConflicts();
        }, 40);
      });
    });

    window.addEventListener('harness:calendar-refresh', () => setTimeout(renderOverviewConflicts, 250));
    window.addEventListener('focus', () => {
      if (document.getElementById('tab-overview')?.classList.contains('active')) renderOverviewConflicts();
    });
  }

  injectStyles();
  installAgentGuard();

  const runtimeTimer = setInterval(() => {
    const a = installComposerRuntime();
    const b = installToolSendDelay();
    if (a && b) clearInterval(runtimeTimer);
  }, 80);
  setTimeout(() => clearInterval(runtimeTimer), 12000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installLayoutObservers, { once: true });
  } else {
    installLayoutObservers();
  }
})();
