document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = window.location.origin;
  const $ = id => document.getElementById(id);
  const els = {
    tabs: [...document.querySelectorAll('.nav-tab')],
    panels: [...document.querySelectorAll('.tab-panel')],
    filters: [...document.querySelectorAll('.filter-tab')],
    pageTitle: $('pageTitle'),
    pageSubtitle: $('pageSubtitle'),
    profileName: $('profileName'),
    profilePic: $('profilePic'),
    overviewGreeting: $('overviewGreeting'),
    refreshBtn: $('refreshBtn'),
    processState: $('processState'),
    processList: $('processList'),
    summaryText: $('summaryText'),
    emailCount: $('emailCount'),
    importantCount: $('importantCount'),
    actionCount: $('actionCount'),
    attentionBadge: $('attentionBadge'),
    attentionList: $('attentionList'),
    actionList: $('actionList'),
    upcomingList: $('upcomingList'),
    emailList: $('emailList'),
    emailDetail: $('emailDetail'),
    inboxCount: $('inboxCount'),
    workCount: $('workCount'),
    workList: $('workList'),
    runTitle: $('runTitle'),
    agentTimeline: $('agentTimeline'),
    statusList: $('statusList'),
    integrationList: $('integrationList'),
    errorBox: $('errorBox')
  };

  const state = {
    userId: localStorage.getItem('userId'),
    userName: localStorage.getItem('userName') || 'User',
    userPicture: localStorage.getItem('userPicture') || '',
    data: null,
    health: null,
    selectedEmailId: null,
    fullMessages: new Map(),
    loadingMessageIds: new Set(),
    inboxFilter: 'all',
    currentPage: 'overview',
    calendarEvents: [],
    calendarWeekStart: startOfWeek(new Date()),
    calendarSelectedEventId: null,
    calendarSyncTimer: null,
    calendarSyncing: false,
    calendarLastSyncAt: null,
    calendarSyncSeq: 0,
    calendarDismissedMarkers: new Set()
  };

  const pageCopy = {
    overview: ['Overview', 'Your inbox, distilled into what matters now.'],
    inbox: ['Inbox', 'Recent Gmail, sorted for urgency and action.'],
    work: ['Work', 'Useful agent activity and approved next steps.'],
    calendar: ['Calendar', 'Schedule and extracted deadlines.'],
    automations: ['Automations', 'Scheduled workflows that watch your inbox for you.'],
    status: ['Status', 'Auth, cache, AI, browser voice, and runtime details.'],
    integrations: ['Integrations', 'Services powering your inbox workspace.'],
    settings: ['Settings', 'Session preferences and data handling.']
  };

  boot();

  async function boot() {
    hydrateReturnParams();
    bindEvents();
    registerStaticObjects();
    initCalendarControls();
    setProfile();

    // Paint the last same-session snapshot immediately, then refresh network data.
    hydrateSessionSnapshot();
    const inboxPromise = loadInbox(false);
    const healthPromise = loadHealth();
    await Promise.allSettled([inboxPromise, healthPromise]);
    startCalendarAutoSync();
  }

  function sessionSnapshotKey() {
    return `mailmate.dashboard.${state.userId || 'anonymous'}`;
  }

  function hydrateSessionSnapshot() {
    if (!state.userId) return false;
    try {
      const raw = sessionStorage.getItem(sessionSnapshotKey());
      if (!raw) return false;
      const snapshot = JSON.parse(raw);
      if (!snapshot?.data || Date.now() - Number(snapshot.savedAt || 0) > 15 * 60 * 1000) return false;
      state.data = snapshot.data;
      state.calendarDismissedMarkers = new Set(snapshot.data.calendar_dismissed_markers || []);
      renderDashboard(snapshot.data);
      if (snapshot.data.user) setProfile(snapshot.data.user);
      els.processState.textContent = 'Showing recent session · refreshing';
      return true;
    } catch (_) {
      return false;
    }
  }

  function saveSessionSnapshot(data) {
    if (!state.userId || !data) return;
    try {
      sessionStorage.setItem(sessionSnapshotKey(), JSON.stringify({ savedAt: Date.now(), data }));
    } catch (_) {
      // Session storage is only a speed optimization.
    }
  }

  function hydrateReturnParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true' && params.get('userId')) {
      const nextUserId = params.get('userId');
      const previousUserId = localStorage.getItem('userId') || '';

      // Never carry a previous Google account's avatar into a new account.
      if (previousUserId && previousUserId !== nextUserId) {
        state.userPicture = '';
        state.userName = 'Google User';
        localStorage.removeItem('userPicture');
        localStorage.removeItem('userName');
      }

      state.userId = nextUserId;
      state.userName = params.get('name') || state.userName;
      state.userPicture = params.get('picture') || '';

      localStorage.setItem('userId', state.userId);
      localStorage.setItem('userName', state.userName);
      localStorage.setItem('profileAccountId', state.userId);
      if (state.userPicture) localStorage.setItem('userPicture', state.userPicture);
      else localStorage.removeItem('userPicture');

      window.history.replaceState({}, '', './dashboard.html');
    }
  }

  function bindEvents() {
    els.tabs.forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
    els.filters.forEach(filter => filter.addEventListener('click', () => {
      state.inboxFilter = filter.dataset.filter;
      els.filters.forEach(item => item.classList.toggle('active', item === filter));
      renderEmails(state.data?.emails || []);
    }));
    els.refreshBtn?.addEventListener('click', () => loadInbox(true));
    $('logoutBtn')?.addEventListener('click', logout);

    window.addEventListener('harness:open-email', event => {
      const email = event.detail;
      showTab('inbox');
      openEmail(email);
    });

    window.addEventListener('harness:error', event => {
      addError(event.detail?.message || 'Unknown Kyle error.');
      renderStatus();
    });
  }

  function registerStaticObjects() {
    els.tabs.forEach(tab => window.MailmateObjects?.register({
      type: 'page',
      id: tab.dataset.tab,
      label: tab.textContent.trim(),
      page: tab.dataset.tab
    }, tab));
    els.filters.forEach(filter => window.MailmateObjects?.register({
      type: 'inbox-filter',
      id: filter.dataset.filter,
      label: filter.textContent.trim(),
      page: 'inbox'
    }, filter));
  }

  function showTab(name) {
    state.currentPage = name;
    const copy = pageCopy[name] || pageCopy.overview;
    els.pageTitle.textContent = copy[0];
    els.pageSubtitle.textContent = copy[1];
    document.title = `Agent Harness - ${copy[0]}`;
    els.tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
    els.panels.forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
    window.MailmateContext?.setPage(name);
    window.Kyle?.setContext({
      ...(state.data || {}),
      calendarEvents: state.calendarEvents,
      health: state.health,
      currentPage: name
    });
    if (name === 'calendar') refreshCalendar(false);
    console.log('[Mailmate] navigation', name);
  }

  function setProfile(profile = {}) {
    const profileId = profile.email || profile.id || profile.sub || state.userId || '';
    const storedProfileId = localStorage.getItem('profileAccountId') || localStorage.getItem('userId') || '';

    if (profileId && storedProfileId && profileId !== storedProfileId) {
      state.userPicture = '';
      localStorage.removeItem('userPicture');
    }

    const name = profile.name || profile.email || state.userName || 'Google User';
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=111111&color=ffffff`;

    state.userId = profile.id || profile.sub || profile.email || state.userId;
    state.userName = name;

    // If a live profile object was supplied, trust that account's picture only.
    // Do not silently reuse the previous account's localStorage picture.
    if (Object.keys(profile).length) {
      state.userPicture = profile.picture || '';
    }

    let picture = state.userPicture || fallback;
    if (state.userPicture && /googleusercontent\.com/i.test(state.userPicture)) {
      // Request a fresh, slightly larger avatar rather than a stale cached 96px URL.
      picture = state.userPicture.replace(/=s\d+(?:-c)?(?:$|&)/, '=s128-c$&');
      picture += (picture.includes('?') ? '&' : '?') + 'ah_avatar=1';
    }

    localStorage.setItem('userName', name);
    if (state.userId) {
      localStorage.setItem('userId', state.userId);
      localStorage.setItem('profileAccountId', profileId || state.userId);
    }
    if (state.userPicture) localStorage.setItem('userPicture', state.userPicture);
    else localStorage.removeItem('userPicture');

    els.profileName.textContent = name;
    els.profilePic.alt = name;
    els.profilePic.referrerPolicy = 'no-referrer';
    els.profilePic.crossOrigin = 'anonymous';
    els.profilePic.onerror = () => {
      els.profilePic.onerror = null;
      els.profilePic.removeAttribute('crossorigin');
      els.profilePic.src = fallback;
    };
    els.profilePic.src = picture;

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    els.overviewGreeting.textContent = `${greeting}, ${name.split(' ')[0]}`;
  }

  async function loadHealth() {
    try {
      const response = await fetch(`${API_BASE}/api/health`);
      state.health = await response.json();
      renderStatus();
      renderIntegrations();
      renderCacheSettings();
      window.Kyle?.setContext({
        ...(state.data || {}),
        calendarEvents: state.calendarEvents,
        health: state.health,
        currentPage: state.currentPage
      });
    } catch (error) {
      addError('Health check failed: ' + error.message);
    }
  }

  function renderCacheSettings() {
    const status = $('cacheSettingsStatus');
    const policyText = $('cachePolicyText');
    const supabase = state.health?.supabase || {};
    const policy = state.health?.cachePolicy || {};

    if (status) {
      status.textContent = supabase.ready
        ? (supabase.mode === 'processed-context' ? 'Supabase · full context' : 'Supabase · legacy cache')
        : (supabase.configured ? 'Supabase error' : 'Disabled');
    }

    if (policyText) {
      const syncMins = Math.max(1, Math.round((policy.syncCheckSeconds || 300) / 60));
      const reprocessMins = Math.max(1, Math.round((policy.reprocessSeconds || 1800) / 60));
      policyText.textContent = `Check Gmail for changes about every ${syncMins} min. Reprocess semantic context about every ${reprocessMins} min, or immediately when Gmail changes.`;
    }
  }

  async function logout() {
    const button = $('logoutBtn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Signing out…';
    }
    try {
      const response = await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
      if (!response.ok) throw new Error(`Logout returned ${response.status}`);
      try { sessionStorage.removeItem(sessionSnapshotKey()); } catch (_) {}
      ['userId', 'userName', 'userPicture'].forEach(key => localStorage.removeItem(key));
      window.location.replace('/');
    } catch (error) {
      addError('Logout: ' + error.message);
      if (button) {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-arrow-right-from-bracket"></i> Sign out';
      }
    }
  }

  async function loadInbox(forceRefresh) {
    console.log('[Mailmate] dashboard load', forceRefresh ? 'refresh' : 'cache-first');
    if (!state.userId) {
      setStep('auth', 'active', 'Connect Google from the landing page');
      els.summaryText.textContent = 'Connect Google from the landing page to see your Gmail priorities here.';
      window.Kyle?.setContext({ health: state.health, emails: [], metrics: {}, currentPage: state.currentPage });
      return;
    }

    clearSteps();
    setStep('auth', 'done', 'Gmail session found');
    setStep('cache', 'active', 'Reading Supabase cache');

    try {
      setStep('cache', 'done', forceRefresh ? 'Refresh requested' : 'Cache checked first');
      setStep('fetch', 'active', forceRefresh ? 'Refreshing Gmail now' : 'Loading current context');
      const response = await fetch(`${API_BASE}/api/dashboard/overview?userId=${encodeURIComponent(state.userId)}${forceRefresh ? '&refresh=true' : ''}`);
      if (response.status === 401) {
        localStorage.removeItem('userId');
        throw new Error('Gmail session expired. Reconnect Google from the landing page.');
      }
      if (!response.ok) throw new Error(`Dashboard returned ${response.status}`);
      setStep('fetch', 'done', 'Context loaded');
      setStep('extract', 'active', 'Extracting work, blockers, and deadlines');
      const data = await response.json();
      setStep('extract', 'done', data.cached ? 'Loaded processed context' : 'New context extracted');
      setStep('store', 'active', 'Saving processed context');
      setStep('store', 'done', data.cached ? 'Supabase context reused' : (data.cache_mode ? `Saved · ${data.cache_mode}` : 'Current context ready'));

      state.data = data;
      state.calendarDismissedMarkers = new Set(data.calendar_dismissed_markers || []);
      renderDashboard(data);
      saveSessionSnapshot(data);
      if (data.user) setProfile(data.user);

      // Persist cached/new email deadlines into the currently connected
      // Google Calendar, then refetch so AI-created events are visible.
      try {
        const aiSync = await fetch(`${API_BASE}/api/calendar/ai-sync`, { method: 'POST' });
        if (aiSync.ok) {
          const aiSyncData = await aiSync.json();
          if ((aiSyncData.created_or_updated || 0) > 0) {
            console.log('[Calendar] AI deadline sync', aiSyncData);
          }
        }
      } catch (syncError) {
        console.warn('[Calendar] AI deadline sync failed:', syncError);
      }
      await refreshCalendar(false);
      els.processState.textContent = data.cached ? (data.background_refresh_started ? 'Cache ready · checking updates' : 'Cache reused') : 'Complete';
      window.Kyle?.setContext({
        ...data,
        calendarEvents: state.calendarEvents,
        health: state.health,
        currentPage: state.currentPage
      });
      console.log('[Mailmate] dashboard ready');
    } catch (error) {
      addError(error.message);
      els.processState.textContent = 'Needs attention';
      els.summaryText.textContent = error.message;
      window.Kyle?.setContext({ health: state.health, emails: [], metrics: {}, currentPage: state.currentPage });
    }
  }

  function renderDashboard(data) {
    const metrics = data.metrics || {};
    els.emailCount.textContent = metrics.emails ?? 0;
    els.importantCount.textContent = metrics.important ?? 0;
    els.actionCount.textContent = metrics.actions ?? 0;
    els.attentionBadge.textContent = `${metrics.important ?? 0} items`;
    els.summaryText.textContent = data.ai_insight || 'Your Gmail context is ready. Kyle can talk through priorities when needed.';

    const attention = data.needs_attention || [];
    els.attentionList.innerHTML = attention.length
      ? attention.slice(0, 5).map((item, index) => {
          const title = item.subject || item.title || conciseActionTitle(item.description || item.reason) || 'Your task';
          const deadline = item.deadline ? `<small>${escapeHtml(item.deadline)}</small>` : '';
          return `<li data-kyle-type="work-item" data-kyle-id="attention-${index}" data-kyle-label="${escapeHtml(title)}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(item.description || item.reason || 'Needs follow-up')}</span>${deadline}</li>`;
        }).join('')
      : '<li><strong>Inbox clear</strong><span>No urgent dependencies detected in this scan.</span></li>';

    const actions = attention.slice(0, 4).map((item, index) => ({
      title: item.subject || item.title || conciseActionTitle(item.description || item.reason) || (index === 0 ? 'Do this first' : 'Next task'),
      body: item.description || item.reason || 'Review this item.',
      deadline: item.deadline || ''
    }));
    els.actionList.innerHTML = actions.length
      ? actions.map((action, index) => `<article data-kyle-type="work-item" data-kyle-id="suggested-${index}" data-kyle-label="${escapeHtml(action.title)}"><span class="status-dot"></span><div><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(action.body)}</p></div><small>${escapeHtml(action.deadline || (index ? 'Next' : 'Now'))}</small></article>`).join('')
      : '<article><span class="status-dot"></span><div><strong>Nothing urgent</strong><p>No action is currently blocking you.</p></div><small>Clear</small></article>';

    [...els.attentionList.querySelectorAll('[data-kyle-id]'), ...els.actionList.querySelectorAll('[data-kyle-id]')]
      .forEach(element => window.MailmateObjects?.register({
        type: element.dataset.kyleType,
        id: element.dataset.kyleId,
        label: element.dataset.kyleLabel,
        page: 'overview'
      }, element));

    renderUpcomingFromContext();

    renderEmails(data.emails || []);
    renderWork(data);
  }

  function renderEmails(emails) {
    window.MailmateObjects?.unregisterType('email');
    const filtered = emails.filter(email => {
      if (state.inboxFilter === 'important') return isImportant(email);
      if (state.inboxFilter === 'action') return /action|required|approval|deadline|due|waiting|review|urgent/i.test(`${email.subject || ''} ${email.snippet || ''}`);
      if (state.inboxFilter === 'unread') return email.is_read === false;
      return true;
    });

    els.inboxCount.textContent = `${filtered.length} message${filtered.length === 1 ? '' : 's'}`;
    els.emailList.innerHTML = filtered.length
      ? filtered.slice(0, 40).map((email, index) => {
        const selected = state.selectedEmailId && state.selectedEmailId === emailKey(email);
        return `
          <article class="email-item ${selected ? 'is-selected' : ''} ${email.is_read === false ? 'is-unread' : ''} ${isImportant(email) ? 'is-important' : ''}" data-index="${index}" data-kyle-type="email" data-kyle-id="${escapeHtml(emailKey(email))}" data-kyle-label="${escapeHtml(email.subject || 'No subject')}">
            <span class="email-marker"></span>
            <div class="email-copy">
              <p class="email-sender">${escapeHtml(senderName(email.sender))}</p>
              <p class="email-subject">${escapeHtml(email.subject || 'No subject')}</p>
              <p class="email-preview">${escapeHtml(email.snippet || 'No preview available.')}</p>
            </div>
            <time class="email-time">${escapeHtml(formatDate(email.date || email.timestamp))}</time>
          </article>`;
      }).join('')
      : '<div class="empty-detail"><i class="far fa-envelope"></i><p>No messages match this filter.</p></div>';

    [...els.emailList.querySelectorAll('.email-item[data-index]')].forEach(item => {
      const email = filtered[Number(item.dataset.index)];
      window.MailmateObjects?.register({
        ...emailReference(email),
        page: 'inbox',
        metadata: {
          sender: email.sender,
          subject: email.subject,
          date: email.date || email.timestamp,
          unread: email.is_read === false,
          important: isImportant(email)
        }
      }, item);
      item.addEventListener('click', () => {
        openEmail(email);
      });
    });

    const selected = emails.find(email => emailKey(email) === state.selectedEmailId);
    const hydrated = selected ? { ...selected, ...(state.fullMessages.get(emailKey(selected)) || {}) } : null;
    renderEmailDetail(hydrated, selected ? state.loadingMessageIds.has(emailKey(selected)) : false);
  }

  async function openEmail(email) {
    const id = String(emailKey(email) || '');
    if (!id) return;
    state.selectedEmailId = id;
    const reference = emailReference(email);
    window.MailmateContext?.select(reference);
    window.MailmateContext?.open(reference);

    if (email.is_read === false) {
      email.is_read = true;
      const source = state.data?.emails?.find(item => emailKey(item) === id);
      if (source) source.is_read = true;
      saveSessionSnapshot(state.data);
      fetch(`${API_BASE}/api/gmail/messages/${encodeURIComponent(id)}/read`, { method: 'POST' })
        .then(async response => {
          if (response.ok) return;
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.error || `Gmail mark-read returned ${response.status}`);
        })
        .catch(error => {
          email.is_read = false;
          if (source) source.is_read = false;
          addError('Gmail: ' + error.message);
          renderEmails(state.data?.emails || []);
        });
    }

    renderEmails(state.data?.emails || []);
    if (state.fullMessages.has(id) || state.loadingMessageIds.has(id)) return;

    state.loadingMessageIds.add(id);
    renderEmailDetail(email, true);
    try {
      const response = await fetch(`${API_BASE}/api/gmail/messages/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const detail = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(detail.error || `Gmail message returned ${response.status}`);
      state.fullMessages.set(id, detail);
      const source = state.data?.emails?.find(item => emailKey(item) === id);
      if (source) Object.assign(source, detail, { is_read: source.is_read });
    } catch (error) {
      addError('Gmail: ' + error.message);
    } finally {
      state.loadingMessageIds.delete(id);
      if (state.selectedEmailId === id) renderEmails(state.data?.emails || []);
    }
  }

  function renderEmailDetail(email, loading = false) {
    if (!email) {
      els.emailDetail.innerHTML = '<div class="empty-detail"><i class="far fa-envelope-open"></i><p>Select an email to read it here.</p></div>';
      return;
    }
    els.emailDetail.innerHTML = `
      <header class="email-detail-header">
        <div class="email-detail-title-row">
          <p class="section-label">${isImportant(email) ? 'Needs attention' : 'Message'}</p>
          <button class="email-trash-btn" id="emailTrashBtn" type="button" title="Move this message to Gmail Trash"><i class="far fa-trash-can"></i> Trash</button>
        </div>
        <h2>${escapeHtml(email.subject || 'No subject')}</h2>
        <div class="email-detail-meta"><span>${escapeHtml(email.sender || 'Unknown sender')}</span><time>${escapeHtml(formatDate(email.date || email.timestamp, true))}</time></div>
      </header>
      <div class="email-body" ${loading ? 'aria-busy="true"' : ''}>${loading ? '<span class="email-loading">Loading full message...</span>' : escapeHtml(email.body || email.snippet || 'This message has no readable text body.')}</div>`;
    $('emailTrashBtn')?.addEventListener('click', () => trashEmail(email));
    const reference = emailReference(email);
    window.MailmateObjects?.register({
      ...reference,
      page: 'inbox',
      metadata: { sender: email.sender, subject: email.subject, date: email.date || email.timestamp }
    }, els.emailDetail);
    window.MailmateContext?.open(reference);
  }

  async function trashEmail(email) {
    const id = String(emailKey(email) || '');
    if (!id) return;
    if (!window.confirm('Move this message to Gmail Trash?')) return;

    const button = $('emailTrashBtn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Moving…';
    }

    try {
      const response = await fetch(`${API_BASE}/api/gmail/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const detail = await response.json().catch(() => ({}));
      if (!response.ok) {
        const hint = detail.hint ? ` ${detail.hint}` : '';
        throw new Error((detail.error || `Gmail delete returned ${response.status}`) + hint);
      }

      if (state.data) {
        state.data.emails = (state.data.emails || []).filter(item => String(emailKey(item) || '') !== id);
        for (const key of ['needs_attention', 'waiting_on_others']) {
          state.data[key] = (state.data[key] || []).filter(item => attentionSourceId(item) !== id);
        }
        state.data.metrics = {
          ...(state.data.metrics || {}),
          emails: (state.data.emails || []).length,
          important: (state.data.needs_attention || []).length,
          actions: (state.data.needs_attention || []).length
        };
      }

      state.selectedEmailId = null;
      renderDashboard(state.data || { emails: [], needs_attention: [], waiting_on_others: [], metrics: {} });
      saveSessionSnapshot(state.data);
      window.KyleTools?.execute?.([{ tool: 'ui.toast', args: { message: 'Moved to Gmail Trash' } }]);
    } catch (error) {
      addError('Gmail: ' + error.message);
      if (button) {
        button.disabled = false;
        button.innerHTML = '<i class="far fa-trash-can"></i> Trash';
      }
    }
  }


  function renderWork(data) {
    const attention = data.needs_attention || [];
    const actions = attention.slice(0, 6).map((item, index) => ({
      title: item.subject || item.title || conciseActionTitle(item.description || item.reason) || (index === 0 ? 'Do this first' : 'Next task'),
      body: item.description || item.reason || item.subject || 'Review this item.'
    }));
    els.workCount.textContent = `${actions.length} run${actions.length === 1 ? '' : 's'}`;
    els.workList.innerHTML = actions.length
      ? actions.map((action, index) => `<article class="work-item ${index === 0 ? 'active' : ''}" data-index="${index}" data-kyle-type="work-item" data-kyle-id="work-${index}" data-kyle-label="${escapeHtml(action.title)}"><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(action.body)}</p></article>`).join('')
      : '<article class="work-item active"><strong>No work runs yet</strong><p>Actionable Gmail threads will appear here.</p></article>';

    [...els.workList.querySelectorAll('.work-item[data-index]')].forEach(item => {
      const action = actions[Number(item.dataset.index)];
      const reference = { type: 'work-item', id: item.dataset.kyleId, label: action.title };
      window.MailmateObjects?.register({ ...reference, page: 'work', metadata: { description: action.body } }, item);
      item.addEventListener('click', () => {
        window.MailmateContext?.select(reference);
        window.MailmateContext?.open(reference);
        [...els.workList.querySelectorAll('.work-item')].forEach(row => row.classList.toggle('active', row === item));
        els.runTitle.textContent = action.title;
        els.agentTimeline.innerHTML = `
        <article><span>K</span><div><strong>Kyle</strong><p>${escapeHtml(action.body)}</p></div></article>
        <article><span>P</span><div><strong>Planner</strong><p>Prepared a short review and response workflow.</p></div></article>
        <article><span>G</span><div><strong>Gmail agent</strong><p>Linked the original message context without reprocessing unrelated mail.</p></div></article>`;
      });
    });
  }

  function renderStatus() {
    const h = state.health || {};
    const rows = [
      ['Google OAuth', h.googleClientConfigured],
      ['Gmail session', h.gmailAuthenticated || Boolean(state.userId)],
      ['Google Calendar read/write', h.calendarReadWrite],
      ['Gemini', h.geminiConfigured],
      ['Supabase cache', h.supabaseConfigured],
      ['Browser speech recognition', Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)],
      ['Browser text-to-speech', 'speechSynthesis' in window],
      ['Kyle action registry', Boolean(window.KyleActions)]
    ];
    els.statusList.innerHTML = rows.map(([label, ok]) => `<li data-status="${ok ? 'Ready' : 'Unavailable'}"><strong>${escapeHtml(label)}</strong></li>`).join('');
  }

  function renderIntegrations() {
    const h = state.health || {};
    const rows = [
      ['Google Gmail', h.googleClientConfigured],
      ['Google Calendar', h.calendarReadWrite],
      ['Gemini', h.geminiConfigured],
      ['Supabase', h.supabaseConfigured],
      ['Browser speech recognition', Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)],
      ['Browser TTS', 'speechSynthesis' in window]
    ];
    els.integrationList.innerHTML = rows.map(([label, ok]) => `<li data-status="${ok ? 'Connected' : 'Unavailable'}"><strong>${escapeHtml(label)}</strong></li>`).join('');
  }

  function clearSteps() {
    [...els.processList.querySelectorAll('li')].forEach(li => li.classList.remove('active', 'done'));
    els.processState.textContent = 'Working';
  }

  function setStep(step, status, label) {
    const item = els.processList.querySelector(`[data-step="${step}"]`);
    if (!item) return;
    item.classList.toggle('active', status === 'active');
    item.classList.toggle('done', status === 'done');
    if (label) item.lastChild.textContent = label;
  }

  function addError(message) {
    const existing = els.errorBox.textContent.includes('No errors') ? '' : els.errorBox.textContent + '\n';
    els.errorBox.textContent = existing + `[${new Date().toLocaleTimeString()}] ${message}`;
  }

  function emailKey(email) {
    return email?.id || email?.gmail_id || email?.subject || null;
  }

  function emailReference(email) {
    return {
      type: 'email',
      id: String(emailKey(email) || ''),
      label: email?.subject || 'No subject'
    };
  }


  function attentionSourceId(item) {
    return String(item?.source_message_id || item?.message_id || item?.email_id || '').trim();
  }

  function isImportant(email) {
    return Boolean(email?.is_starred || (email?.labels || []).includes('IMPORTANT') || /urgent|important|deadline|action|required|approval/i.test(`${email?.subject || ''} ${email?.snippet || ''}`));
  }

  function senderName(sender) {
    return String(sender || 'Unknown sender').replace(/\s*<[^>]+>\s*$/, '').replace(/^"|"$/g, '').trim() || 'Unknown sender';
  }

  function formatDate(value, long = false) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 12);
    if (long) return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  function conciseActionTitle(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const cleaned = text
      .replace(/^(urgent|important|action required)\s*[:\-]\s*/i, '')
      .replace(/\b(due|submit|submission)\b.*$/i, match => match);
    const first = cleaned.split(/[.;]/)[0].trim();
    return first.length > 58 ? first.slice(0, 55).trimEnd() + '…' : first;
  }

  function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const mondayOffset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - mondayOffset);
    return d;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function toLocalDateInput(date) {
    const d = new Date(date);
    const offset = d.getTimezoneOffset();
    return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function calendarRange() {
    const start = new Date(state.calendarWeekStart);
    const end = addDays(start, 7);
    return { start, end };
  }

  function renderUpcomingFromContext() {
    const items = [];
    (state.data?.needs_attention || []).forEach(task => {
      if (!task.deadline) return;
      items.push({
        when: task.deadline,
        title: task.subject || task.title || conciseActionTitle(task.description) || 'Deadline',
        source: 'Email'
      });
    });

    state.calendarEvents
      .filter(event => {
        const start = parseEventStart(event);
        return start && start >= new Date();
      })
      .slice(0, 4)
      .forEach(event => items.push({
        when: event.start,
        title: event.title,
        source: event.conflict ? 'Calendar · clash' : 'Calendar'
      }));

    items.splice(4);
    els.upcomingList.innerHTML = items.length
      ? items.map(item => `<article><time>${escapeHtml(humanWhen(item.when))}</time><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.source)}</p></div></article>`).join('')
      : '<p>No upcoming deadlines or calendar events found.</p>';
  }

  function humanWhen(value) {
    if (!value) return '';
    const raw = String(value);
    if (/within|tomorrow|today|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(raw)) return raw;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : formatDate(raw, true);
  }

  function parseEventStart(event) {
    if (!event?.start) return null;
    if (event.all_day || String(event.start).length <= 10) {
      const d = new Date(`${String(event.start).slice(0, 10)}T00:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(event.start);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function parseEventEnd(event) {
    if (!event?.end) return null;
    if (event.all_day || String(event.end).length <= 10) {
      const d = new Date(`${String(event.end).slice(0, 10)}T00:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(event.end);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function deadlineToCalendarItem(item, index) {
    const raw = String(item.deadline || '').trim();
    const now = new Date();
    let start = null;
    let allDay = true;

    const within = raw.match(/within\s+(\d+)\s*hours?/i);
    if (within) {
      start = new Date(now.getTime() + Number(within[1]) * 3600000);
      allDay = false;
    } else if (/tomorrow/i.test(raw)) {
      start = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1);
    } else if (/today|tonight/i.test(raw)) {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        start = parsed;
        allDay = !/[T:]\d/.test(raw);
      }
    }

    if (!start) return null;
    const end = allDay ? addDays(start, 1) : new Date(start.getTime() + 20 * 60000);

    return {
      id: `deadline-${item.source_message_id || item.id || index}`,
      title: item.subject || item.title || conciseActionTitle(item.description) || 'Email deadline',
      description: item.description || item.reason || '',
      start: allDay ? toLocalDateInput(start) : start.toISOString(),
      end: allDay ? toLocalDateInput(end) : end.toISOString(),
      all_day: allDay,
      source: 'deadline',
      conflict: false,
      deadline_label: raw
    };
  }

  function combinedCalendarItems() {
    const dismissed = new Set([
      ...(state.data?.calendar_dismissed_markers || []),
      ...state.calendarDismissedMarkers
    ]);
    const managedMarkers = new Set(
      state.calendarEvents
        .filter(event => event.source === 'ai')
        .map(event => event.agent_harness?.agent_harness_marker)
        .filter(Boolean)
    );

    const deadlines = (state.data?.needs_attention || [])
      .filter(item => item.deadline)
      .filter(item => {
        const sourceId = attentionSourceId(item);
        const marker = sourceId ? `gmail-${sourceId}` : '';
        if (!marker) return true;
        // Do not render a second virtual deadline when the real AI event exists,
        // and do not resurrect a deadline the user explicitly deleted.
        return !managedMarkers.has(marker) && !dismissed.has(marker);
      })
      .map(deadlineToCalendarItem)
      .filter(Boolean);

    return [...state.calendarEvents, ...deadlines];
  }

  function localConflictPass(events) {
    const timed = events
      .filter(e => !e.all_day)
      .map(e => ({ event: e, start: parseEventStart(e), end: parseEventEnd(e) }))
      .filter(x => x.start && x.end);

    timed.forEach(x => {
      x.event.conflict = Boolean(x.event.conflict);
      x.event.conflict_with = Array.isArray(x.event.conflict_with) ? x.event.conflict_with : [];
    });

    for (let i = 0; i < timed.length; i += 1) {
      for (let j = i + 1; j < timed.length; j += 1) {
        const a = timed[i];
        const b = timed[j];
        if (a.start < b.end && b.start < a.end) {
          a.event.conflict = true;
          b.event.conflict = true;
          if (!a.event.conflict_with.some(x => x.id === b.event.id)) a.event.conflict_with.push({ id: b.event.id, title: b.event.title });
          if (!b.event.conflict_with.some(x => x.id === a.event.id)) b.event.conflict_with.push({ id: a.event.id, title: a.event.title });
        }
      }
    }
    return events;
  }

  function initCalendarControls() {
    $('calendarTodayBtn')?.addEventListener('click', () => {
      state.calendarWeekStart = startOfWeek(new Date());
      refreshCalendar(true);
    });
    $('calendarPrevBtn')?.addEventListener('click', () => {
      state.calendarWeekStart = addDays(state.calendarWeekStart, -7);
      refreshCalendar(true);
    });
    $('calendarNextBtn')?.addEventListener('click', () => {
      state.calendarWeekStart = addDays(state.calendarWeekStart, 7);
      refreshCalendar(true);
    });
    $('newCalendarEventBtn')?.addEventListener('click', () => openCalendarModal());
    $('calendarModalClose')?.addEventListener('click', closeCalendarModal);
    $('calendarCancelBtn')?.addEventListener('click', closeCalendarModal);
    $('calendarModal')?.addEventListener('click', event => {
      if (event.target === $('calendarModal')) closeCalendarModal();
    });
    $('calendarEventForm')?.addEventListener('submit', saveCalendarEvent);
    $('calendarDeleteEventBtn')?.addEventListener('click', deleteSelectedCalendarEvent);

    window.addEventListener('harness:calendar-refresh', () => refreshCalendar(true));
  }

  function setCalendarSyncState(kind, text) {
    const el = $('calendarSyncState');
    if (!el) return;
    el.dataset.state = kind;
    el.lastChild.textContent = ` ${text}`;
  }

  async function refreshCalendar(force = false) {
    if (state.calendarSyncing && !force) return state.calendarEvents;
    const requestSeq = ++state.calendarSyncSeq;
    state.calendarSyncing = true;
    setCalendarSyncState('syncing', 'Syncing');

    const { start, end } = calendarRange();
    try {
      const url = new URL(`${API_BASE}/api/calendar/events`);
      url.searchParams.set('start', start.toISOString());
      url.searchParams.set('end', end.toISOString());
      url.searchParams.set('limit', '250');
      if (force) url.searchParams.set('_', Date.now());

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Calendar returned ${response.status}`);
      const events = await response.json();
      if (requestSeq !== state.calendarSyncSeq) return state.calendarEvents;
      state.calendarEvents = localConflictPass(Array.isArray(events) ? events : []);
      state.calendarLastSyncAt = new Date();

      renderCalendar();
      renderUpcomingFromContext();
      setCalendarSyncState('ready', `Synced ${state.calendarLastSyncAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
      window.Kyle?.setContext({
        ...(state.data || {}),
        calendarEvents: state.calendarEvents,
        health: state.health,
        currentPage: state.currentPage
      });
      return state.calendarEvents;
    } catch (error) {
      console.warn('Calendar sync failed:', error);
      setCalendarSyncState('error', 'Sync failed');
      addError('Calendar: ' + error.message);
      return state.calendarEvents;
    } finally {
      if (requestSeq === state.calendarSyncSeq) state.calendarSyncing = false;
    }
  }

  function startCalendarAutoSync() {
    if (state.calendarSyncTimer) clearInterval(state.calendarSyncTimer);
    // Google -> Agent Harness: refresh once a minute while the page is open.
    state.calendarSyncTimer = setInterval(() => {
      if (!document.hidden) refreshCalendar(false);
    }, 60000);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshCalendar(false);
    });
    window.addEventListener('focus', () => refreshCalendar(false));
  }

  function renderCalendar() {
    const grid = $('calendarGrid');
    const allDay = $('calendarAllDay');
    if (!grid || !allDay) return;

    const { start: weekStart, end: weekEnd } = calendarRange();
    const weekItems = combinedCalendarItems().filter(event => {
      const start = parseEventStart(event);
      const end = parseEventEnd(event) || start;
      return start && end && start < weekEnd && end >= weekStart;
    });
    localConflictPass(weekItems);

    const rangeLabel = $('calendarRangeLabel');
    if (rangeLabel) {
      const endDate = addDays(weekStart, 6);
      rangeLabel.textContent = `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${endDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    renderAllDayRow(allDay, weekStart, weekItems);
    renderTimedGrid(grid, weekStart, weekItems);
    renderConflictAlert(weekItems);
  }

  function renderAllDayRow(container, weekStart, items) {
    const today = new Date();
    let html = '<div class="calendar-all-day-label">all-day</div>';

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const day = addDays(weekStart, dayIndex);
      const dayKey = toLocalDateInput(day);
      const isToday = day.toDateString() === today.toDateString();
      const dayItems = items.filter(event => {
        if (!event.all_day) return false;
        return String(event.start).slice(0, 10) === dayKey;
      });

      html += `
        <div class="calendar-all-day-cell">
          <div class="calendar-day-head ${isToday ? 'is-today' : ''}">
            <small>${day.toLocaleDateString([], { weekday: 'short' })}</small>
            <strong>${day.getDate()}</strong>
          </div>
          <div class="calendar-all-day-events">
            ${dayItems.map(event => `
              <button class="calendar-allday-chip ${eventTypeClass(event)} urgency-${eventUrgency(event)} ${event.conflict ? 'conflict' : ''}" type="button" data-calendar-event="${escapeHtml(event.id)}" data-kyle-type="calendar-event" data-kyle-id="${escapeHtml(event.id)}" data-kyle-label="${escapeHtml(event.title)}" title="${escapeHtml(event.deadline_label || event.title)}">
                ${escapeHtml(event.title)}
              </button>`).join('')}
          </div>
        </div>`;
    }

    container.innerHTML = html;
    bindCalendarEventClicks(container, items);
  }

  function eventUrgency(event) {
    if (event.conflict) return 'clash';
    if (event.urgency) return event.urgency;
    const start = parseEventStart(event);
    if (!start) return 'normal';
    const hours = (start.getTime() - Date.now()) / 3600000;
    if (hours <= 6) return 'critical';
    if (hours <= 24) return 'urgent';
    return 'normal';
  }

  function eventTypeClass(event) {
    if (event.source === 'ai') return 'source-ai';
    if (event.source === 'deadline') return 'source-deadline';
    return 'source-google';
  }

  function renderTimedGrid(container, weekStart, items) {
    const visibleTimed = items
      .filter(event => !event.all_day)
      .map(event => parseEventStart(event))
      .filter(Boolean);
    const earliestHour = visibleTimed.length ? Math.min(...visibleTimed.map(d => d.getHours())) : 7;
    const START_HOUR = Math.max(0, Math.min(7, earliestHour));
    const END_HOUR = 24;
    const HOUR_HEIGHT = 56;
    const today = new Date();
    container.dataset.startHour = String(START_HOUR);

    let timeHtml = '<div class="calendar-time-column">';
    for (let hour = START_HOUR; hour <= END_HOUR; hour += 1) {
      const top = (hour - START_HOUR) * HOUR_HEIGHT;
      const labelDate = new Date(2000, 0, 1, hour % 24);
      timeHtml += `<span class="calendar-time-label" style="top:${top}px">${labelDate.toLocaleTimeString([], { hour: 'numeric' })}</span>`;
    }
    timeHtml += '</div>';

    let columns = '';
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const day = addDays(weekStart, dayIndex);
      const isToday = day.toDateString() === today.toDateString();
      const dayKey = toLocalDateInput(day);

      const dayItems = items
        .filter(event => !event.all_day && parseEventStart(event)?.toDateString() === day.toDateString())
        .sort((a, b) => parseEventStart(a) - parseEventStart(b));

      let blocks = '';
      dayItems.forEach(event => {
        const start = parseEventStart(event);
        const end = parseEventEnd(event) || new Date(start.getTime() + 30 * 60000);
        const startMinutes = start.getHours() * 60 + start.getMinutes();
        const endMinutes = end.getHours() * 60 + end.getMinutes();
        const visibleStart = Math.max(START_HOUR * 60, startMinutes);
        const visibleEnd = Math.min(END_HOUR * 60, Math.max(endMinutes, visibleStart + 15));
        if (visibleEnd <= START_HOUR * 60 || visibleStart >= END_HOUR * 60) return;

        const top = ((visibleStart - START_HOUR * 60) / 60) * HOUR_HEIGHT;
        const height = Math.max(22, ((visibleEnd - visibleStart) / 60) * HOUR_HEIGHT - 2);
        const classes = [
          'calendar-event-block',
          eventTypeClass(event),
          `urgency-${eventUrgency(event)}`,
          event.conflict ? 'conflict' : ''
        ].filter(Boolean).join(' ');

        blocks += `
          <button class="${classes}" type="button" data-calendar-event="${escapeHtml(event.id)}" data-kyle-type="calendar-event" data-kyle-id="${escapeHtml(event.id)}" data-kyle-label="${escapeHtml(event.title)}" style="top:${top}px;height:${height}px" title="${escapeHtml(event.title)}">
            <strong>${event.source === 'ai' ? '<span class="calendar-ai-mark">AI</span> ' : ''}${escapeHtml(event.title)}</strong>
            <small>${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${event.conflict ? ' · CLASH' : event.source === 'ai' ? ' · AUTO' : ''}</small>
          </button>`;
      });

      let nowLine = '';
      if (isToday) {
        const nowMinutes = today.getHours() * 60 + today.getMinutes();
        if (nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60) {
          const top = ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
          nowLine = `<div class="calendar-now-line" style="top:${top}px"></div>`;
        }
      }

      columns += `<div class="calendar-day-column ${isToday ? 'is-today' : ''}" data-calendar-day="${dayKey}">${blocks}${nowLine}</div>`;
    }

    container.innerHTML = timeHtml + columns;
    bindCalendarEventClicks(container, items);
  }

  function bindCalendarEventClicks(root, items) {
    root.querySelectorAll('[data-calendar-event]').forEach(button => {
      const event = items.find(item => String(item.id) === button.dataset.calendarEvent);
      if (event) window.MailmateObjects?.register({
        type: 'calendar-event',
        id: String(event.id),
        label: event.title || 'Calendar event',
        page: 'calendar',
        metadata: {
          start: event.start,
          end: event.end,
          source: event.source,
          conflict: event.conflict
        }
      }, button);
      button.addEventListener('click', () => {
        if (!event) return;
        const reference = { type: 'calendar-event', id: String(event.id), label: event.title || 'Calendar event' };
        window.MailmateContext?.select(reference);
        window.MailmateContext?.open(reference);
        state.calendarSelectedEventId = event.source === 'deadline' ? null : event.id;
        if (event.source === 'deadline') {
          showDeadlineInKyle(event);
          return;
        }
        openCalendarModal(event);
      });
    });
  }

  function renderConflictAlert(items) {
    const alert = $('calendarConflictAlert');
    const text = $('calendarConflictText');
    if (!alert || !text) return;
    const conflicts = items.filter(item => item.conflict);
    const pairCount = Math.ceil(conflicts.length / 2);
    alert.hidden = conflicts.length === 0;
    if (conflicts.length) {
      text.textContent = `${pairCount} schedule clash${pairCount === 1 ? '' : 'es'} this week. Conflicting events are highlighted in red.`;
    }
  }

  function showDeadlineInKyle(event) {
    window.dispatchEvent(new CustomEvent('harness:kyle-brief', {
      detail: {
        title: 'Email deadline',
        items: [{ title: event.title, meta: event.deadline_label || event.description }]
      }
    }));
  }

  function openCalendarModal(event = null) {
    const modal = $('calendarModal');
    if (!modal) return;

    const now = new Date();
    const start = event ? parseEventStart(event) : new Date(now.getTime() + 30 * 60000);
    if (!event) start.setMinutes(start.getMinutes() < 30 ? 30 : 0, 0, 0);
    const end = event ? (parseEventEnd(event) || new Date(start.getTime() + 3600000)) : new Date(start.getTime() + 3600000);

    $('calendarModalTitle').textContent = event ? 'Edit event' : 'New event';
    $('calendarEventId').value = event?.id || '';
    $('calendarEventTitle').value = event?.title || '';
    $('calendarEventDate').value = toLocalDateInput(start);
    $('calendarEventStart').value = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    $('calendarEventEnd').value = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
    $('calendarEventLocation').value = event?.location || '';
    $('calendarEventDescription').value = event?.description || '';
    $('calendarDeleteEventBtn').hidden = !event;
    state.calendarSelectedEventId = event?.id || null;
    if (event) window.MailmateContext?.open({ type: 'calendar-event', id: String(event.id), label: event.title || 'Calendar event' });
    modal.hidden = false;
    setTimeout(() => $('calendarEventTitle')?.focus(), 20);
  }

  function closeCalendarModal() {
    const modal = $('calendarModal');
    if (modal) modal.hidden = true;
  }

  function formEventPayload() {
    const date = $('calendarEventDate').value;
    const startTime = $('calendarEventStart').value;
    const endTime = $('calendarEventEnd').value;
    const start = new Date(`${date}T${startTime}:00`);
    let end = new Date(`${date}T${endTime}:00`);
    if (end <= start) end = addDays(end, 1);

    return {
      title: $('calendarEventTitle').value.trim(),
      description: $('calendarEventDescription').value.trim(),
      location: $('calendarEventLocation').value.trim(),
      start: start.toISOString(),
      end: end.toISOString()
    };
  }

  async function saveCalendarEvent(event) {
    event.preventDefault();
    const id = $('calendarEventId').value;
    const payload = formEventPayload();
    if (!payload.title) return;

    const response = await fetch(id ? `${API_BASE}/api/calendar/events/${encodeURIComponent(id)}` : `${API_BASE}/api/calendar/events`, {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      addError(detail.error || `Calendar save returned ${response.status}`);
      return;
    }

    closeCalendarModal();
    await refreshCalendar(true);
    window.dispatchEvent(new CustomEvent('harness:calendar-changed'));
  }

  async function deleteSelectedCalendarEvent() {
    const id = $('calendarEventId').value;
    if (!id) return;
    if (!window.confirm('Delete this Google Calendar event?')) return;

    const response = await fetch(`${API_BASE}/api/calendar/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const detail = await response.json().catch(() => ({}));
    if (!response.ok) {
      addError(detail.error || `Calendar delete returned ${response.status}`);
      return;
    }

    const marker = detail.dismissed_marker || detail.marker;
    if (marker) {
      state.calendarDismissedMarkers.add(marker);
      if (state.data) state.data.calendar_dismissed_markers = [...state.calendarDismissedMarkers];
      saveSessionSnapshot(state.data);
    }

    // Remove it immediately so an older in-flight calendar GET cannot make the
    // deleted event appear to flash back into the UI.
    state.calendarEvents = state.calendarEvents.filter(item => String(item.id) !== String(id));
    state.calendarSelectedEventId = null;
    closeCalendarModal();
    renderCalendar();
    await refreshCalendar(true);
    window.dispatchEvent(new CustomEvent('harness:calendar-changed'));
  }

  async function createCalendarEvent(payload) {
    const response = await fetch(`${API_BASE}/api/calendar/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Calendar create returned ${response.status}`);
    const event = await response.json();
    await refreshCalendar(true);
    return event;
  }

  async function updateCalendarEvent(id, payload) {
    const response = await fetch(`${API_BASE}/api/calendar/events/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Calendar update returned ${response.status}`);
    const event = await response.json();
    await refreshCalendar(true);
    return event;
  }

  async function removeCalendarEvent(id) {
    const response = await fetch(`${API_BASE}/api/calendar/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const detail = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(detail.error || `Calendar delete returned ${response.status}`);
    const marker = detail.dismissed_marker || detail.marker;
    if (marker) {
      state.calendarDismissedMarkers.add(marker);
      if (state.data) state.data.calendar_dismissed_markers = [...state.calendarDismissedMarkers];
      saveSessionSnapshot(state.data);
    }
    state.calendarEvents = state.calendarEvents.filter(item => String(item.id) !== String(id));
    renderCalendar();
    await refreshCalendar(true);
    return true;
  }

  window.AgentCalendar = {
    refresh: () => refreshCalendar(true),
    createEvent: createCalendarEvent,
    updateEvent: updateCalendarEvent,
    deleteEvent: removeCalendarEvent,
    getSelectedEvent: () => state.calendarEvents.find(event => event.id === state.calendarSelectedEventId) || null,
    getSelectedEventId: () => state.calendarSelectedEventId,
    getEvents: () => [...state.calendarEvents],
    open: () => showTab('calendar')
  };
});
