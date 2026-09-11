(function () {
  'use strict';

  if (window.__MAILMATE_SETTINGS_V1__) return;
  window.__MAILMATE_SETTINGS_V1__ = true;

  const THEME_MODE_KEY = 'mailmate-theme-mode';
  const DENSITY_KEY = 'mailmate-ui-density';
  const FONT_KEY = 'mailmate-font-size';
  const MOTION_KEY = 'mailmate-motion';
  const STARTUP_KEY = 'mailmate-startup-page';
  const INBOX_VIEW_KEY = 'mailmate-default-inbox-view';
  const LAST_PAGE_KEY = 'mailmate-last-page';

  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value == null || value === '' ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function themeMode() {
    const explicit = read(THEME_MODE_KEY, '');
    if (explicit === 'dark' || explicit === 'light') return explicit;
    if (explicit === 'system') return 'dark';
    const legacy = read('mailmate-theme', '');
    if (legacy === 'dark' || legacy === 'light') return legacy;
    return 'dark';
  }

  function applyTheme(mode = themeMode()) {
    write(THEME_MODE_KEY, mode);
    const dark = mode !== 'light';
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');

    try {
      localStorage.setItem('mailmate-theme', dark ? 'dark' : 'light');
    } catch (_) {}

    const legacy = document.getElementById('settingDarkMode');
    if (legacy) legacy.checked = dark;
    syncSelected('[data-setting-theme]', mode);
  }

  function applyVisualPreferences() {
    const density = read(DENSITY_KEY, 'comfortable');
    const font = read(FONT_KEY, 'default');
    const motion = read(MOTION_KEY, 'subtle');
    document.documentElement.dataset.mailmateDensity = density;
    document.documentElement.dataset.mailmateFont = font;
    document.documentElement.dataset.mailmateMotion = motion;
    syncSelected('[data-setting-density]', density);
    syncSelected('[data-setting-font]', font);
    syncSelected('[data-setting-motion]', motion);
  }

  function syncSelected(selector, value) {
    document.querySelectorAll(selector).forEach(button => {
      const selected = String(button.dataset.value || '') === String(value || '');
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function articleByTitle(root, title) {
    return [...root.querySelectorAll(':scope > article')].find(article =>
      article.querySelector('h2')?.textContent?.trim().toLowerCase() === String(title).toLowerCase()
    ) || null;
  }

  function createCard(title, description, className = '') {
    const card = document.createElement('section');
    card.className = `settings-modern-card ${className}`.trim();
    card.innerHTML = `<header class="settings-modern-card-header"><div><h3>${title}</h3>${description ? `<p>${description}</p>` : ''}</div></header>`;
    return card;
  }

  function createChoiceRow(title, description, choices, dataName) {
    const row = document.createElement('div');
    row.className = 'settings-modern-row';
    row.innerHTML = `
      <div class="settings-modern-copy"><strong>${title}</strong>${description ? `<span>${description}</span>` : ''}</div>
      <div class="settings-segmented" role="group" aria-label="${title}">
        ${choices.map(choice => `<button type="button" data-${dataName} data-value="${choice.value}">${choice.label}</button>`).join('')}
      </div>`;
    return row;
  }

  function createActionRow(title, description, buttonText, action, danger = false) {
    const row = document.createElement('div');
    row.className = 'settings-modern-row';
    row.innerHTML = `
      <div class="settings-modern-copy"><strong>${title}</strong>${description ? `<span>${description}</span>` : ''}</div>
      <button type="button" class="settings-action-btn${danger ? ' is-danger' : ''}" data-settings-action="${action}">${buttonText}</button>`;
    return row;
  }

  function modernizeAutopilot(article) {
    if (!article) return;
    article.classList.add('settings-modern-embedded', 'settings-autopilot-modern');
    const title = article.querySelector('h2');
    const intro = title?.parentElement?.querySelector('p');
    if (title) title.textContent = 'Automation safety';
    if (intro) intro.textContent = 'Choose what Kyle may prepare automatically and what still waits for you.';

    const copy = {
      off: '<strong>Off</strong><small>Kyle only acts when you ask.</small>',
      prepare: '<strong>Prepare</strong><small>Summaries, research, checklists and drafts. Never sends.</small>',
      safe_replies: '<strong>Safe replies</strong><small>Routine acknowledgements may send after the cancel countdown; commitments still wait.</small>',
      full_prepare: '<strong>Full preparation</strong><small>Reports, files, attachments and drafts are prepared automatically; substantive sends stay gated.</small>'
    };
    article.querySelectorAll('input[name="autoSendMode"]').forEach(input => {
      const label = input.closest('label');
      const span = label?.querySelector('span');
      if (span && copy[input.value]) span.innerHTML = copy[input.value];
      label?.classList.add('settings-autonomy-option');
    });

    const status = document.getElementById('autopilotStatusTag');
    if (status) status.classList.add('settings-status-chip');
  }

  function addConnectedServices(card) {
    const host = document.createElement('div');
    host.className = 'settings-service-list';
    host.id = 'mailmateSettingsServices';
    host.innerHTML = '<div class="settings-service-row"><span>Services</span><em>Checking…</em></div>';
    card.appendChild(host);
  }

  let serviceLoadedAt = 0;
  async function refreshConnectedServices(force = false) {
    const host = document.getElementById('mailmateSettingsServices');
    if (!host) return;
    if (!force && serviceLoadedAt && Date.now() - serviceLoadedAt < 30000) return;
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Health ${response.status}`);
      const health = await response.json();
      const rows = [
        ['Gmail', Boolean(health.gmailAuthenticated || health.gmailWrite)],
        ['Google Calendar', Boolean(health.calendarReadWrite)],
        ['Gemini fallback', Boolean(health.geminiConfigured), true],
        ['Local privacy gate', true]
      ];
      host.innerHTML = rows.map(([label, ok, optional]) => `
        <div class="settings-service-row">
          <span>${label}</span>
          <em class="${ok ? 'is-ready' : optional ? 'is-optional' : 'is-off'}">${ok ? 'Connected' : optional ? 'Optional · off' : 'Unavailable'}</em>
        </div>`).join('');
      serviceLoadedAt = Date.now();
    } catch (_) {
      host.innerHTML = '<div class="settings-service-row"><span>Service status</span><em class="is-off">Unavailable</em></div>';
    }
  }

  function setSegment(key, value) {
    if (key === 'theme') {
      applyTheme(value);
      return;
    }
    const map = {
      density: DENSITY_KEY,
      font: FONT_KEY,
      motion: MOTION_KEY,
      startup: STARTUP_KEY,
      inbox: INBOX_VIEW_KEY
    };
    const storageKey = map[key];
    if (!storageKey) return;
    write(storageKey, value);
    applyVisualPreferences();
    syncSelected(`[data-setting-${key}]`, value);
  }

  function installInteractions() {
    document.addEventListener('click', event => {
      const segmented = event.target.closest('[data-setting-theme], [data-setting-density], [data-setting-font], [data-setting-motion], [data-setting-startup], [data-setting-inbox]');
      if (segmented) {
        const names = ['theme', 'density', 'font', 'motion', 'startup', 'inbox'];
        const name = names.find(candidate => segmented.hasAttribute(`data-setting-${candidate}`));
        setSegment(name, segmented.dataset.value);
        return;
      }

      const action = event.target.closest('[data-settings-action]')?.dataset.settingsAction;
      if (action === 'clear-session') {
        try {
          Object.keys(sessionStorage).filter(key => /^mailmate\./.test(key)).forEach(key => sessionStorage.removeItem(key));
        } catch (_) {}
        event.target.closest('button').textContent = 'Cleared';
        setTimeout(() => { const btn = document.querySelector('[data-settings-action="clear-session"]'); if (btn) btn.textContent = 'Clear session'; }, 1200);
      }
      if (action === 'reset-ui') {
        [THEME_MODE_KEY, DENSITY_KEY, FONT_KEY, MOTION_KEY, STARTUP_KEY, INBOX_VIEW_KEY, LAST_PAGE_KEY, 'mailmate-theme'].forEach(key => {
          try { localStorage.removeItem(key); } catch (_) {}
        });
        applyTheme('dark');
        applyVisualPreferences();
        syncAllSettings();
      }

      const nav = event.target.closest('nav.nav-tabs .nav-tab[data-tab]');
      if (nav) {
        write(LAST_PAGE_KEY, nav.dataset.tab || 'overview');
        if (nav.dataset.tab === 'settings') setTimeout(() => refreshConnectedServices(false), 0);
        if (nav.dataset.tab === 'inbox') setTimeout(applyDefaultInboxView, 30);
      }
    }, true);
  }

  function applyDefaultInboxView() {
    const value = read(INBOX_VIEW_KEY, 'all');
    const filter = document.querySelector(`.filter-tab[data-filter="${CSS.escape(value)}"]`);
    if (filter && !filter.classList.contains('active')) filter.click();
  }

  function syncAllSettings() {
    syncSelected('[data-setting-theme]', themeMode());
    syncSelected('[data-setting-density]', read(DENSITY_KEY, 'comfortable'));
    syncSelected('[data-setting-font]', read(FONT_KEY, 'default'));
    syncSelected('[data-setting-motion]', read(MOTION_KEY, 'subtle'));
    syncSelected('[data-setting-startup]', read(STARTUP_KEY, 'overview'));
    syncSelected('[data-setting-inbox]', read(INBOX_VIEW_KEY, 'all'));
  }

  function applyStartupPageOnce() {
    if (window.__MAILMATE_SETTINGS_STARTUP_APPLIED__) return;
    const tryApply = () => {
      if (window.__MAILMATE_SETTINGS_STARTUP_APPLIED__) return;
      if (!document.body?.classList.contains('mailmate-app-ready')) return;
      window.__MAILMATE_SETTINGS_STARTUP_APPLIED__ = true;
      let target = read(STARTUP_KEY, 'overview');
      if (target === 'last') target = read(LAST_PAGE_KEY, 'overview');
      if (!['overview', 'inbox', 'calendar', 'work', 'automations'].includes(target)) target = 'overview';
      if (target === 'overview') return;
      document.querySelector(`nav.nav-tabs .nav-tab[data-tab="${CSS.escape(target)}"]`)?.click();
    };
    tryApply();
    if (window.__MAILMATE_SETTINGS_STARTUP_APPLIED__) return;
    const observer = new MutationObserver(() => {
      tryApply();
      if (window.__MAILMATE_SETTINGS_STARTUP_APPLIED__) observer.disconnect();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    setTimeout(() => { tryApply(); observer.disconnect(); }, 12000);
  }

  function buildSettings() {
    const panel = document.getElementById('tab-settings');
    const old = panel?.querySelector('.settings-list.settings-surface');
    if (!panel || !old || old.dataset.settingsModernized === '1') return false;
    old.dataset.settingsModernized = '1';

    const profile = old.querySelector('.settings-profile-row');
    const appearance = articleByTitle(old, 'Appearance');
    const retention = articleByTitle(old, 'Mailbox retention');
    const voice = articleByTitle(old, 'Kyle voice & audio');
    const cache = articleByTitle(old, 'Cache policy');
    const privacy = old.querySelector('.settings-privacy-article');
    const autopilot = old.querySelector('.settings-autopilot-article');
    const developer = old.querySelector('.settings-developer-row');
    const developerContent = document.getElementById('developerSettingsContent');
    const danger = old.querySelector('.settings-danger-row');

    const grid = document.createElement('div');
    grid.className = 'settings-modern-grid';

    const appearanceCard = createCard('Appearance', 'Tune how MailMate looks and moves.', 'settings-card-appearance');
    appearanceCard.appendChild(createChoiceRow('Theme', 'Choose the workspace theme.', [
      { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }
    ], 'setting-theme'));
    appearanceCard.appendChild(createChoiceRow('Density', 'Adjust spacing across the workspace.', [
      { value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }
    ], 'setting-density'));
    appearanceCard.appendChild(createChoiceRow('Text size', 'Change interface copy without browser zoom.', [
      { value: 'small', label: 'Small' }, { value: 'default', label: 'Default' }, { value: 'large', label: 'Large' }
    ], 'setting-font'));
    appearanceCard.appendChild(createChoiceRow('Motion', 'Keep transitions subtle or remove them.', [
      { value: 'subtle', label: 'Subtle' }, { value: 'reduced', label: 'Reduced' }, { value: 'off', label: 'Off' }
    ], 'setting-motion'));
    if (appearance) {
      appearance.classList.add('settings-legacy-theme-row');
      appearanceCard.appendChild(appearance);
    }

    const kyleCard = createCard('Kyle Assistant', 'Voice and assistant behavior.', 'settings-card-kyle');
    if (voice) {
      voice.classList.add('settings-modern-embedded');
      const voiceText = voice.querySelector('p');
      if (voiceText) voiceText.textContent = 'Play Kyle’s spoken responses and allow voice input.';
      kyleCard.appendChild(voice);
    }
    kyleCard.appendChild(createChoiceRow('Open on startup', 'Choose the first workspace MailMate opens after loading.', [
      { value: 'overview', label: 'Overview' }, { value: 'inbox', label: 'Inbox' }, { value: 'calendar', label: 'Calendar' }, { value: 'last', label: 'Last used' }
    ], 'setting-startup'));

    const mailCard = createCard('Mail & Inbox', 'Control the default way you enter your mailbox.', 'settings-card-mail');
    mailCard.appendChild(createChoiceRow('Default inbox view', 'Applied whenever you open Inbox.', [
      { value: 'all', label: 'All' }, { value: 'important', label: 'Important' }, { value: 'action', label: 'Requires action' }, { value: 'unread', label: 'Unread' }
    ], 'setting-inbox'));
    const mailNote = document.createElement('div');
    mailNote.className = 'settings-info-note';
    mailNote.innerHTML = '<i class="fas fa-circle-info"></i><span>Needs Attention remains focused on actionable unread mail; reading a message does not complete its deadline.</span>';
    mailCard.appendChild(mailNote);

    const automationCard = createCard('Automations', 'Configure Kyle’s automatic preparation boundaries.', 'settings-card-automation settings-modern-card-wide');
    modernizeAutopilot(autopilot);
    if (autopilot) automationCard.appendChild(autopilot);

    const privacyCard = createCard('Privacy & Storage', 'Mail content stays transient; controls here affect this browser session.', 'settings-card-privacy');
    if (retention) {
      retention.classList.add('settings-modern-embedded', 'settings-compact-status-row');
      const p = retention.querySelector('p');
      if (p) p.textContent = 'Gmail remains the source of truth; message bodies are not kept in a central MailMate mailbox.';
      privacyCard.appendChild(retention);
    }
    if (cache) {
      cache.classList.add('settings-modern-embedded', 'settings-compact-status-row');
      privacyCard.appendChild(cache);
    }
    privacyCard.appendChild(createActionRow('Session cache', 'Clear temporary dashboard and Canvas snapshots for this tab session.', 'Clear session', 'clear-session'));
    if (privacy) privacy.hidden = true;

    const servicesCard = createCard('Connected Services', 'A compact view of the services MailMate can use.', 'settings-card-services');
    addConnectedServices(servicesCard);

    const advancedCard = createCard('Advanced', 'Developer diagnostics and local UI recovery tools.', 'settings-card-advanced settings-modern-card-wide');
    if (developer) {
      developer.classList.add('settings-modern-embedded');
      advancedCard.appendChild(developer);
    }
    if (developerContent) advancedCard.appendChild(developerContent);
    advancedCard.appendChild(createActionRow('Reset interface preferences', 'Restore Dark theme, comfortable spacing, default text and Overview startup.', 'Reset UI', 'reset-ui'));

    const accountCard = createCard('Account', 'Your active Google session.', 'settings-card-account settings-modern-card-wide');
    if (profile) accountCard.appendChild(profile);
    if (danger) {
      const text = danger.querySelector('p');
      if (text) text.textContent = 'End this local Google session on MailMate.';
      accountCard.appendChild(danger);
    }

    [appearanceCard, kyleCard, mailCard, privacyCard, servicesCard, automationCard, advancedCard, accountCard].forEach(card => grid.appendChild(card));
    old.replaceChildren(grid);

    const heading = panel.querySelector('.settings-heading');
    if (heading) {
      heading.querySelector('.section-label')?.remove();
      const description = heading.querySelector('p');
      if (description) description.textContent = 'Personalize MailMate without digging through developer controls.';
    }

    syncAllSettings();
    setTimeout(() => refreshConnectedServices(false), 0);
    return true;
  }

  function boot() {
    applyTheme(themeMode());
    applyVisualPreferences();
    installInteractions();

    const build = () => {
      if (buildSettings()) return true;
      return Boolean(document.querySelector('.settings-modern-grid'));
    };
    if (!build()) {
      const observer = new MutationObserver(() => {
        if (build()) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 10000);
    }
    applyStartupPageOnce();
  }


  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
