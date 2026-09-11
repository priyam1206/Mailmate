(function () {
  'use strict';

  if (window.__MAILMATE_PRODUCT_V4__) return;
  window.__MAILMATE_PRODUCT_V4__ = true;

  const NETWORK_FETCH = window.fetch.bind(window);
  const BRIEF_CACHE_KEY = 'mailmate.overview.brief.v4';
  const AUTO_SEND_DELAY_MS = 10000;
  let overviewTimer = null;
  let lastBriefFingerprint = '';
  let sendCountdownGeneration = 0;
  const fullEmailCache = new Map();
  let currentEmailForPrompt = null;

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function injectStyles() {
    if (document.querySelector('link[data-mailmate-product-v4]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './mailmate-product-v4.css?v=1';
    link.dataset.mailmateProductV4 = '1';
    document.head.appendChild(link);
  }

  function activeEmailReference() {
    const snapshot = window.MailmateContext?.snapshot?.() || {};
    const candidates = [snapshot.open, snapshot.selected, snapshot.lastClicked, snapshot.references?.lastOpened];
    return candidates.find(ref => ref && ref.type === 'email' && ref.id) || null;
  }

  function emailFromContext(id) {
    const emails = window.Kyle?.store?.context?.emails || [];
    return emails.find(email => String(email?.id || email?.gmail_id || email?.message_id || '') === String(id)) || null;
  }

  async function getFullEmail(id) {
    id = String(id || '');
    if (!id) return null;
    if (fullEmailCache.has(id)) return fullEmailCache.get(id);
    const partial = emailFromContext(id);
    try {
      const response = await NETWORK_FETCH(`/api/gmail/messages/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) return partial;
      const detail = await response.json().catch(() => null);
      const merged = detail ? { ...(partial || {}), ...detail } : partial;
      if (merged) fullEmailCache.set(id, merged);
      return merged;
    } catch (_) {
      return partial;
    }
  }

  function referencesCurrentEmail(message) {
    const text = normalize(message).toLowerCase();
    return /\b(this|the|current|open|selected)\s+(?:email|mail|message|thread)\b/.test(text)
      || /\b(?:reply|respond|draft|summari[sz]e|explain)\b/i.test(text)
      || /\bwhat\s+(?:does|is)\s+(?:this|it)\b/.test(text);
  }

  function installCurrentEmailAgentBridge() {
    if (window.fetch.__mailmateProductV4) return;
    const priorFetch = window.fetch.bind(window);

    const wrapped = async function (input, init = {}) {
      let url;
      try { url = new URL(typeof input === 'string' ? input : input?.url, window.location.href); }
      catch (_) { return priorFetch(input, init); }

      if (url.pathname !== '/api/kyle/agent' || String(init.method || 'GET').toUpperCase() !== 'POST') {
        return priorFetch(input, init);
      }

      let payload = null;
      try { payload = typeof init.body === 'string' ? JSON.parse(init.body) : null; }
      catch (_) {}
      if (!payload || payload?.uiContext?.briefingOnly) return priorFetch(input, init);

      const ref = activeEmailReference();
      if (!referencesCurrentEmail(payload.message)) return priorFetch(input, init);

      let email = currentEmailForPrompt || (ref ? await getFullEmail(ref.id) : null);
      currentEmailForPrompt = null;

      // Read directly from the on-screen email detail view if present
      const screenDetail = document.querySelector('#emailDetail, #tab-inbox .email-detail');
      if (screenDetail) {
        const screenBody = screenDetail.querySelector('.email-body')?.innerText?.trim() || '';
        const screenSubject = screenDetail.querySelector('header h2')?.innerText?.trim() || '';
        const screenSender = screenDetail.querySelector('.email-detail-meta span')?.innerText?.trim() || '';
        const screenDate = screenDetail.querySelector('.email-detail-meta time')?.innerText?.trim() || '';

        if (!email && screenBody) {
          email = {
            id: ref?.id || 'screen-open-email',
            subject: screenSubject || 'Email',
            sender: screenSender || 'Sender',
            body: screenBody,
            snippet: screenBody.slice(0, 240),
            date: screenDate
          };
        } else if (email && screenBody) {
          email.body = screenBody;
          if (screenSubject && (!email.subject || email.subject === 'No subject')) {
            email.subject = screenSubject;
          }
          if (screenSender && !email.sender) {
            email.sender = screenSender;
          }
        }
      }

      if (!email) return priorFetch(input, init);

      const reference = {
        type: 'email',
        id: String(email.id || email.gmail_id || ref?.id || ''),
        label: email.subject || ref?.label || 'Current email',
        page: 'inbox',
        metadata: {
          sender: email.sender || email.from,
          subject: email.subject,
          thread_id: email.thread_id || email.threadId
        }
      };

      const existingRefs = Array.isArray(payload.resolvedReferences) ? payload.resolvedReferences : [];
      payload = {
        ...payload,
        selectedEmail: email,
        resolvedReferences: [reference, ...existingRefs.filter(item => !(item?.type === 'email' && String(item?.id) === reference.id))],
        uiContext: {
          ...(payload.uiContext || {}),
          page: 'inbox',
          selected: reference,
          open: reference,
          currentEmail: {
            id: reference.id,
            subject: email.subject || '',
            sender: email.sender || '',
            thread_id: email.thread_id || email.threadId || ''
          }
        }
      };

      return priorFetch(input, { ...init, body: JSON.stringify(payload) });
    };

    wrapped.__mailmateProductV4 = true;
    window.fetch = wrapped;
  }

  function promptKyle(prompt) {
    if (typeof window.Kyle?.handlePrompt === 'function') {
      window.Kyle.handlePrompt(prompt);
      return;
    }
    const input = document.querySelector('.prompt-input');
    const form = input?.closest('form');
    if (!input || !form) return;
    input.value = prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  async function promptKyleAboutCurrentEmail(prompt) {
    const ref = activeEmailReference();
    if (ref) await getFullEmail(ref.id);
    promptKyle(prompt);
  }

  function updateKyleEmailContext() {
    const ref = activeEmailReference();
    const input = document.querySelector('.prompt-input');
    const widget = document.querySelector('.kyle-floating-mount .kyle-widget, .kyle-widget');
    if (!input || !widget) return;

    let chip = document.getElementById('mailmateEmailContextChip');
    if (!ref) {
      chip?.remove();
      if (input.dataset.mailmateContextPlaceholder === '1') {
        input.placeholder = 'Ask Kyle anything...';
        delete input.dataset.mailmateContextPlaceholder;
      }
      return;
    }

    const email = emailFromContext(ref.id) || {};
    const subject = email.subject || ref.label || 'Current email';
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'mailmateEmailContextChip';
      chip.className = 'mailmate-email-context-chip';
      widget.insertBefore(chip, widget.querySelector('.kyle-shell'));
    }
    chip.dataset.emailId = String(ref.id);
    chip.innerHTML = `<span><i class="far fa-envelope"></i> This email <strong>${esc(subject)}</strong></span><button type="button" aria-label="Clear email context" title="Clear email context"><i class="fas fa-xmark"></i></button>`;
    chip.querySelector('button')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      window.MailmateContext?.clear?.(ref);
      chip.remove();
      input.placeholder = 'Ask Kyle anything...';
      delete input.dataset.mailmateContextPlaceholder;
    });
    input.placeholder = 'Ask Kyle about this email...';
    input.dataset.mailmateContextPlaceholder = '1';
  }

  function mountEmailQuickActions() {
    const header = document.querySelector('#tab-inbox .email-detail-header');
    const ref = activeEmailReference();
    if (!header || !ref) return;
    let bar = header.querySelector('.mailmate-email-kyle-actions');
    if (bar?.dataset.emailId === String(ref.id)) return;
    bar?.remove();

    bar = document.createElement('div');
    bar.className = 'mailmate-email-kyle-actions';
    bar.dataset.emailId = String(ref.id);
    bar.innerHTML = `
      <span><i class="fas fa-wand-magic-sparkles"></i> Kyle</span>
      <button type="button" data-kyle-mail-action="summary">Summarize</button>
      <button type="button" data-kyle-mail-action="reply">Draft reply</button>
      <button type="button" data-kyle-mail-action="ask">Ask about this</button>`;
    header.appendChild(bar);

  function renderInboxEmailSummary(summaryText) {
    const header = document.querySelector('#tab-inbox .email-detail-header');
    if (!header || !summaryText) return;
    let card = header.querySelector('.mailmate-email-summary-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'mailmate-email-summary-card';
      header.appendChild(card);
    }
    card.innerHTML = `
      <div class="mailmate-email-summary-title">
        <i class="fas fa-sparkles"></i> <strong>Executive Summary</strong>
      </div>
      <p class="mailmate-email-summary-body">${esc(summaryText)}</p>
    `;
  }
  window.MailmateInboxSummary = { render: renderInboxEmailSummary };

    bar.querySelector('[data-kyle-mail-action="summary"]')?.addEventListener('click', async () => {
      const btn = bar.querySelector('[data-kyle-mail-action="summary"]');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Summarizing...';
      }
      try {
        await promptKyleAboutCurrentEmail('Summarize this email.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = 'Summarize';
        }
      }
    });
    bar.querySelector('[data-kyle-mail-action="reply"]')?.addEventListener('click', () => promptKyleAboutCurrentEmail('Draft a reply to this email. Use the thread context, but do not send it. Leave the mini composer open for my approval.'));
    bar.querySelector('[data-kyle-mail-action="ask"]')?.addEventListener('click', () => {
      updateKyleEmailContext();
      const input = document.querySelector('.prompt-input');
      input?.focus();
    });
  }

  function contextFingerprint(context) {
    const attention = (context?.needs_attention || []).map(item => [item.source_message_id || item.message_id || item.id || item.subject, item.deadline || '', item.urgency || item.priority || '']);
    const work = (context?.workJobs || context?.work_jobs || []).map(item => [item.id, item.status]);
    const events = (context?.calendarEvents || context?.calendar_events || []).map(event => [event.id, event.start, event.end, Boolean(event.conflict)]);
    return JSON.stringify({ attention, work, events, emailCount: (context?.emails || []).length });
  }

  function parseDeadline(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function deriveBriefState(context) {
    const attention = Array.isArray(context?.needs_attention) ? context.needs_attention : [];
    const jobs = Array.isArray(context?.workJobs) ? context.workJobs : (Array.isArray(context?.work_jobs) ? context.work_jobs : []);
    const events = Array.isArray(context?.calendarEvents) ? context.calendarEvents : (Array.isArray(context?.calendar_events) ? context.calendar_events : []);
    const now = Date.now();
    const urgent = attention.filter(item => {
      const text = `${item.subject || item.title || ''} ${item.description || item.reason || ''} ${item.urgency || ''}`;
      const deadline = parseDeadline(item.deadline);
      return /\b(?:urgent|asap|immediately|within\s+(?:[1-6])\s*hours?)\b/i.test(text)
        || (deadline && deadline.getTime() >= now && deadline.getTime() - now <= 6 * 3600000);
    });
    const conflicts = events.filter(event => event?.conflict).length;
    const activeWork = jobs.filter(job => !['completed', 'sent', 'resolved_external', 'cancelled', 'failed'].includes(String(job?.status || '').toLowerCase())).length;

    if (urgent.length) return { tone: 'urgent', label: 'Needs attention now', urgent: urgent.length, attention: attention.length, conflicts, activeWork };
    if (attention.length || conflicts || activeWork) return { tone: 'watch', label: 'A few things to watch', urgent: 0, attention: attention.length, conflicts, activeWork };
    return { tone: 'clear', label: 'You are clear for now', urgent: 0, attention: 0, conflicts: 0, activeWork: 0 };
  }

  function fallbackBrief(context, state) {
    const pieces = [];
    if (state.urgent) pieces.push(`${state.urgent} item${state.urgent === 1 ? '' : 's'} may need attention in the next few hours`);
    else if (state.attention) pieces.push(`${state.attention} inbox item${state.attention === 1 ? '' : 's'} need review`);
    if (state.conflicts) pieces.push(`${state.conflicts} calendar event${state.conflicts === 1 ? '' : 's'} are involved in schedule clashes`);
    if (state.activeWork) pieces.push(`${state.activeWork} Work task${state.activeWork === 1 ? '' : 's'} are active`);
    if (!pieces.length) return 'Nothing in the current mail, calendar, or Work context looks urgent. You can continue with your day and check back when something changes.';
    return `${pieces.join(', ')}. Start with the time-sensitive item first; the rest can wait until after that.`;
  }

  function ensureOverviewBriefing() {
    const overview = document.getElementById('tab-overview');
    const metricStrip = overview?.querySelector('.metric-strip');
    if (!overview || !metricStrip) return null;
    let card = document.getElementById('mailmateAiOverview');
    if (!card) {
      card = document.createElement('section');
      card.id = 'mailmateAiOverview';
      card.className = 'mailmate-ai-overview is-loading';
      card.innerHTML = `
        <div class="mailmate-ai-overview-head">
          <span class="mailmate-ai-status"><i></i><strong>Checking your workspace</strong></span>
          <span class="mailmate-ai-label"><i class="fas fa-wand-magic-sparkles"></i> Kyle overview</span>
        </div>
        <p class="mailmate-ai-copy">Reading current Gmail, Calendar and Work context...</p>
        <div class="mailmate-ai-meta"><span>One-view briefing</span><time></time></div>`;
      metricStrip.insertAdjacentElement('beforebegin', card);
    }
    return card;
  }

  function paintBrief(card, state, text, source = 'AI') {
    if (!card) return;
    card.classList.remove('is-loading', 'tone-urgent', 'tone-watch', 'tone-clear');
    card.classList.add(`tone-${state.tone}`);
    const status = card.querySelector('.mailmate-ai-status strong');
    const copy = card.querySelector('.mailmate-ai-copy');
    const meta = card.querySelector('.mailmate-ai-meta');
    const time = card.querySelector('time');
    if (status) status.textContent = state.label;
    if (copy) copy.textContent = normalize(text) || fallbackBrief(window.Kyle?.store?.context || {}, state);
    if (meta?.firstElementChild) meta.firstElementChild.textContent = source === 'AI' ? 'Generated from current Gmail + Calendar + Work context' : 'Live workspace summary';
    if (time) time.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }

  async function refreshOverviewBriefing(force = false) {
    const overview = document.getElementById('tab-overview');
    if (!overview?.classList.contains('active')) return;
    const card = ensureOverviewBriefing();
    const context = window.Kyle?.store?.context || {};
    if (!card || !Object.keys(context).length) return;

    const fingerprint = contextFingerprint(context);
    const state = deriveBriefState(context);
    if (!force && fingerprint === lastBriefFingerprint && !card.classList.contains('is-loading')) return;
    lastBriefFingerprint = fingerprint;

    try {
      const cached = JSON.parse(sessionStorage.getItem(BRIEF_CACHE_KEY) || 'null');
      if (!force && cached?.fingerprint === fingerprint && cached?.text) {
        paintBrief(card, state, cached.text, 'AI');
        return;
      }
    } catch (_) {}

    if (!card.querySelector('.mailmate-ai-copy')?.textContent?.trim()) card.classList.add('is-loading');
    const fallback = fallbackBrief(context, state);
    paintBrief(card, state, fallback, 'local');

    const instruction = [
      'Create a concise one-view workspace briefing from the supplied MailMate context.',
      'Do not call tools, create drafts, send mail, change calendar events, or navigate.',
      'Return only 2 or 3 short sentences in plain text.',
      'Sentence 1: what needs attention now, if anything.',
      'Sentence 2: the next relevant timing or schedule risk.',
      'Sentence 3 only if useful: what can safely wait.',
      'Use exact times/counts only when they are present in context. If nothing is urgent, say that clearly.'
    ].join(' ');

    try {
      const response = await window.fetch('/api/kyle/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: instruction,
          userId: window.localStorage?.getItem?.('userId') || '',
          context,
          uiContext: { page: 'overview', briefingOnly: true },
          resolvedReferences: [],
          selectedCalendarEventId: null,
          activeDraft: null,
          selectedEmail: null,
          conversation: []
        })
      });
      if (!response.ok) throw new Error(`brief returned ${response.status}`);
      const data = await response.json();
      const text = normalize(data?.reply || data?.text || '');
      if (!text) throw new Error('empty briefing');
      paintBrief(card, state, text, 'AI');
      try { sessionStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify({ fingerprint, text, savedAt: Date.now() })); } catch (_) {}
    } catch (error) {
      console.warn('[MailMate v4] AI overview fallback:', error.message || error);
      paintBrief(card, state, fallback, 'local');
    }
  }

  function scheduleOverviewBriefing(force = false) {
    clearTimeout(overviewTimer);
    overviewTimer = setTimeout(() => refreshOverviewBriefing(force), force ? 120 : 700);
  }

  function ensureCancelAutoSendButton() {
    const actions = document.querySelector('#kyleActionPanel .kyle-panel-actions');
    if (!actions) return null;
    let button = document.getElementById('mailmateCancelAutoSend');
    if (!button) {
      button = document.createElement('button');
      button.id = 'mailmateCancelAutoSend';
      button.className = 'kyle-btn mailmate-cancel-autosend';
      button.type = 'button';
      button.hidden = true;
      button.innerHTML = '<i class="fas fa-xmark"></i> Cancel auto-send';
      actions.insertBefore(button, actions.firstChild);
    }
    return button;
  }

  function installSendApprovalRuntime() {
    const tools = window.KyleTools;
    if (!tools?.run || tools.__mailmateProductV4) return false;
    const priorRun = tools.run.bind(tools);

    tools.run = async function (tool, args = {}, transaction) {
      if (tool !== 'mail.send_draft' || Number(args?.send_delay_ms || 0) <= 0) {
        return priorRun(tool, args, transaction);
      }

      const ui = window.KyleUi?.active;
      const button = ensureCancelAutoSendButton();
      const token = ++sendCountdownGeneration;
      const initial = ui?.getActiveDraft?.() || {};
      const initialSubject = String(initial.subject || '');
      const initialBody = String(initial.body || '');
      const deadline = Date.now() + Math.max(1000, Number(args.send_delay_ms || AUTO_SEND_DELAY_MS));
      let cancelled = false;

      if (button) {
        button.hidden = false;
        button.onclick = () => {
          if (token !== sendCountdownGeneration) return;
          cancelled = true;
          sendCountdownGeneration += 1;
          button.hidden = true;
          ui?.setComposerStatus?.('Auto-send cancelled · review the draft and click Send when you approve.');
        };
      }

      while (token === sendCountdownGeneration && !cancelled) {
        const snapshot = ui?.getComposerSnapshot?.() || {};
        if (snapshot.state === 'sent') {
          if (button) button.hidden = true;
          return { ok: true, messageId: 'manual-send', manuallySent: true };
        }

        const active = ui?.getActiveDraft?.() || {};
        if (String(active.subject || '') !== initialSubject || String(active.body || '') !== initialBody) {
          cancelled = true;
          sendCountdownGeneration += 1;
          if (button) button.hidden = true;
          ui?.setComposerStatus?.('Draft changed · auto-send cancelled. Review it and click Send when ready.');
          break;
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        ui?.setComposerStatus?.(`Sending in ${Math.ceil(remaining / 1000)}s · read it first or cancel auto-send`);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      if (cancelled || token !== sendCountdownGeneration) {
        return { ok: true, cancelled: true, deferred: true, manualReview: true };
      }

      if (button) button.hidden = true;
      ui?.setComposerStatus?.('Sending through Gmail…');
      return priorRun(tool, { ...args, send_delay_ms: 0 }, transaction);
    };

    tools.__mailmateProductV4 = true;
    return true;
  }

  function installCancelledSendNarration() {
    const executor = window.KyleExecutor;
    if (!executor?.execute || executor.__mailmateProductV4) return false;
    const priorExecute = executor.execute.bind(executor);
    executor.execute = async function (plan) {
      const transaction = await priorExecute(plan);
      const cancelledSend = (transaction?.steps || []).find(step => step?.action?.tool === 'mail.send_draft' && step?.result?.cancelled);
      if (cancelledSend) {
        transaction.narration = 'Auto-send cancelled. The draft is still open for your manual approval.';
        window.KyleUi?.active?.setSubtitle?.(transaction.narration);
        window.KyleUi?.active?.setComposerStatus?.('Auto-send cancelled · click Send when you approve.');
      }
      return transaction;
    };
    executor.__mailmateProductV4 = true;
    return true;
  }

  function installDomObservers() {
    const refresh = () => {
      updateKyleEmailContext();
      mountEmailQuickActions();
      if (document.getElementById('tab-overview')?.classList.contains('active')) scheduleOverviewBriefing(false);
    };

    window.addEventListener('mailmate:context', refresh);
    window.addEventListener('harness:context', () => scheduleOverviewBriefing(false));
    window.addEventListener('harness:calendar-refresh', () => scheduleOverviewBriefing(true));

    document.addEventListener('click', event => {
      if (event.target.closest('.nav-tab[data-tab="overview"]')) scheduleOverviewBriefing(false);
      if (event.target.closest('#refreshBtn')) scheduleOverviewBriefing(true);
    }, true);

    const observer = new MutationObserver(() => {
      clearTimeout(observer._timer);
      observer._timer = setTimeout(refresh, 60);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    refresh();
  }

  injectStyles();
  installCurrentEmailAgentBridge();

  const runtime = setInterval(() => {
    const sendReady = installSendApprovalRuntime();
    const executorReady = installCancelledSendNarration();
    if (sendReady && executorReady && window.Kyle?.handlePrompt) {
      clearInterval(runtime);
      installDomObservers();
      scheduleOverviewBriefing(false);
    }
  }, 100);
  setTimeout(() => clearInterval(runtime), 15000);
})();
