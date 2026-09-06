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
    inboxFilter: 'all',
    currentPage: 'overview'
  };

  const pageCopy = {
    overview: ['Overview', 'Your inbox, distilled into what matters now.'],
    inbox: ['Inbox', 'Recent Gmail, sorted for urgency and action.'],
    work: ['Work', 'Useful agent activity and approved next steps.'],
    automations: ['Automations', 'Scheduled workflows that watch your inbox for you.'],
    status: ['Status', 'Auth, cache, AI, browser voice, and runtime details.'],
    integrations: ['Integrations', 'Services powering your inbox workspace.'],
    settings: ['Settings', 'Session preferences and data handling.']
  };

  boot();

  async function boot() {
    hydrateReturnParams();
    bindEvents();
    setProfile();
    await loadHealth();
    await loadInbox(false);
  }

  function hydrateReturnParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true' && params.get('userId')) {
      state.userId = params.get('userId');
      state.userName = params.get('name') || state.userName;
      state.userPicture = params.get('picture') || state.userPicture;
      localStorage.setItem('userId', state.userId);
      localStorage.setItem('userName', state.userName);
      if (state.userPicture) localStorage.setItem('userPicture', state.userPicture);
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

    window.addEventListener('harness:open-email', event => {
      const email = event.detail;
      state.selectedEmailId = emailKey(email);
      renderEmails(state.data?.emails || []);
      showTab('inbox');
    });

    window.addEventListener('harness:error', event => {
      addError(event.detail?.message || 'Unknown Kyle error.');
      renderStatus();
    });
  }

  function showTab(name) {
    state.currentPage = name;
    const copy = pageCopy[name] || pageCopy.overview;
    els.pageTitle.textContent = copy[0];
    els.pageSubtitle.textContent = copy[1];
    document.title = `Agent Harness - ${copy[0]}`;
    els.tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
    els.panels.forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
    window.Kyle?.setContext({ ...(state.data || {}), health: state.health, currentPage: name });
    console.log('[Harness] navigation', name);
  }

  function setProfile(profile = {}) {
    const name = profile.name || state.userName;
    const picture = profile.picture || state.userPicture || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=111111&color=ffffff`;
    els.profileName.textContent = name;
    els.profilePic.src = picture;
    els.profilePic.alt = name;
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
    } catch (error) {
      addError('Health check failed: ' + error.message);
    }
  }

  async function loadInbox(forceRefresh) {
    console.log('[Harness] dashboard load', forceRefresh ? 'refresh' : 'cache-first');
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
      await sleep(180);
      setStep('cache', 'done', forceRefresh ? 'Refresh requested' : 'Cache checked first');
      setStep('fetch', 'active', 'Fetching recent Gmail metadata');
      const response = await fetch(`${API_BASE}/api/dashboard/overview?userId=${encodeURIComponent(state.userId)}${forceRefresh ? '&refresh=true' : ''}`);
      if (response.status === 401) {
        localStorage.removeItem('userId');
        throw new Error('Gmail session expired. Reconnect Google from the landing page.');
      }
      if (!response.ok) throw new Error(`Dashboard returned ${response.status}`);
      setStep('fetch', 'done', 'Gmail metadata loaded');
      setStep('extract', 'active', 'Extracting work, blockers, and deadlines');
      const data = await response.json();
      await sleep(180);
      setStep('extract', 'done', data.cached ? 'Loaded processed context' : 'New context extracted');
      setStep('store', 'active', 'Saving processed context');
      await sleep(150);
      setStep('store', 'done', data.cached ? 'Stored context reused' : 'Supabase context saved');

      state.data = data;
      renderDashboard(data);
      if (data.user) setProfile(data.user);
      els.processState.textContent = data.cached ? 'Cache reused' : 'Complete';
      window.Kyle?.setContext({ ...data, health: state.health, currentPage: state.currentPage });
      console.log('[Harness] dashboard ready');
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
      ? attention.slice(0, 5).map(item => `<li><strong>${escapeHtml(senderName(item.sender))}</strong><span>${escapeHtml(item.reason || item.subject || 'Needs follow-up')}</span></li>`).join('')
      : '<li><strong>Inbox clear</strong><span>No urgent dependencies detected in this scan.</span></li>';

    const actions = attention.slice(0, 4).map(item => ({
      title: `Review ${senderName(item.sender)}`,
      body: item.reason || item.subject || 'Prepare the next useful response.'
    }));
    els.actionList.innerHTML = actions.length
      ? actions.map((action, index) => `<article><span class="status-dot"></span><div><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(action.body)}</p></div><small>${index ? 'Queued' : 'Ready'}</small></article>`).join('')
      : '<article><span class="status-dot"></span><div><strong>No active work</strong><p>Kyle will surface work from actionable email.</p></div><small>Idle</small></article>';

    const upcoming = (data.emails || []).filter(email => /deadline|due|meeting|tomorrow|schedule|assessment|invite/i.test(`${email.subject || ''} ${email.snippet || ''}`)).slice(0, 4);
    els.upcomingList.innerHTML = upcoming.length
      ? upcoming.map(email => `<article><time>${escapeHtml(formatDate(email.date || email.timestamp, true))}</time><div><strong>${escapeHtml(email.subject || 'Upcoming item')}</strong><p>${escapeHtml(senderName(email.sender))}</p></div></article>`).join('')
      : '<p>No upcoming deadlines found in the current scan.</p>';

    renderEmails(data.emails || []);
    renderWork(data);
  }

  function renderEmails(emails) {
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
          <article class="email-item ${selected ? 'is-selected' : ''} ${email.is_read === false ? 'is-unread' : ''} ${isImportant(email) ? 'is-important' : ''}" data-index="${index}">
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
      item.addEventListener('click', () => {
        const email = filtered[Number(item.dataset.index)];
        state.selectedEmailId = emailKey(email);
        renderEmails(emails);
      });
    });

    const selected = emails.find(email => emailKey(email) === state.selectedEmailId);
    renderEmailDetail(selected);
  }

  function renderEmailDetail(email) {
    if (!email) {
      els.emailDetail.innerHTML = '<div class="empty-detail"><i class="far fa-envelope-open"></i><p>Select an email to read it here.</p></div>';
      return;
    }
    els.emailDetail.innerHTML = `
      <header class="email-detail-header">
        <p class="section-label">${isImportant(email) ? 'Needs attention' : 'Message'}</p>
        <h2>${escapeHtml(email.subject || 'No subject')}</h2>
        <div class="email-detail-meta"><span>${escapeHtml(email.sender || 'Unknown sender')}</span><time>${escapeHtml(formatDate(email.date || email.timestamp, true))}</time></div>
      </header>
      <div class="email-body">${escapeHtml(email.body || email.snippet || 'This message has no readable text body.')}</div>`;
  }

  function renderWork(data) {
    const attention = data.needs_attention || [];
    const actions = attention.slice(0, 6).map(item => ({
      title: `Follow up with ${senderName(item.sender)}`,
      body: item.reason || item.subject || 'Review this thread and prepare the next response.'
    }));
    els.workCount.textContent = `${actions.length} run${actions.length === 1 ? '' : 's'}`;
    els.workList.innerHTML = actions.length
      ? actions.map((action, index) => `<article class="work-item ${index === 0 ? 'active' : ''}" data-index="${index}"><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(action.body)}</p></article>`).join('')
      : '<article class="work-item active"><strong>No work runs yet</strong><p>Actionable Gmail threads will appear here.</p></article>';

    [...els.workList.querySelectorAll('.work-item[data-index]')].forEach(item => item.addEventListener('click', () => {
      const action = actions[Number(item.dataset.index)];
      [...els.workList.querySelectorAll('.work-item')].forEach(row => row.classList.toggle('active', row === item));
      els.runTitle.textContent = action.title;
      els.agentTimeline.innerHTML = `
        <article><span>K</span><div><strong>Kyle</strong><p>${escapeHtml(action.body)}</p></div></article>
        <article><span>P</span><div><strong>Planner</strong><p>Prepared a short review and response workflow.</p></div></article>
        <article><span>G</span><div><strong>Gmail agent</strong><p>Linked the original message context without reprocessing unrelated mail.</p></div></article>`;
    }));
  }

  function renderStatus() {
    const h = state.health || {};
    const rows = [
      ['Google OAuth', h.googleClientConfigured],
      ['Gmail session', h.gmailAuthenticated || Boolean(state.userId)],
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
      ['Gemini', h.geminiConfigured],
      ['Supabase', h.supabaseConfigured],
      ['Browser voice', 'speechSynthesis' in window]
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
});
