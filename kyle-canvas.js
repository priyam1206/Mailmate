(function () {

  function requestAnimationFrameSafe(callback) {
    const raf = window.requestAnimationFrame;
    if (typeof raf === 'function') {
      return raf.call(window, callback);
    }
    return setTimeout(() => callback(
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now()
    ), 0);
  }


  const state = {
    active: false,
    pending: false,
    prepared: null,
    lastResult: null,
    history: [],
    prompt: '',
    page: 'overview',
    composerOwnsCanvas: false,
    revealRun: 0,
    dataRevealRun: 0
  };

  const $ = id => document.getElementById(id);

  function cleanCanvasText(value) {
    let text = String(value ?? '');
    if (text.includes('&') && typeof document !== 'undefined') {
      const decoder = document.createElement('textarea');
      decoder.innerHTML = text;
      text = decoder.value;
    }
    return text
      .replace(/\u00c2\u00b7/g, '·')
      .replace(/\u00e2\u20ac\u00a2/g, '•')
      .replace(/\u00e2\u2020\u2019/g, '→')
      .replace(/\u00e2\u20ac\u201c/g, '–')
      .replace(/\u00e2\u20ac\u201d/g, '—')
      .replace(/\u00c2(?=\s)/g, '')
      .replace(/\b(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\+00:00|Z)?\b/g, (_, year, month, day) =>
        new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', year: 'numeric'
        })
      )
      .replace(/\s{2,}/g, ' ')
      .trim();
  }


  function els() {
    return {
      tab: $('tab-overview'),
      brief: document.querySelector('#tab-overview .overview-brief'),
      data: $('overviewDataSurface'),
      canvas: $('kyleCanvas'),
      history: $('kyleCanvasHistory'),
      restoreButton: $('kyleCanvasRestore'),
      query: $('kyleCanvasQuery'),
      thinking: $('kyleCanvasThinking'),
      status: $('kyleCanvasStatus'),
      answer: $('kyleCanvasAnswer'),
      title: $('kyleCanvasTitle'),
      lede: $('kyleCanvasLede'),
      highlights: $('kyleCanvasHighlights'),
      sections: $('kyleCanvasSections'),
      composerHost: $('kyleCanvasComposerHost')
    };
  }

  function isOverview() {
    return Boolean($('tab-overview')?.classList.contains('active'));
  }

  function ensureOverviewDock() {
    const home = $('kyleOverviewHome');
    if (!home) return null;

    // .tab-panel uses a transform animation. A fixed descendant of a
    // transformed ancestor is fixed to that ancestor, not the viewport.
    // Portal the command home to body so bottom means browser bottom.
    if (home.parentElement !== document.body) {
      document.body.appendChild(home);
    }

    home.classList.toggle('is-active', isOverview());
    const restoreButton = $('kyleCanvasRestore');
    if (restoreButton && restoreButton.parentElement !== document.body) {
      document.body.appendChild(restoreButton);
    }
    return home;
  }

  function navigationIntent(prompt) {
    const text = String(prompt || '').trim();
    if (!text) return false;
    if (/\b(open|go\s+to|take\s+me\s+to|switch\s+to)\b/i.test(text)) return true;
    if (/\bshow\s+(?:me\s+)?(?:the\s+)?(?:most\s+recent|latest|newest|unread)\s+(?:e?mail|message)s?\b/i.test(text)) return true;
    return false;
  }

  function composerIntent(prompt) {
    const text = String(prompt || '');
    return /\b(reply|draft|compose|write)\b/i.test(text)
      || (/\bsend\b/i.test(text) && /@|\bto\b|\bsaying\b|\bsubject\b|\bbody\b|\bhim\b|\bher\b|\bthem\b/i.test(text));
  }

  function storageKey() {
    let userId = 'session';
    try { userId = localStorage.getItem('userId') || userId; } catch (_) {}
    return `mailmate.kyle.canvas.v1.${String(userId).toLowerCase()}`;
  }

  function persistSession() {
    try {
      sessionStorage.setItem(storageKey(), JSON.stringify({
        history: state.history.slice(-8),
        lastResult: state.lastResult
      }));
    } catch (_) {}
  }

  function sanitizeStoredRecord(record) {
    if (!record || typeof record !== 'object' || !record.canvas) return null;
    const canvas = record.canvas;
    return {
      prompt: cleanCanvasText(record.prompt || ''),
      createdAt: Number(record.createdAt) || Date.now(),
      canvas: {
        ...canvas,
        title: cleanCanvasText(canvas.title || ''),
        lede: cleanCanvasText(canvas.lede || ''),
        highlights: (canvas.highlights || []).map(item => ({
          ...item,
          label: cleanCanvasText(item?.label || ''),
          value: cleanCanvasText(item?.value || '')
        })),
        sections: (canvas.sections || []).map(section => ({
          ...section,
          heading: cleanCanvasText(section?.heading || ''),
          items: (section?.items || []).map(item => ({
            ...item,
            title: cleanCanvasText(item?.title || ''),
            detail: cleanCanvasText(item?.detail || ''),
            meta: cleanCanvasText(item?.meta || '')
          }))
        }))
      }
    };
  }

  function hydrateSession() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey()) || '{}');
      state.history = Array.isArray(saved.history)
        ? saved.history.slice(-8).map(sanitizeStoredRecord).filter(Boolean)
        : [];
      state.lastResult = sanitizeStoredRecord(saved.lastResult);
      if (state.lastResult) {
        state.prompt = state.lastResult.prompt || '';
        state.prepared = state.lastResult.canvas || null;
      }
    } catch (_) {
      state.history = [];
      state.lastResult = null;
    }
    updateRestoreButton();
  }

  function updateRestoreButton() {
    const button = els().restoreButton;
    if (!button) return;
    button.hidden = state.active || state.pending || !isOverview() || !(state.lastResult || state.history.length);
  }

  function archiveLastResult() {
    if (!state.lastResult) return;
    state.history.push(state.lastResult);
    state.history = state.history.slice(-8);
    state.lastResult = null;
    persistSession();
  }

  function conversationalIntent(prompt) {
    const text = String(prompt || '').trim().toLowerCase().replace(/[!?.,]+$/g, '').trim();
    return /^(?:hi|hello|hey|hiya|yo|good morning|good afternoon|good evening|how are you|how are you doing|what'?s up|whats up|who are you|what can you do|thanks|thank you|okay|ok|cool|nice|what(?: is|'s) the time|what time is it|current time|time now|what(?: is|'s) the date|what day is it|who sent (?:it|this|that)|when was (?:it|this|that) sent|say that again)$/.test(text);
  }

  function shouldBegin(prompt) {
    return isOverview() && !navigationIntent(prompt) && !composerIntent(prompt) && !conversationalIntent(prompt);
  }

  function shouldPresent(prompt, payload = {}) {
    if (!isOverview()) return false;
    if (payload.presentation === 'navigate') return false;
    if (conversationalIntent(prompt)) return false;
    if ((payload.actions || []).some(action => action?.tool === 'navigation.open')) return false;
    if (composerIntent(prompt)) return false;
    if (payload.presentation === 'canvas') return true;
    return !navigationIntent(prompt);
  }

  function hideOverviewData() {
    const e = els();
    e.brief?.classList.add('is-canvas-away');
    e.data?.classList.add('is-canvas-away');
    setTimeout(() => {
      if (!state.active) return;
      if (e.brief) e.brief.hidden = true;
      if (e.data) e.data.hidden = true;
    }, 210);
  }

  function showOverviewData() {
    const e = els();
    if (e.brief) e.brief.hidden = false;
    if (e.data) e.data.hidden = false;
    requestAnimationFrameSafe(() => {
      e.brief?.classList.remove('is-canvas-away');
      e.data?.classList.remove('is-canvas-away');
      animateDashboardArrival();
    });
  }

  function begin(prompt, options = {}) {
    if (!isOverview()) return false;
    const e = els();
    if (!e.canvas) return false;

    archiveLastResult();
    state.active = true;
    state.pending = false;
    state.prompt = String(prompt || '').trim();
    state.prepared = null;
    state.revealRun += 1;

    e.tab?.classList.add('kyle-canvas-active');
    e.canvas.hidden = false;
    e.canvas.classList.remove('is-ready', 'is-error');
    e.canvas.classList.add('is-thinking');
    if (e.query) e.query.textContent = state.prompt || (options.composer ? 'Preparing a message' : '');
    if (e.answer) e.answer.hidden = true;
    if (e.thinking) e.thinking.hidden = false;
    if (e.status) e.status.textContent = options.composer ? 'Preparing your draft...' : 'Thinking through your inbox...';
    if (e.highlights) e.highlights.replaceChildren();
    if (e.sections) e.sections.replaceChildren();
    if (e.title) e.title.textContent = '';
    if (e.lede) e.lede.textContent = '';
    hideOverviewData();
    updateRestoreButton();
    return true;
  }

  function beginForPrompt(prompt) {
    if (!shouldBegin(prompt)) return false;
    archiveLastResult();
    state.pending = true;
    state.prompt = String(prompt || '').trim();
    state.prepared = null;
    updateRestoreButton();
    return true;
  }

  function beginComposer(mode = 'compose', prompt = '') {
    if (!isOverview()) return false;
    const request = prompt || (state.composerOwnsCanvas && state.prompt) || (mode === 'reply' ? 'Draft a reply' : 'Draft an email');
    begin(request, { composer: true });
    state.composerOwnsCanvas = true;
    const e = els();
    if (e.status) e.status.textContent = mode === 'reply' ? 'Preparing your reply...' : 'Preparing your email...';
    setTimeout(placeComposer, 0);
    return true;
  }

  function consumeActivity(activity) {
    if (!state.active || !isOverview()) return false;
    const text = activity?.status || activity?.state || activity?.title || activity?.goal || '';
    if (text && els().status) els().status.textContent = String(text).replace(/_/g, ' ');
    return true;
  }

  function showError(message) {
    if (!state.active || !isOverview()) return false;
    const e = els();
    e.canvas?.classList.remove('is-thinking', 'is-ready');
    e.canvas?.classList.add('is-error');
    if (e.thinking) e.thinking.hidden = true;
    if (e.answer) e.answer.hidden = false;
    if (e.title) e.title.textContent = 'Kyle hit a problem';
    if (e.lede) e.lede.textContent = String(message || 'The request could not be completed.');
    return true;
  }

  function safeReference(value) {
    if (!value || typeof value !== 'object') return null;
    const type = String(value.type || '');
    const id = String(value.id || '');
    if (!type || !id || !['email', 'work-item', 'calendar-event', 'page'].includes(type)) return null;
    return { type, id, label: String(value.label || '') };
  }


  function contextualCanvasFallback(prompt) {
    const storeContext = window.Kyle?.store?.context || {};
    const snapshot = window.MailmateContext?.snapshot?.() || {};

    const emails =
      (Array.isArray(storeContext.emails) && storeContext.emails) ||
      (Array.isArray(snapshot.emails) && snapshot.emails) ||
      (Array.isArray(snapshot.mail?.recent) && snapshot.mail.recent) ||
      [];

    const attention =
      (Array.isArray(storeContext.needs_attention) && storeContext.needs_attention) ||
      (Array.isArray(snapshot.needs_attention) && snapshot.needs_attention) ||
      (Array.isArray(snapshot.mail?.needs_attention) && snapshot.mail.needs_attention) ||
      [];

    const work =
      (Array.isArray(storeContext.workJobs) && storeContext.workJobs) ||
      (Array.isArray(storeContext.work_jobs) && storeContext.work_jobs) ||
      (Array.isArray(snapshot.work?.active) && snapshot.work.active) ||
      [];

    const calendar =
      (Array.isArray(storeContext.calendarEvents) && storeContext.calendarEvents) ||
      (Array.isArray(storeContext.calendar_events) && storeContext.calendar_events) ||
      (Array.isArray(snapshot.calendarEvents) && snapshot.calendarEvents) ||
      (Array.isArray(snapshot.calendar?.events) && snapshot.calendar.events) ||
      [];

    const sections = [];

    if (attention.length) {
      sections.push({
        heading: 'Needs attention',
        items: attention.slice(0, 6).map(item => {
          const id = String(
            item.id || item.gmail_id || item.message_id || item.source_id || ''
          );

          const email = emails.find(mail =>
            String(mail.id || mail.gmail_id || mail.message_id || '') === id
          ) || {};

          const subject = String(
            item.subject || item.title || email.subject || 'Email'
          ).trim();

          const detail = [
            String(
              item.summary ||
              item.description ||
              item.reason ||
              email.summary ||
              email.snippet ||
              ''
            ).trim(),
            item.deadline ? `Deadline: ${item.deadline}.` : '',
            (item.requires_reply || email.context_scores?.requires_reply)
              ? 'A reply appears to be requested.'
              : ''
          ].filter(Boolean).join(' ');

          return {
            title: subject,
            detail,
            meta: [
              String(item.sender || email.sender || '').trim(),
              String(item.timestamp || item.date || email.timestamp || email.date || '').trim()
            ].filter(Boolean).join(' · '),
            reference: id
              ? { type: 'email', id, label: subject }
              : null
          };
        })
      });
    }

    if (emails.length) {
      sections.push({
        heading: 'Recent mail',
        items: emails.slice(0, 8).map(email => {
          const id = String(email.id || email.gmail_id || email.message_id || '');
          const subject = String(email.subject || 'No subject').trim();

          const detail = [
            String(email.summary || email.snippet || '').trim(),
            email.context_scores?.requires_reply ? 'Reply requested.' : '',
            email.deadline ? `Deadline: ${email.deadline}.` : ''
          ].filter(Boolean).join(' ');

          return {
            title: subject,
            detail,
            meta: [
              String(email.sender || '').trim(),
              String(email.timestamp || email.date || '').trim()
            ].filter(Boolean).join(' · '),
            reference: id
              ? { type: 'email', id, label: subject }
              : null
          };
        })
      });
    }

    if (work.length) {
      sections.push({
        heading: 'Active work',
        items: work.slice(0, 6).map(job => ({
          title: String(job.clean_title || job.title || 'Work item'),
          detail: String(
            job.current_step ||
            job.summary ||
            job.description ||
            job.status ||
            ''
          ),
          meta: String(job.status || '').replace(/_/g, ' '),
          reference: job.id
            ? {
                type: 'work-item',
                id: String(job.id),
                label: String(job.clean_title || job.title || '')
              }
            : null
        }))
      });
    }

    if (calendar.length) {
      sections.push({
        heading: 'Upcoming',
        items: calendar.slice(0, 6).map(event => ({
          title: String(event.title || event.summary || 'Calendar event'),
          detail: String(event.description || ''),
          meta: [
            String(event.start || '').trim(),
            String(event.end || '').trim()
          ].filter(Boolean).join(' → '),
          reference: event.id
            ? {
                type: 'calendar-event',
                id: String(event.id),
                label: String(event.title || event.summary || '')
              }
            : null
        }))
      });
    }

    return sections.filter(section =>
      Array.isArray(section.items) && section.items.length
    );
  }


  function classifyCanvasScope(prompt) {
    const text = String(prompt || '').trim().toLowerCase();
    const hasMail = /\b(?:mail|email|emails|message|messages|inbox)\b/i.test(text);
    const hasCalendar = /\b(?:calendar|schedule|meeting|meetings|event|events)\b/i.test(text);
    const hasWork = /\b(?:work|task|tasks|project|projects)\b/i.test(text);

    if (
      hasMail &&
      (
        /\b(?:latest|newest|last|most\s+recent)\b[^.?!]*\b(?:mail|email|message)\b/i.test(text) ||
        /\b(?:mail|email|message)\b[^.?!]*\b(?:latest|newest|last|most\s+recent)\b/i.test(text)
      )
    ) return 'latest_email';

    if (
      hasMail &&
      /\b(?:important|priority|priorities|urgent|top|needs?\s+attention|actionable)\b/i.test(text)
    ) return 'important_mail';

    if (
      hasMail &&
      /\b(?:summari[sz]e|summary|overview|digest|all\s+(?:my\s+)?(?:mail|email)|inbox\s+brief)\b/i.test(text)
    ) return 'mail_summary';

    if (hasMail) return 'mail_focus';
    if (hasCalendar && !hasWork) return 'calendar';
    if (hasWork && !hasCalendar) return 'work';
    return 'focused';
  }

  function sectionMatches(section, words) {
    const heading = String(section?.heading || '').trim().toLowerCase();
    return words.some(word => heading.includes(word));
  }

  function dedupeCanvasItems(items) {
    const seen = new Set();
    return (items || []).filter(item => {
      const key = item?.reference?.id
        ? `ref:${item.reference.id}`
        : `title:${String(item?.title || '').trim().toLowerCase()}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function scopedFallbackSections(scope, prompt) {
    const all = typeof contextualCanvasFallback === 'function'
      ? contextualCanvasFallback(prompt)
      : [];

    const attention = all.find(section =>
      sectionMatches(section, ['needs attention', 'important', 'priority', 'urgent'])
    );
    const recent = all.find(section =>
      sectionMatches(section, ['recent mail', 'email', 'mail'])
    );
    const upcoming = all.find(section =>
      sectionMatches(section, ['upcoming', 'calendar', 'schedule'])
    );
    const work = all.find(section =>
      sectionMatches(section, ['active work', 'work', 'task'])
    );

    if (scope === 'latest_email') {
      const item = recent?.items?.[0];
      return item ? [{ heading: 'Latest email', items: [item] }] : [];
    }

    if (scope === 'important_mail') {
      const items = dedupeCanvasItems(attention?.items || []).slice(0, 5);
      return items.length ? [{ heading: 'Priority mail', items }] : [];
    }

    if (scope === 'mail_summary') {
      const result = [];
      if (attention?.items?.length) {
        result.push({
          heading: 'Needs attention',
          items: dedupeCanvasItems(attention.items).slice(0, 5)
        });
      }
      if (recent?.items?.length) {
        result.push({
          heading: 'Recent mail',
          items: dedupeCanvasItems(recent.items).slice(0, 7)
        });
      }
      return result;
    }

    if (scope === 'calendar') {
      return upcoming?.items?.length
        ? [{ heading: 'Upcoming', items: upcoming.items.slice(0, 7) }]
        : [];
    }

    if (scope === 'work') {
      return work?.items?.length
        ? [{ heading: 'Active work', items: work.items.slice(0, 6) }]
        : [];
    }

    return [];
  }

function normalizeCanvasBase(canvas, reply, prompt) {
    const source = canvas && typeof canvas === 'object' ? canvas : {};
    let title = String(source.title || '').trim();
    let lede = String(source.lede || source.subtitle || '').trim();
    if (!title) {
      if (/\bsummar/i.test(prompt || '')) title = 'Here is the signal in your inbox';
      else if (/\b(urgent|priority|priorit)/i.test(prompt || '')) title = 'What deserves your attention';
      else if (/\b(find|top|best|important)/i.test(prompt || '')) title = 'What I found';
      else title = 'Here is what I found';
    }
    if (!lede) lede = String(reply || '').trim();

    return {
      title: title.slice(0, 180),
      lede: lede.slice(0, 1200),
      highlights: (Array.isArray(source.highlights) ? source.highlights : []).slice(0, 6).map(item => ({
        label: String(item?.label || '').slice(0, 80),
        value: String(item?.value || '').slice(0, 120)
      })).filter(item => item.label || item.value),
      sections: (Array.isArray(source.sections) ? source.sections : []).slice(0, 6).map(section => ({
        heading: String(section?.heading || '').slice(0, 120),
        items: (Array.isArray(section?.items) ? section.items : []).slice(0, 12).map(item => ({
          title: String(item?.title || '').slice(0, 220),
          detail: String(item?.detail || item?.body || '').slice(0, 800),
          meta: String(item?.meta || '').slice(0, 180),
          reference: safeReference(item?.reference)
        })).filter(item => item.title || item.detail)
      })).filter(section => section.heading || section.items.length)
    };
  }

  function normalizeCanvas(canvas, reply, prompt) {
    const normalized = normalizeCanvasBase(canvas, reply, prompt) || {};
    const scope = classifyCanvasScope(prompt);
    normalized.scope = scope;

    let sections = Array.isArray(normalized.sections)
      ? normalized.sections.map(section => ({
          ...section,
          items: dedupeCanvasItems(
            Array.isArray(section?.items) ? section.items : []
          )
        }))
      : [];

    const fallback = scopedFallbackSections(scope, prompt);

    if (scope === 'latest_email') {
      const modelEmailSection = sections.find(section =>
        sectionMatches(section, ['latest', 'recent', 'mail', 'email'])
      );
      const first = modelEmailSection?.items?.[0] || fallback?.[0]?.items?.[0];
      sections = first ? [{ heading: 'Latest email', items: [first] }] : [];

      if (/^here (?:is|are) what i found$/i.test(String(normalized.title || '').trim())) {
        normalized.title = 'Your latest email';
      }
    } else if (scope === 'important_mail') {
      let items = [];
      for (const section of sections) {
        if (sectionMatches(section, ['important', 'priority', 'urgent', 'attention', 'action'])) {
          items.push(...(section.items || []));
        }
      }
      items = dedupeCanvasItems(items);
      if (items.length < 2 && fallback?.[0]?.items?.length) {
        items = dedupeCanvasItems([...items, ...fallback[0].items]);
      }
      sections = items.length
        ? [{ heading: 'Priority mail', items: items.slice(0, 5) }]
        : [];

      if (/^here (?:is|are) what i found$/i.test(String(normalized.title || '').trim())) {
        normalized.title = 'The emails that matter most';
      }
    } else if (scope === 'mail_summary') {
      sections = sections.filter(section =>
        sectionMatches(section, ['mail', 'email', 'attention', 'important', 'priority', 'urgent'])
      );

      const currentCount = sections.reduce(
        (sum, section) => sum + (section.items?.length || 0),
        0
      );

      if (currentCount < 4) {
        const known = new Set(
          sections.map(section => String(section.heading || '').toLowerCase())
        );
        for (const section of fallback) {
          if (!section?.items?.length) continue;
          const key = String(section.heading || '').toLowerCase();
          if (!known.has(key)) {
            sections.push(section);
            known.add(key);
          }
        }
      }
      sections = sections.slice(0, 2);
    } else if (scope === 'calendar') {
      sections = sections.filter(section =>
        sectionMatches(section, ['calendar', 'schedule', 'upcoming', 'event'])
      );
      if (!sections.length && fallback.length) sections = fallback;
    } else if (scope === 'work') {
      sections = sections.filter(section =>
        sectionMatches(section, ['work', 'task', 'project'])
      );
      if (!sections.length && fallback.length) sections = fallback;
    } else {
      // mail_focus/focused: no automatic expansion at all.
      // Preserve only what the model explicitly returned.
    }

    normalized.title = cleanCanvasText(normalized.title || '');
    normalized.lede = cleanCanvasText(
      String(normalized.lede || '')
        .replace(/\s*I found \d+ useful items across \d+ sections below\.\s*$/i, '')
    );

    normalized.highlights = (Array.isArray(normalized.highlights) ? normalized.highlights : [])
      .map(item => ({
        ...item,
        value: cleanCanvasText(item?.value || ''),
        label: cleanCanvasText(item?.label || '')
      }));

    normalized.sections = sections.map(section => ({
      ...section,
      heading: cleanCanvasText(section?.heading || ''),
      items: (Array.isArray(section?.items) ? section.items : []).map(item => ({
        ...item,
        title: cleanCanvasText(item?.title || '').replace(/^[•·]\s*/, ''),
        detail: cleanCanvasText(item?.detail || ''),
        meta: cleanCanvasText(item?.meta || '')
      }))
    }));

    return normalized;
  }






  function prepare(payload = {}) {
    if (!isOverview() || (!state.active && !state.pending)) return false;
    if (!state.active) {
      const e = els();
      state.active = true;
      state.pending = false;
      e.tab?.classList.add('kyle-canvas-active');
      if (e.canvas) e.canvas.hidden = false;
      e.canvas?.classList.remove('is-thinking', 'is-error');
      e.canvas?.classList.add('is-ready');
      if (e.thinking) e.thinking.hidden = true;
      if (e.answer) e.answer.hidden = true;
      if (e.query) e.query.textContent = payload.prompt || state.prompt;
      hideOverviewData();
    }
    const e = els();
    if (e.query) e.query.textContent = payload.prompt || state.prompt;
    state.prepared = normalizeCanvas(payload.canvas, payload.reply || payload.text || '', payload.prompt || state.prompt);
    updateRestoreButton();
    return true;
  }

  function activateReference(reference) {
    if (!reference) return;
    if (reference.type === 'page') {
      window.KyleActions?.openPage?.(reference.id);
      return;
    }
    if (reference.type === 'email') {
      const emails = window.Kyle?.store?.context?.emails || [];
      const email = emails.find(item => String(item.id || item.gmail_id || item.threadId || '') === String(reference.id));
      if (email) window.dispatchEvent(new CustomEvent('harness:open-email', { detail: email }));
      else window.Kyle?.handlePrompt?.(`Open the email ${reference.label || reference.id}`);
      return;
    }
    if (reference.type === 'work-item') {
      window.KyleActions?.openPage?.('work');
      setTimeout(() => window.Kyle?.handlePrompt?.(`Open ${reference.label || 'that work item'}`), 80);
      return;
    }
    if (reference.type === 'calendar-event') {
      window.KyleActions?.openPage?.('calendar');
      setTimeout(() => window.Kyle?.handlePrompt?.(`Open ${reference.label || 'that calendar event'}`), 80);
    }
  }

  function appendHistoryResult(host, record) {
    const data = record?.canvas;
    if (!host || !data) return;
    const entry = document.createElement('section');
    entry.className = 'kyle-canvas-history-entry';
    const query = document.createElement('p');
    query.className = 'kyle-canvas-history-query';
    query.textContent = record.prompt || 'Earlier request';
    entry.appendChild(query);
    if (data.title) {
      const title = document.createElement('h2');
      title.textContent = data.title;
      entry.appendChild(title);
    }
    if (data.lede) {
      const lede = document.createElement('p');
      lede.className = 'kyle-canvas-history-lede';
      lede.textContent = data.lede;
      entry.appendChild(lede);
    }
    for (const section of (data.sections || [])) {
      const block = document.createElement('div');
      block.className = 'kyle-canvas-history-section';
      if (section.heading) {
        const heading = document.createElement('h3');
        heading.textContent = section.heading;
        block.appendChild(heading);
      }
      for (const item of (section.items || [])) {
        const row = document.createElement(item.reference ? 'button' : 'div');
        row.className = 'kyle-canvas-history-item';
        if (item.reference) {
          row.type = 'button';
          row.addEventListener('click', () => activateReference(item.reference));
        }
        const title = document.createElement('strong');
        title.textContent = item.title || 'Open';
        row.appendChild(title);
        if (item.detail) {
          const detail = document.createElement('span');
          detail.textContent = item.detail;
          row.appendChild(detail);
        }
        block.appendChild(row);
      }
      entry.appendChild(block);
    }
    host.appendChild(entry);
  }

  function renderHistory() {
    const host = els().history;
    if (!host) return;
    host.replaceChildren();
    state.history.forEach(record => appendHistoryResult(host, record));
    host.hidden = state.history.length === 0;
  }

  function buildPreparedDom() {
    const e = els();
    const data = state.prepared || normalizeCanvas(null, '', state.prompt);
    if (e.title) e.title.textContent = '';
    if (e.lede) e.lede.textContent = '';
    if (e.highlights) e.highlights.replaceChildren();
    if (e.sections) e.sections.replaceChildren();

    const highlightNodes = [];
    for (const highlight of data.highlights) {
      const node = document.createElement('div');
      node.className = 'kyle-canvas-highlight is-pending';
      const value = document.createElement('strong'); value.textContent = highlight.value;
      const label = document.createElement('span'); label.textContent = highlight.label;
      node.append(value, label);
      e.highlights?.appendChild(node);
      highlightNodes.push(node);
    }

    const sectionNodes = [];
    for (const section of data.sections) {
      const block = document.createElement('section');
      block.className = 'kyle-canvas-section is-pending';
      if (section.heading) {
        const heading = document.createElement('h3'); heading.textContent = section.heading; block.appendChild(heading);
      }
      const list = document.createElement('div'); list.className = 'kyle-canvas-list';
      for (const item of section.items) {
        const row = document.createElement('article'); row.className = 'kyle-canvas-item';
        if (item.reference) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'kyle-canvas-link'; button.textContent = item.title || 'Open';
          button.addEventListener('click', () => activateReference(item.reference)); row.appendChild(button);
        } else if (item.title) {
          const title = document.createElement('strong'); title.textContent = item.title; row.appendChild(title);
        }
        if (item.detail) { const p = document.createElement('p'); p.textContent = item.detail; row.appendChild(p); }
        if (item.meta) { const small = document.createElement('small'); small.textContent = item.meta; row.appendChild(small); }
        list.appendChild(row);
      }
      block.appendChild(list); e.sections?.appendChild(block); sectionNodes.push(block);
    }
    return { data, highlightNodes, sectionNodes };
  }

  async function typeText(element, text, run, speed = 11) {
    if (!element) return;
    const value = String(text || '');
    element.textContent = '';
    if (!value) return;
    const chunk = Math.max(1, Math.ceil(value.length / Math.max(1, 1000 / speed)));
    for (let i = 0; i < value.length; i += chunk) {
      if (run !== state.revealRun) return;
      element.textContent = value.slice(0, Math.min(value.length, i + chunk));
      await wait(speed);
    }
    element.textContent = value;
  }

  async function reveal() {
    if (!state.active || !isOverview()) return false;
    const e = els();
    const run = ++state.revealRun;
    renderHistory();
    const built = buildPreparedDom();
    e.canvas?.classList.remove('is-peeling');
    void e.canvas?.offsetWidth;
    e.canvas?.classList.add('is-peeling');
    e.canvas?.classList.remove('is-thinking', 'is-error');
    e.canvas?.classList.add('is-ready');
    if (e.thinking) e.thinking.hidden = true;
    if (e.answer) e.answer.hidden = false;
    await typeText(e.title, built.data.title, run, 5);
    await wait(35);
    await typeText(e.lede, built.data.lede, run, 2);
    if (run !== state.revealRun) return false;
    built.highlightNodes.forEach((node, i) => setTimeout(() => node.classList.remove('is-pending'), 80 * i));
    built.sectionNodes.forEach((node, i) => setTimeout(() => node.classList.remove('is-pending'), 120 + 105 * i));
    state.lastResult = {
      prompt: state.prompt,
      canvas: state.prepared,
      createdAt: Date.now()
    };
    persistSession();
    updateRestoreButton();
    setTimeout(scrollCurrentIntoView, 40);
    return true;
  }

  function scrollCurrentIntoView() {
    const answer = els().answer;
    if (!answer || answer.hidden) return;
    const top = Math.max(0, window.scrollY + answer.getBoundingClientRect().top - 74);
    window.scrollTo({ top, behavior: 'auto' });
  }

  function cancelPending() {
    if (state.pending) {
      state.pending = false;
      state.prepared = state.lastResult?.canvas || null;
      state.prompt = state.lastResult?.prompt || '';
      updateRestoreButton();
      return;
    }
    if (!state.active) return;
    if (!state.prepared && !document.querySelector('#kyleCanvasComposerHost .kyle-action-panel.is-open')) restore();
  }

  function restore() {
    const e = els();
    state.active = false;
    state.pending = false;
    state.composerOwnsCanvas = false;
    state.revealRun += 1;
    e.tab?.classList.remove('kyle-canvas-active');
    e.canvas?.classList.remove('is-thinking', 'is-ready', 'is-error');
    if (e.canvas) e.canvas.hidden = true;
    if (e.thinking) e.thinking.hidden = true;
    showOverviewData();
    updateRestoreButton();
  }

  function reopen() {
    const record = state.lastResult || state.history[state.history.length - 1];
    if (!record || !isOverview()) return false;
    const e = els();
    state.active = true;
    state.pending = false;
    state.prompt = record.prompt || '';
    state.prepared = record.canvas || null;
    e.tab?.classList.add('kyle-canvas-active');
    if (e.canvas) e.canvas.hidden = false;
    e.canvas?.classList.remove('is-thinking', 'is-error');
    e.canvas?.classList.add('is-ready', 'is-peeling');
    if (e.query) e.query.textContent = state.prompt;
    if (e.thinking) e.thinking.hidden = true;
    if (e.answer) e.answer.hidden = false;
    renderHistory();
    const built = buildPreparedDom();
    if (e.title) e.title.textContent = built.data.title;
    if (e.lede) e.lede.textContent = built.data.lede;
    built.highlightNodes.forEach(node => node.classList.remove('is-pending'));
    built.sectionNodes.forEach(node => node.classList.remove('is-pending'));
    hideOverviewData();
    setTimeout(scrollCurrentIntoView, 260);
    updateRestoreButton();
    return true;
  }

  function placeComposer() {
    const panel = $('kyleActionPanel');
    if (!panel || !panel.classList.contains('is-open')) return false;
    const e = els();
    if (isOverview() && e.composerHost) {
      if (!state.active) beginComposer('compose');
      if (panel.parentElement !== e.composerHost) e.composerHost.appendChild(panel);
      panel.classList.add('kyle-overview-inline-composer');
      panel.style.left = 'auto'; panel.style.right = 'auto'; panel.style.top = 'auto'; panel.style.bottom = 'auto';
      panel.style.transform = ''; panel.style.transition = '';
      return true;
    }
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    panel.classList.remove('kyle-overview-inline-composer');
    panel.style.left = ''; panel.style.right = ''; panel.style.top = ''; panel.style.bottom = ''; panel.style.transform = '';
    window.dispatchEvent(new CustomEvent('kyle:layout-changed'));
    return false;
  }

  function isInlineComposer(panel = $('kyleActionPanel')) {
    return Boolean(panel?.classList.contains('kyle-overview-inline-composer') && isOverview());
  }

  function onComposerClosed() {
    if (state.composerOwnsCanvas) restore();
    state.composerOwnsCanvas = false;
  }

  function onPageChange(page) {
    state.page = page || 'overview';

    const home = ensureOverviewDock();
    home?.classList.toggle('is-active', state.page === 'overview');

    if (state.page === 'overview' && state.active) {
      if (els().canvas) els().canvas.hidden = false;
      hideOverviewData();
    }
    updateRestoreButton();
    setTimeout(placeComposer, 0);
  }

  function setDataLoading(on) {
    $('tab-overview')?.classList.toggle('is-data-loading', Boolean(on));
    if (on && !state.active) {
      const summary = $('summaryText');
      if (summary && /loading/i.test(summary.textContent || '')) summary.textContent = 'Reading the shape of your inbox...';
    }
  }

  function animateNumber(element, target) {
    if (!element) return;
    const end = Number(target);
    if (!Number.isFinite(end)) return;
    const start = Number(element.dataset.lastAnimatedValue || 0);
    const duration = 430;
    const began = now();
    const tick = t => {
      const p = Math.min(1, (t - began) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      element.textContent = String(Math.round(start + (end - start) * eased));
      if (p < 1) raf(tick);
      else { element.textContent = String(end); element.dataset.lastAnimatedValue = String(end); }
    };
    raf(tick);
  }

  function animateDashboardArrival() {
    if (!isOverview() || state.active) return;
    const surface = $('overviewDataSurface');
    if (!surface) return;
    const run = ++state.dataRevealRun;
    surface.querySelectorAll('.metric-strip, .attention-section, .working-section, .upcoming-section, .waiting-section').forEach((node, i) => {
      node.classList.remove('overview-arrive'); void node.offsetWidth;
      node.style.setProperty('--overview-delay', `${i * 70}ms`); node.classList.add('overview-arrive');
    });
    ['importantCount', 'actionCount', 'emailCount'].forEach(id => {
      const node = $(id); const target = Number(node?.textContent); if (Number.isFinite(target)) animateNumber(node, target);
    });
    const summary = $('summaryText');
    if (summary && !summary.dataset.typing) {
      const finalText = summary.textContent;
      summary.dataset.typing = '1'; summary.textContent = '';
      let index = 0;
      const delay = Math.max(6, Math.min(18, 760 / Math.max(finalText.length, 1)));
      const timer = setInterval(() => {
        if (run !== state.dataRevealRun) { clearInterval(timer); summary.dataset.typing = ''; return; }
        const chunk = finalText.length > 160 ? 3 : finalText.length > 80 ? 2 : 1;
        index = Math.min(finalText.length, index + chunk); summary.textContent = finalText.slice(0, index);
        if (index >= finalText.length) { clearInterval(timer); summary.dataset.typing = ''; }
      }, delay);
    }
  }

  function raf(callback) {
    return typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(callback) : setTimeout(() => callback(now()), 0);
  }
  function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function bind() {
    ensureOverviewDock();
    hydrateSession();
    const back = $('kyleCanvasBack');
    if (back && back.dataset.bound !== '1') { back.dataset.bound = '1'; back.addEventListener('click', restore); }
    const restoreButton = $('kyleCanvasRestore');
    if (restoreButton && restoreButton.dataset.bound !== '1') { restoreButton.dataset.bound = '1'; restoreButton.addEventListener('click', reopen); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true }); else bind();

  window.KyleCanvas = {
    state,
    isOverview,
    ensureOverviewDock,
    isActive: () => state.active,
    shouldBegin,
    shouldPresent,
    begin,
    beginForPrompt,
    beginComposer,
    prepare,
    reveal,
    restore,
    reopen,
    cancelPending,
    showError,
    consumeActivity,
    placeComposer,
    isInlineComposer,
    onComposerClosed,
    onPageChange,
    onPresentationMode: () => {
      ensureOverviewDock();
      setTimeout(placeComposer, 0);
    },
    setDataLoading,
    animateDashboardArrival
  };
})();
