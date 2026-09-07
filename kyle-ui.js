(function () {
  function createKyleUi(store) {
    const mount = createFloatingMount();
    mount.innerHTML = `
      <section class="kyle-global" aria-label="Kyle voice assistant">
        <div class="kyle-widget" data-state="IDLE">
          <!-- Contextual Action Panel: Mini Email Composer & Live Agent Activity HUD -->
          <div class="kyle-action-panel" id="kyleActionPanel" aria-live="polite" aria-hidden="true">
            <header class="kyle-panel-header">
              <div class="kyle-panel-header-titles">
                <div style="display:flex;align-items:center;gap:8px;">
                  <h3 class="kyle-panel-title" id="kylePanelTitle">Kyle</h3>
                  <span class="kyle-card-badge" id="kyleCardBadge" style="display:none;"></span>
                </div>
                <p class="kyle-panel-subtitle" id="kylePanelSubtitle"></p>
              </div>
              <div class="kyle-panel-header-actions">
                <button class="kyle-panel-btn" id="kylePanelMinimizeBtn" type="button" aria-label="Minimize draft" title="Minimize"><i class="fas fa-minus"></i></button>
                <button class="kyle-panel-btn kyle-panel-close-btn" id="kylePanelCloseBtn" type="button" aria-label="Close panel" title="Close">
                  <i class="fas fa-xmark"></i>
                </button>
              </div>
            </header>

            <div class="kyle-panel-body" id="kylePanelBody">
              <!-- Mini Composer View -->
              <div class="kyle-composer-view" id="kyleComposerView">
                <div class="kyle-composer-loading" id="kyleComposerLoading" hidden><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i><span>Preparing your draft...</span></div>
                <div class="kyle-composer-field">
                  <label class="kyle-composer-label" for="kyleComposerSubject">Subject</label>
                  <input class="kyle-composer-input" id="kyleComposerSubject" type="text" placeholder="Subject">
                </div>
                <div class="kyle-composer-field">
                  <label class="kyle-composer-label" for="kyleComposerText">Message</label>
                  <textarea class="kyle-composer-textarea" id="kyleComposerText" rows="6" placeholder="Message body..."></textarea>
                </div>
              </div>

              <!-- Live Agent Activity HUD View -->
              <div class="kyle-activity-hud-view" id="kyleActivityHudView" style="display:none;">
                <div class="kyle-hud-header">
                  <span class="kyle-hud-dot"></span>
                  <strong class="kyle-hud-title" id="kyleHudTitle">Work Agent</strong>
                </div>
                <p class="kyle-hud-status" id="kyleHudStatus">Processing request...</p>
                <div class="kyle-hud-steps" id="kyleHudSteps"></div>
              </div>

              <!-- Command Card View with Live Steps & Contextual Action Chips -->
              <div class="kyle-command-view" id="kyleCommandView" style="display:none;">
                <div class="kyle-step-list" id="kyleStepList"></div>
                <div class="kyle-command-result" id="kyleCommandResult" style="display:none;"></div>
                <div class="kyle-action-chips" id="kyleActionChips" style="display:none;"></div>
              </div>

              <!-- Structured Error Recovery View -->
              <div class="kyle-error-view" id="kyleErrorView" style="display:none;">
                <div class="kyle-error-card">
                  <div class="kyle-error-title"><i class="fas fa-triangle-exclamation"></i> <span id="kyleErrorTitle">Action Needed</span></div>
                  <p class="kyle-error-reason" id="kyleErrorReason">Something went wrong.</p>
                  <div class="kyle-error-actions" id="kyleErrorActions"></div>
                </div>
              </div>

              <div class="kyle-confirmation-view" id="kyleConfirmationView" style="display:none;">
                <p class="kyle-confirmation-copy" id="kyleConfirmationCopy"></p>
                <div class="kyle-confirmation-list" id="kyleConfirmationList"></div>
              </div>

              <div class="kyle-surface-result" id="kyleSurfaceResult" style="display:none;"></div>
            </div>

            <footer class="kyle-panel-footer" id="kylePanelFooter">
              <div class="kyle-panel-status" id="kylePanelStatus">Draft ready · Edit anytime or click Send</div>
              <div class="kyle-panel-actions">
                <button class="kyle-btn secondary-btn" id="kyleComposerChangeBtn" type="button">Cancel</button>
                <button class="kyle-btn primary-btn" id="kyleComposerSendBtn" type="button">
                  <i class="fas fa-paper-plane"></i> Send
                </button>
              </div>
            </footer>
          </div>

          <form class="kyle-shell">
            <input class="prompt-input" type="text" autocomplete="off" placeholder="Ask Kyle anything..." aria-label="Ask Kyle">
            <button class="send-icon" type="submit" aria-label="Send to Kyle"><i class="fas fa-arrow-up"></i></button>
            <button class="kyle-orb" type="button" aria-label="Talk to Kyle">
              <span class="orb-visual" aria-hidden="true"><canvas class="orb-canvas" width="192" height="192"></canvas></span>
            </button>
            <span class="kyle-state-label" aria-live="polite">Kyle is idle</span>
          </form>
          <p class="kyle-caption-bubble" aria-live="polite"></p>
          <div class="kyle-transcript" id="kyleTranscript" aria-live="polite" aria-label="Kyle conversation"></div>
          <div class="kyle-result-panel"></div>
        </div>
      </section>
    `;

    const root = mount.querySelector('.kyle-global');
    const widget = mount.querySelector('.kyle-widget');
    const orb = mount.querySelector('.kyle-orb');
    const form = mount.querySelector('.kyle-shell');
    const input = mount.querySelector('.prompt-input');
    const caption = mount.querySelector('.kyle-caption-bubble');
    const transcript = mount.querySelector('#kyleTranscript');
    const stateLabel = mount.querySelector('.kyle-state-label');
    const resultPanel = mount.querySelector('.kyle-result-panel');
    const canvas = mount.querySelector('.orb-canvas');
    const context = canvas.getContext('2d');

    const panel = mount.querySelector('#kyleActionPanel');
    const panelTitle = mount.querySelector('#kylePanelTitle');
    const panelSubtitle = mount.querySelector('#kylePanelSubtitle');
    const cardBadge = mount.querySelector('#kyleCardBadge');
    const panelMicBtn = mount.querySelector('#kylePanelMicBtn');
    const panelMinimizeBtn = mount.querySelector('#kylePanelMinimizeBtn');
    const panelCloseBtn = mount.querySelector('#kylePanelCloseBtn');
    const composerView = mount.querySelector('#kyleComposerView');
    const hudView = mount.querySelector('#kyleActivityHudView');
    const commandView = mount.querySelector('#kyleCommandView');
    const stepList = mount.querySelector('#kyleStepList');
    const commandResult = mount.querySelector('#kyleCommandResult');
    const actionChips = mount.querySelector('#kyleActionChips');
    const errorView = mount.querySelector('#kyleErrorView');
    const errorTitle = mount.querySelector('#kyleErrorTitle');
    const errorReason = mount.querySelector('#kyleErrorReason');
    const errorActions = mount.querySelector('#kyleErrorActions');
    const confirmationView = mount.querySelector('#kyleConfirmationView');
    const confirmationCopy = mount.querySelector('#kyleConfirmationCopy');
    const confirmationList = mount.querySelector('#kyleConfirmationList');
    const surfaceResult = mount.querySelector('#kyleSurfaceResult');
    const subjectInput = mount.querySelector('#kyleComposerSubject');
    const bodyInput = mount.querySelector('#kyleComposerText');
    const composerLoading = mount.querySelector('#kyleComposerLoading');
    const panelStatus = mount.querySelector('#kylePanelStatus');
    const panelFooter = mount.querySelector('#kylePanelFooter');
    const changeBtn = mount.querySelector('#kyleComposerChangeBtn');
    const sendBtn = mount.querySelector('#kyleComposerSendBtn');
    const hudTitle = mount.querySelector('#kyleHudTitle');
    const hudStatus = mount.querySelector('#kyleHudStatus');
    const hudSteps = mount.querySelector('#kyleHudSteps');

    let activeDraft = null;
    let currentPanelMode = 'none'; // 'composer' | 'hud' | 'none'
    let isSending = false;
    let cloudPhase = 0.65;
    let captionTimer = null;
    let surfaceTimer = null;
    let boundHandlers = {};
    let presentationMode = 'floating';
    let composerState = 'idle';
    let stateBeforeMinimize = 'idle';
    let fillGeneration = 0;

    function createFloatingMount() {
      const existing = document.getElementById('kyleMount');
      if (existing) existing.remove();
      const fallback = document.createElement('div');
      fallback.id = 'kyleMount';
      fallback.className = 'kyle-floating-mount';
      document.body.appendChild(fallback);
      return fallback;
    }

    function drawCloud(energy, phaseAdvance) {
      const size = canvas.width;
      const center = size / 2;
      cloudPhase += phaseAdvance || 0;
      context.clearRect(0, 0, size, size);

      const base = context.createRadialGradient(center * 0.72, center * 0.66, 4, center, center, center);
      base.addColorStop(0, '#fbfbf8');
      base.addColorStop(0.52, '#cfcfca');
      base.addColorStop(1, '#747473');
      context.fillStyle = base;
      context.fillRect(0, 0, size, size);

      const fields = [
        { x: 0.34, y: 0.29, radius: 0.42, light: 248, alpha: 0.90 },
        { x: 0.70, y: 0.34, radius: 0.37, light: 224, alpha: 0.72 },
        { x: 0.39, y: 0.72, radius: 0.39, light: 174, alpha: 0.55 },
        { x: 0.72, y: 0.73, radius: 0.34, light: 78, alpha: 0.48 },
        { x: 0.50, y: 0.50, radius: 0.28, light: 236, alpha: 0.36 }
      ];

      fields.forEach((field, index) => {
        const drift = 5 + energy * 22;
        const x = size * field.x + Math.sin(cloudPhase * (0.72 + index * 0.08) + index * 1.6) * drift;
        const y = size * field.y + Math.cos(cloudPhase * (0.58 + index * 0.09) + index * 1.2) * drift;
        const radius = size * field.radius * (1 + energy * Math.sin(cloudPhase * 1.3 + index) * 0.15);
        const st = widget?.dataset?.state || 'IDLE';
        let rO = 0, gO = 0, bO = 0;
        if (st === 'NAVIGATING' || st === 'THINKING') { rO = -12; gO = 4; bO = 32; }
        else if (st === 'WORKING' || st === 'ACTING') { rO = 8; gO = -4; bO = 32; }
        else if (st === 'SUCCESS' || st === 'DONE') { rO = -18; gO = 32; bO = 6; }
        else if (st === 'ERROR') { rO = 35; gO = -18; bO = -18; }
        else if (st === 'WAITING_APPROVAL' || st === 'APPROVAL') { rO = 28; gO = 14; bO = -12; }

        const rC = Math.min(255, Math.max(0, field.light + rO));
        const gC = Math.min(255, Math.max(0, field.light + gO));
        const bC = Math.min(255, Math.max(0, field.light - 3 + bO));

        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(${rC}, ${gC}, ${bC}, ${field.alpha})`);
        gradient.addColorStop(0.52, `rgba(${rC}, ${gC}, ${bC}, ${field.alpha * 0.34})`);
        gradient.addColorStop(1, 'rgba(120, 120, 118, 0)');
        context.globalCompositeOperation = field.light > 190 ? 'screen' : 'multiply';
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);
      });

      context.globalCompositeOperation = 'source-over';
      const edge = context.createRadialGradient(center, center, size * 0.30, center, center, center);
      edge.addColorStop(0, 'rgba(255,255,255,0)');
      edge.addColorStop(0.84, 'rgba(34,34,33,0.05)');
      edge.addColorStop(1, 'rgba(22,22,21,0.48)');
      context.fillStyle = edge;
      context.fillRect(0, 0, size, size);
    }

    function setAmplitude(value, phaseAdvance = 0.016) {
      const energy = Math.max(0, Math.min(1, value || 0));
      root.style.setProperty('--orb-amplitude', String(energy));
      drawCloud(energy, energy > 0 ? phaseAdvance * (0.7 + energy * 1.8) : 0);
    }

    function setState(next) {
      widget.dataset.state = next;
      const textByState = {
        IDLE: 'Kyle is idle',
        LISTENING: 'Kyle is listening',
        TRANSCRIBING: 'Kyle is transcribing',
        THINKING: 'Kyle is thinking',
        NAVIGATING: 'Kyle is guiding',
        WORKING: 'Kyle is working',
        SPEAKING: 'Kyle is speaking',
        INTERRUPTED: 'Kyle was interrupted',
        ERROR: 'Kyle needs attention',
        RESULT: 'Kyle has results',
        ACTING: 'Kyle is acting',
        OBSERVING: 'Kyle is checking the result',
        APPROVAL: 'Kyle needs approval',
        WAITING_APPROVAL: 'Kyle needs approval',
        SUCCESS: 'Kyle finished',
        DONE: 'Kyle finished'
      };
      stateLabel.textContent = textByState[next] || 'Kyle';
      const placeholderByState = {
        IDLE: 'Ask Kyle anything...', LISTENING: 'Listening...', TRANSCRIBING: 'Understanding your request...',
        THINKING: 'Understanding your request...', NAVIGATING: 'Taking you there...', WORKING: 'Working on it...',
        ACTING: 'Working on it...', OBSERVING: 'Checking the result...', WAITING_APPROVAL: 'Review needed',
        APPROVAL: 'Review needed', SUCCESS: 'Done', DONE: 'Done', ERROR: 'Kyle needs attention'
      };
      input.placeholder = placeholderByState[next] || 'Ask Kyle anything...';
      widget.classList.toggle('is-expanded', next !== 'IDLE');
      drawCloud(parseFloat(root.style.getPropertyValue('--orb-amplitude')) || 0, 0.02);
    }

    function setPresentationMode(mode, options = {}) {
      const next = mode === 'overview' ? 'overview' : 'floating';
      const effective = activeDraft ? 'floating' : next;
      const target = effective === 'overview' ? document.getElementById('kyleOverviewHome') : document.body;
      if (!target || (presentationMode === effective && mount.parentElement === target)) return;
      const canMeasure = typeof form.getBoundingClientRect === 'function';
      const before = canMeasure ? form.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
      presentationMode = effective;
      mount.classList.toggle('kyle-overview-mount', effective === 'overview');
      mount.classList.toggle('kyle-floating-mount', effective === 'floating');
      target.appendChild(mount);
      mount.style.transform = '';
      const after = canMeasure ? form.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
      if (!options.immediate && typeof form.animate === 'function' && before.width && after.width) {
        form.animate([
          { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scaleX(${before.width / after.width})`, transformOrigin: 'right center', opacity: 0.9 },
          { transform: 'translate(0, 0) scaleX(1)', transformOrigin: 'right center', opacity: 1 }
        ], { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
      mount.dataset.presentation = effective;
    }

    function selectSurfaceView(mode) {
      currentPanelMode = mode;
      if (composerView) composerView.style.display = mode === 'email_review' ? 'flex' : 'none';
      if (hudView) hudView.style.display = mode === 'activity' ? 'flex' : 'none';
      if (commandView) commandView.style.display = mode === 'command' ? 'block' : 'none';
      if (errorView) errorView.style.display = mode === 'error_recovery' ? 'block' : 'none';
      if (confirmationView) confirmationView.style.display = mode === 'calendar_confirmation' ? 'flex' : 'none';
      if (surfaceResult) surfaceResult.style.display = ['result', 'error'].includes(mode) ? 'block' : 'none';
      if (panel) panel.dataset.mode = mode;
    }

    function openSurface(mode, title = 'Kyle', subtitle = '') {
      clearTimeout(surfaceTimer);
      selectSurfaceView(mode);
      if (panelTitle) panelTitle.textContent = title;
      if (panelSubtitle) panelSubtitle.textContent = subtitle;
      if (panel) {
        panel.classList.add('is-open');
        panel.setAttribute('aria-hidden', 'false');
      }
    }

    function closeSurface() {
      clearTimeout(surfaceTimer);
      if (panel) {
        panel.classList.remove('is-open');
        panel.setAttribute('aria-hidden', 'true');
        panel.dataset.mode = 'compact';
      }
      activeDraft = null;
      composerState = 'idle';
      stateBeforeMinimize = 'idle';
      panel?.classList.remove('is-minimized');
      currentPanelMode = 'compact';
    }

    function setComposerState(next, message = '') {
      composerState = next || 'idle';
      if (panel) panel.dataset.composerState = composerState;
      const busy = ['preparing', 'generating'].includes(composerState);
      if (composerLoading) composerLoading.hidden = !busy;
      if (subjectInput) subjectInput.disabled = busy || ['sending', 'sent'].includes(composerState);
      if (bodyInput) bodyInput.disabled = busy || ['sending', 'sent'].includes(composerState);
      if (message) setComposerStatus(message, composerState === 'error');
    }

    function openPreparingComposer(mode = 'compose') {
      activeDraft = { recipient: '', to: '', subject: '', body: '', thread_id: null, in_reply_to: null, operation_id: null, mode };
      setPresentationMode('floating', { immediate: true });
      openSurface('email_review', mode === 'reply' ? 'Preparing reply' : 'Preparing email', 'Kyle is working');
      subjectInput.value = '';
      bodyInput.value = '';
      panelFooter.style.display = 'flex';
      changeBtn.style.display = 'none';
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Preparing';
      setComposerState('preparing', 'Understanding your request...');
    }

    function animateField(element, value, generation) {
      const finalValue = String(value || '');
      if (!element || !finalValue || typeof setInterval !== 'function') {
        if (element) element.value = finalValue;
        return Promise.resolve();
      }
      element.value = '';
      const chunk = Math.max(2, Math.ceil(finalValue.length / 24));
      return new Promise(resolve => {
        let index = 0;
        const timer = setInterval(() => {
          if (generation !== fillGeneration) { clearInterval(timer); resolve(); return; }
          index = Math.min(finalValue.length, index + chunk);
          element.value = finalValue.slice(0, index);
          if (index >= finalValue.length) { clearInterval(timer); resolve(); }
        }, 14);
      });
    }

    function showSurfaceResult(title, text, options = {}) {
      openSurface(options.error ? 'error' : 'result', title || 'Kyle', options.subtitle || '');
      surfaceResult.innerHTML = `<p>${escapeHtml(text || '')}</p>`;
      panelFooter.style.display = options.actionLabel ? 'flex' : 'none';
      if (options.actionLabel) {
        panelStatus.textContent = '';
        changeBtn.style.display = 'none';
        sendBtn.disabled = false;
        sendBtn.innerHTML = escapeHtml(options.actionLabel);
        sendBtn.onclick = options.onAction || null;
      }
      if (options.autoHideMs) surfaceTimer = setTimeout(closeSurface, options.autoHideMs);
    }

    function setLiveText(text, autoHideMs = 0) {
      clearTimeout(captionTimer);
      const value = String(text || '').trim();
      if (!value) return;
      if (['email_review', 'calendar_confirmation'].includes(currentPanelMode)) {
        panelStatus.textContent = value;
        return;
      }
      if (currentPanelMode === 'activity') {
        hudStatus.textContent = value;
        return;
      }
      setSubtitle(value);
    }

    function setSubtitle(text, options = {}) {
      clearTimeout(captionTimer);
      const value = String(text || '').trim();
      caption.textContent = value;
      caption.classList.toggle('is-visible', Boolean(value));
      widget.classList.toggle('has-caption', Boolean(value));
      // Conversation subtitles remain visible for this page session. A refresh
      // starts a new visual transcript while the server still gets recent turns.
    }

    function showResponse(text, options = {}) {
      showSurfaceResult(options.title || 'Kyle', text, options);
    }

    function showActionPanel(config = {}) {
      showCommandCard(config);
    }

    function setMuted(muted) {
      if (!panelMicBtn) return;
      panelMicBtn.innerHTML = muted ? '<i class="fas fa-volume-xmark"></i>' : '<i class="fas fa-volume-high"></i>';
      panelMicBtn.setAttribute('aria-label', muted ? 'Unmute Kyle' : 'Mute Kyle');
      panelMicBtn.title = muted ? 'Unmute Kyle' : 'Mute Kyle';
      panelMicBtn.classList.toggle('is-muted', muted);
    }

    function appendMessage(role, text) {
      const messages = transcript;
      if (!messages || !String(text || '').trim()) return;
      const article = document.createElement('article');
      article.className = `kyle-transcript-line ${role}`;
      article.innerHTML = `<span class="kyle-transcript-speaker" aria-hidden="true">${role === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-sparkles"></i>'}</span><p>${escapeHtml(text)}</p>`;
      messages.appendChild(article);
      while (messages.children.length > 8) messages.firstElementChild.remove();
      messages.scrollTop = messages.scrollHeight;
    }

    function renderResults(title, items) {
      if (!items || !items.length) {
        if (currentPanelMode === 'result') closeSurface();
        return;
      }
      openSurface('result', title || 'Kyle');
      panelFooter.style.display = 'none';
      surfaceResult.innerHTML = items.slice(0, 5).map((item, index) => `
        <button type="button" data-result="${index + 1}">${escapeHtml(item.subject || item.reason || item.title || 'Open item')}</button>
      `).join('');
    }

    function renderBrief(title, items) {
      if (!items || !items.length) {
        if (currentPanelMode === 'result') closeSurface();
        return;
      }
      openSurface('result', title || 'Kyle');
      panelFooter.style.display = 'none';
      surfaceResult.innerHTML = items.slice(0, 6).map(item => `
        <div class="kyle-brief-item ${item.conflict ? 'conflict' : ''}">
          <strong>${escapeHtml(item.title || 'Item')}</strong>
          <small>${escapeHtml(item.meta || '')}</small>
        </div>
      `).join('');
    }

    surfaceResult?.addEventListener?.('click', event => {
      const button = event.target?.closest?.('[data-result]');
      if (!button) return;
      window.KyleActions?.openEmail?.(button.dataset.result);
      closeSurface();
    });

    function openComposer(draft = {}, mode = 'reply') {
      activeDraft = {
        recipient: draft.recipient || draft.to || '',
        to: draft.to || '',
        subject: draft.subject || '',
        body: draft.body || '',
        thread_id: draft.thread_id || null,
        in_reply_to: draft.in_reply_to || null,
        operation_id: draft.operation_id || null,
        mode: mode
      };
      setPresentationMode('floating', { immediate: true });
      const displayName = (activeDraft.recipient || activeDraft.to || '').split('<')[0].trim() || activeDraft.to || 'Contact';
      openSurface('email_review', mode === 'reply' ? `Reply to ${displayName}` : `Email ${displayName}`, activeDraft.to || activeDraft.recipient || '');
      panel.classList.remove('is-minimized');
      const generation = ++fillGeneration;
      setComposerState('generating', 'Filling message...');
      Promise.all([
        animateField(subjectInput, activeDraft.subject, generation),
        animateField(bodyInput, activeDraft.body, generation)
      ]).then(() => {
        if (generation !== fillGeneration || !activeDraft) return;
        subjectInput.value = activeDraft.subject || '';
        bodyInput.value = activeDraft.body || '';
        setComposerState('draft_ready', 'Draft ready · Edit anytime or click Send');
        sendBtn.disabled = !isValidEmail(activeDraft.to);
      });

      panelFooter.style.display = 'flex';
      panelStatus.textContent = 'Draft ready · Edit anytime or click Send';
      panelStatus.style.color = 'var(--muted)';
      changeBtn.style.display = '';
      changeBtn.textContent = 'Edit';
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
      if (!isValidEmail(activeDraft.to)) setComposerStatus('A valid recipient email is required.', true);
    }

    function closeComposer() {
      closeSurface();
    }

    function minimizeComposer() {
      if (!activeDraft) return;
      stateBeforeMinimize = composerState;
      composerState = 'minimized';
      panel.dataset.composerState = composerState;
      panel.classList.add('is-minimized');
      panel.setAttribute('aria-hidden', 'false');
    }

    function restoreComposer() {
      if (!activeDraft) return;
      panel.classList.remove('is-minimized');
      const restoredState = stateBeforeMinimize === 'minimized' ? 'draft_ready' : stateBeforeMinimize;
      setComposerState(restoredState || 'draft_ready', restoredState === 'preparing' || restoredState === 'generating'
        ? 'Preparing your draft...'
        : 'Draft ready · Edit anytime or click Send');
    }

    function setComposerDraft(draft = {}) {
      if (!activeDraft) {
        openComposer(draft, draft.thread_id ? 'reply' : 'compose');
        return;
      }
      if (draft.recipient !== undefined) activeDraft.recipient = draft.recipient;
      if (draft.to !== undefined) activeDraft.to = draft.to;
      if (draft.thread_id !== undefined) activeDraft.thread_id = draft.thread_id;
      if (draft.in_reply_to !== undefined) activeDraft.in_reply_to = draft.in_reply_to;

      if (draft.subject !== undefined) {
        activeDraft.subject = draft.subject;
        activeDraft.operation_id = null;
        subjectInput.value = draft.subject;
      }
      if (draft.body !== undefined) {
        activeDraft.body = draft.body;
        activeDraft.operation_id = null;
        bodyInput.value = draft.body;
        bodyInput.classList.add('draft-revised');
        setTimeout(() => bodyInput.classList.remove('draft-revised'), 700);
      }

      const displayName = (activeDraft.recipient || activeDraft.to || '').split('<')[0].trim() || activeDraft.to || 'Contact';
      panelTitle.textContent = activeDraft.mode === 'reply' ? `Reply to ${displayName}` : `Email ${displayName}`;
      panelSubtitle.textContent = activeDraft.to || activeDraft.recipient || '';
      panelStatus.textContent = 'Draft updated · Edit anytime or click Send';
      panelStatus.style.color = 'var(--muted)';
    }

    function getActiveDraft() {
      if (!activeDraft) return null;
      return {
        ...activeDraft,
        subject: subjectInput.value,
        body: bodyInput.value
      };
    }

    function setComposerStatus(text, isError = false) {
      panelStatus.textContent = text;
      panelStatus.style.color = isError ? '#ef4444' : 'var(--muted)';
    }

    function isValidEmail(value) {
      return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i.test(String(value || '').trim());
    }

    function createOperationId() {
      if (window.crypto?.randomUUID) return window.crypto.randomUUID();
      return `mail_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    }

    async function sendCurrentComposer() {
      if (isSending) return { ok: false, error: 'Already sending' };
      const current = getActiveDraft();
      if (!current) return { ok: false, error: 'No active draft' };
      const to = String(current.to || '').trim();
      if (!isValidEmail(to)) {
        setComposerStatus('A valid recipient email is required.', true);
        return { ok: false, error: 'Invalid recipient' };
      }
      const subject = (subjectInput.value || '').trim();
      const body = (bodyInput.value || '').trim();
      if (!body) {
        setComposerStatus('Message body cannot be empty.', true);
        return { ok: false, error: 'Body empty' };
      }

      isSending = true;
      setComposerState('sending', 'Sending email...');
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
      setComposerStatus('Sending via Gmail API...');

      try {
        activeDraft.operation_id = activeDraft.operation_id || createOperationId();
        const payload = {
          operation_id: activeDraft.operation_id,
          to: to,
          subject: subject,
          body: body,
          thread_id: current.thread_id || null,
          in_reply_to: current.in_reply_to || null
        };

        const requestSend = () => fetch('/api/mail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        let res;
        try {
          res = await requestSend();
        } catch (networkError) {
          setComposerStatus("Couldn't confirm send; checking Gmail...");
          await new Promise(resolve => setTimeout(resolve, 1400));
          res = await requestSend();
        }
        const data = await res.json().catch(() => ({}));
        if (res.status === 202 && ['sending', 'unknown'].includes(data.status)) {
          isSending = false;
          sendBtn.disabled = false;
          sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Check send';
          setComposerStatus("Couldn't confirm send yet. Your draft is unchanged.", true);
          return { ok: false, unknown: true, operationId: payload.operation_id };
        }
        if (!res.ok || !data.ok) {
          const error = new Error(data.error || `Send failed (${res.status})`);
          error.code = data.code;
          error.status = res.status;
          throw error;
        }

        sendBtn.innerHTML = '<i class="fas fa-check"></i> Sent';
        setComposerStatus(`Sent to ${to}`);
        setComposerState('sent', `Sent to ${to}`);
        const doneMsg = `Sent to ${to}.`;
        setLiveText(doneMsg, 4000);
        window.Kyle?.store?.addMessage?.('kyle', doneMsg);

        setTimeout(() => {
          closeComposer();
          isSending = false;
          window.AgentMail?.refresh?.();
        }, 2000);

        return { ok: true, messageId: data.message_id };
      } catch (err) {
        console.error('[Kyle Composer] Send error:', err);
        isSending = false;
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
        if (err.code !== 'send_unconfirmed') activeDraft.operation_id = null;
        const message = err.code === 'reconnect_google'
          ? 'Reconnect Google to grant Gmail send access.'
          : err.code === 'invalid_recipient'
            ? 'Invalid recipient email.'
            : err.code === 'send_unconfirmed'
              ? "Couldn't confirm send; checking Gmail is required."
              : `Failed to send: ${err.message}`;
        setComposerState('error', message);
        return { ok: false, error: err.message };
      }
    }

    function renderActivityHud(jobOrProgress) {
      if (!jobOrProgress) {
        if (currentPanelMode === 'activity') closeSurface();
        return;
      }
      openSurface('activity', 'Kyle', jobOrProgress.title || jobOrProgress.goal || 'Working on task');
      panelFooter.style.display = 'none';

      hudTitle.textContent = jobOrProgress.action || jobOrProgress.title || 'Work Agent';
      hudStatus.textContent = jobOrProgress.status || jobOrProgress.state || 'Processing...';

      const steps = jobOrProgress.steps || [];
      if (steps.length) {
        hudSteps.innerHTML = steps.slice(-4).map(s => `
          <div class="kyle-hud-step ${s.status || 'done'}">
            <span class="kyle-hud-step-icon">
              ${s.status === 'done' ? '<i class="fas fa-check"></i>' : '<i class="fas fa-circle-notch fa-spin"></i>'}
            </span>
            <div class="kyle-hud-step-text">
              <strong>${escapeHtml(s.label || s.action || s.thought || '')}</strong>
              <small>${escapeHtml(s.observation?.summary || s.detail || '')}</small>
            </div>
          </div>
        `).join('');
      } else {
        hudSteps.innerHTML = '';
      }

    }

    function formatEventTime(event) {
      const start = new Date(event.start);
      const end = new Date(event.end || event.start);
      if (Number.isNaN(start.getTime())) return '';
      const day = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      if (event.all_day) return `${day} · All day`;
      return `${day} · ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }

    function showCalendarConfirmation(events = []) {
      const count = events.length;
      const onlyDeadlines = events.length > 0 && events.every(event => event.source === 'deadline');
      openSurface('calendar_confirmation', count === 1 ? 'Remove item?' : `Remove ${count} items?`, onlyDeadlines ? 'Mailmate deadline' : 'Google Calendar');
      confirmationCopy.textContent = count === 1
        ? (onlyDeadlines ? 'This derived deadline will be dismissed from Mailmate.' : 'This event will be removed from Google Calendar.')
        : 'These items will be removed together after one confirmation.';
      confirmationList.innerHTML = events.map(event => `
        <div class="kyle-confirmation-item">
          <strong>${escapeHtml(event.title || 'Calendar event')}</strong>
          <small>${escapeHtml(formatEventTime(event))}</small>
        </div>
      `).join('');
      panelFooter.style.display = 'flex';
      panelStatus.textContent = 'Review the exact event list before deleting.';
      panelStatus.style.color = '#b87810';
      changeBtn.style.display = '';
      changeBtn.textContent = 'Cancel';
      sendBtn.disabled = false;
      sendBtn.innerHTML = `<i class="fas fa-trash"></i> Delete${count > 1 ? ` ${count}` : ''}`;
    }

    function showDeleteResult(result = {}) {
      const deleted = Number(result.deletedCount ?? result.deleted_count ?? 0);
      const failed = Number(result.failedCount ?? result.failed_count ?? 0);
      const message = failed
        ? `${deleted} deleted. ${failed} could not be removed.`
        : `${deleted} event${deleted === 1 ? '' : 's'} deleted. Calendar is up to date.`;
      showSurfaceResult(failed ? 'Partially complete' : 'Done', message, { error: deleted === 0 && failed > 0, autoHideMs: failed ? 0 : 3200 });
    }

    panelCloseBtn?.addEventListener?.('click', () => {
      if (currentPanelMode === 'calendar_confirmation') window.KyleExecutor?.cancelPending?.();
      closeSurface();
    });
    panelMinimizeBtn?.addEventListener?.('click', () => panel.classList.contains('is-minimized') ? restoreComposer() : minimizeComposer());
    panel?.querySelector?.('.kyle-panel-header')?.addEventListener?.('dblclick', restoreComposer);
    panelMicBtn?.addEventListener?.('click', () => boundHandlers.onMute?.());
    subjectInput?.addEventListener?.('input', () => {
      if (activeDraft) activeDraft.operation_id = null;
    });
    bodyInput?.addEventListener?.('input', () => {
      if (activeDraft) activeDraft.operation_id = null;
    });
    changeBtn?.addEventListener?.('click', () => {
      if (currentPanelMode === 'calendar_confirmation') {
        window.KyleExecutor?.cancelPending?.();
        closeSurface();
        return;
      }
      bodyInput?.focus?.();
      setComposerStatus('Editing draft... ask Kyle to revise or type directly.');
    });
    sendBtn?.addEventListener?.('click', () => {
      if (currentPanelMode === 'calendar_confirmation') {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
        window.KyleExecutor?.approvePending?.();
        return;
      }
      if (currentPanelMode === 'email_review') sendCurrentComposer();
    });

    function bind(handlers) {
      boundHandlers = handlers || {};
      orb.addEventListener('click', handlers.onOrb);
      input.addEventListener('focus', () => handlers.onTextFocus?.());
      input.addEventListener('input', () => handlers.onTextFocus?.());
      form.addEventListener('submit', event => {
        event.preventDefault();
        const prompt = input.value.trim();
        if (!prompt) return;
        input.value = '';
        handlers.onText(prompt);
      });
      form.addEventListener('click', event => {
        if (presentationMode === 'overview' && event.target === form) input.focus();
      });
      document.addEventListener?.('keydown', event => {
        if (event.key === '/' && presentationMode === 'overview' && !/input|textarea/i.test(document.activeElement?.tagName || '')) {
          event.preventDefault();
          input.focus();
        }
        if (event.key === 'Escape') {
          if (activeDraft) minimizeComposer();
          else closeSurface();
          input.blur();
        }
      });
    }

    window.addEventListener('kyle:state', event => setState(event.detail.state));
    window.addEventListener('kyle:message', event => appendMessage(event.detail.role, event.detail.text));
    window.addEventListener('harness:kyle-brief', event => {
      const detail = event.detail || {};
      renderBrief(detail.title || 'Kyle', detail.items || []);
    });
    window.addEventListener('kyle:motion-caption', event => {
      const detail = event.detail || {};
      setSubtitle(detail.text || '', { autoHideMs: detail.transient ? 2400 : 0 });
    });
    window.addEventListener('kyle:composer-open', event => {
      const detail = event.detail || {};
      openComposer(detail.draft, detail.mode || 'reply');
    });
    window.addEventListener('kyle:composer-close', () => closeComposer());
    window.addEventListener('kyle:activity-hud', event => {
      renderActivityHud(event.detail);
    });
    window.addEventListener('kyle:action-start', event => {
      if (activeDraft) return;
      const transaction = event.detail?.transaction || {};
      renderActivityHud({
        goal: transaction.goal,
        title: transaction.goal,
        status: 'Working...',
        steps: (transaction.steps || []).map(step => ({
          label: step.action?.tool?.replace(/[._]/g, ' ') || 'Action',
          status: step.status === 'complete' ? 'done' : 'active'
        }))
      });
    });
    window.addEventListener('kyle:action-complete', event => {
      const action = event.detail?.action || {};
      const result = event.detail?.result || {};
      if (action.tool === 'calendar.delete_prepare') return;
      if (action.tool === 'calendar.delete_confirmed') {
        showDeleteResult(result);
        return;
      }
      const transaction = event.detail?.transaction || {};
      if (currentPanelMode === 'activity' && !activeDraft) {
        renderActivityHud({
          goal: transaction.goal,
          title: transaction.goal,
          status: event.detail?.error ? 'Action failed' : 'Checking the result...',
          steps: (transaction.steps || []).map(step => ({
            label: step.action?.tool?.replace(/[._]/g, ' ') || 'Action',
            status: step.status === 'complete' ? 'done' : 'active',
            detail: step.error || ''
          }))
        });
      }
    });

    drawCloud(0, 0);
    setState(store.current);
    setMuted(store.muted);
    setPresentationMode(document.getElementById('tab-overview')?.classList.contains('active') ? 'overview' : 'floating', { immediate: true });


    function showCommandCard(opts = {}) {
      openSurface('command', opts.title || 'Kyle', opts.subtitle || '');
      if (panelFooter) panelFooter.style.display = 'none';

      if (cardBadge) {
        if (opts.badge) {
          cardBadge.style.display = 'inline-flex';
          cardBadge.className = `kyle-card-badge ${opts.badge.toLowerCase()}`;
          cardBadge.textContent = opts.badge;
        } else {
          cardBadge.style.display = 'none';
        }
      }

      renderCommandSteps(opts.steps || []);

      if (commandResult) {
        if (opts.resultHtml) {
          commandResult.style.display = 'block';
          commandResult.innerHTML = opts.resultHtml;
        } else {
          commandResult.style.display = 'none';
          commandResult.innerHTML = '';
        }
      }

      renderActionChips(opts.actions || []);
    }

    function renderCommandSteps(steps = []) {
      if (!stepList) return;
      if (!steps || !steps.length) {
        stepList.innerHTML = '';
        return;
      }
      stepList.innerHTML = steps.map(s => {
        const status = s.status || 'done';
        let iconHtml = '<i class="fas fa-check"></i>';
        if (status === 'active') iconHtml = '<i class="fas fa-arrow-right"></i>';
        else if (status === 'pending') iconHtml = '<i class="fas fa-circle" style="font-size: 0.45rem;"></i>';
        else if (status === 'failed') iconHtml = '<i class="fas fa-xmark"></i>';
        return `
          <div class="kyle-step-item ${status}" data-step-id="${escapeHtml(s.id || s.label)}">
            <span class="kyle-step-icon">${iconHtml}</span>
            <span class="kyle-step-label">${escapeHtml(s.label || '')}</span>
          </div>
        `;
      }).join('');
    }

    function updateCommandStep(stepIdOrText, updates = {}) {
      if (!stepList) return;
      const el = stepList.querySelector(`[data-step-id="${stepIdOrText}"]`) ||
                 [...stepList.querySelectorAll('.kyle-step-item')].find(item => item.textContent.includes(stepIdOrText));
      if (!el) return;
      if (updates.status) {
        el.className = `kyle-step-item ${updates.status}`;
        const icon = el.querySelector('.kyle-step-icon');
        if (icon) {
          if (updates.status === 'done') icon.innerHTML = '<i class="fas fa-check"></i>';
          else if (updates.status === 'active') icon.innerHTML = '<i class="fas fa-arrow-right"></i>';
          else if (updates.status === 'failed') icon.innerHTML = '<i class="fas fa-xmark"></i>';
          else icon.innerHTML = '<i class="fas fa-circle" style="font-size: 0.45rem;"></i>';
        }
      }
      if (updates.label) {
        const label = el.querySelector('.kyle-step-label');
        if (label) label.textContent = updates.label;
      }
    }

    function renderActionChips(actions = []) {
      if (!actionChips) return;
      if (!actions || !actions.length) {
        actionChips.style.display = 'none';
        actionChips.innerHTML = '';
        return;
      }
      actionChips.style.display = 'flex';
      actionChips.innerHTML = actions.map((a, idx) => `
        <button class="kyle-action-chip ${a.primary ? 'primary' : ''}" type="button" data-chip-index="${idx}">
          ${a.icon ? `<i class="${escapeHtml(a.icon)}"></i>` : ''}
          <span>${escapeHtml(a.label || 'Action')}</span>
        </button>
      `).join('');

      [...actionChips.querySelectorAll('.kyle-action-chip')].forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.chipIndex);
          const act = actions[idx];
          if (act?.onClick) {
            act.onClick();
          } else if (act?.prompt) {
            window.Kyle?.handlePrompt?.(act.prompt);
          }
        });
      });
    }

    function showErrorRecovery(errorInfo = {}) {
      openSurface('error_recovery', 'Kyle', errorInfo.subtitle || 'Action Needed');
      if (panelFooter) panelFooter.style.display = 'none';
      if (cardBadge) {
        cardBadge.style.display = 'inline-flex';
        cardBadge.className = 'kyle-card-badge error';
        cardBadge.textContent = 'ERROR';
      }

      if (errorTitle) errorTitle.textContent = errorInfo.title || 'Could not complete action';
      if (errorReason) errorReason.textContent = errorInfo.reason || 'An unexpected error occurred.';

      const actions = errorInfo.actions || [];
      if (errorActions) {
        if (actions.length) {
          errorActions.innerHTML = actions.map((a, idx) => `
            <button class="kyle-btn ${a.primary ? 'primary-btn' : 'secondary-btn'}" type="button" data-err-action="${idx}">
              ${a.icon ? `<i class="${escapeHtml(a.icon)}"></i> ` : ''}${escapeHtml(a.label || 'Retry')}
            </button>
          `).join('');

          [...errorActions.querySelectorAll('[data-err-action]')].forEach(btn => {
            btn.addEventListener('click', () => {
              const idx = Number(btn.dataset.errAction);
              const act = actions[idx];
              if (act?.onClick) act.onClick();
            });
          });
        } else {
          errorActions.innerHTML = `
            <button class="kyle-btn secondary-btn" type="button" onclick="window.KyleUi?.active?.closeSurface?.()">Dismiss</button>
          `;
        }
      }
    }

    const uiApi = {
      bind,
      setAmplitude,
      setLiveText,
      setSubtitle,
      showResponse,
      showActionPanel,
      setMuted,
      renderResults,
      renderBrief,
      openComposer,
      openPreparingComposer,
      closeComposer,
      minimizeComposer,
      restoreComposer,
      setComposerState,
      setComposerDraft,
      getActiveDraft,
      setComposerStatus,
      sendCurrentComposer,
      renderActivityHud,
      showCalendarConfirmation,
      showDeleteResult,
      showSurfaceResult,
      closeSurface,
      showCommandCard,
      renderCommandSteps,
      updateCommandStep,
      renderActionChips,
      showErrorRecovery,
      setPresentationMode
    };
    window.KyleUi.active = uiApi;
    return uiApi;
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  window.KyleUi = { createKyleUi };
})();
