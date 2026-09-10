(function () {
  function hasFullBrowserDom() {
    return typeof window !== 'undefined'
      && typeof document !== 'undefined'
      && typeof document.createElement === 'function'
      && document.documentElement
      && document.head
      && document.body;
  }

  function normalizeBrandAssets() {
    if (!hasFullBrowserDom()) return;
    const mailmateLogo = './assets/images/mailmate_logo.png';

    document.querySelectorAll('.brand img, .mailmate-native-boot-logo').forEach(image => {
      if (image.getAttribute('src') !== mailmateLogo) image.setAttribute('src', mailmateLogo);
      image.removeAttribute('onerror');
    });

    document.querySelectorAll('link[rel~="icon"]').forEach(icon => {
      if (icon.getAttribute('href') !== mailmateLogo) icon.setAttribute('href', mailmateLogo);
      icon.setAttribute('type', 'image/png');
    });
  }

  function installNativeBoot() {
    // Policy is also loaded inside lightweight Node VM harnesses. In that
    // environment there is intentionally no full browser DOM, so the product
    // boot UI must be skipped while KylePolicy remains available for tests.
    if (!hasFullBrowserDom()) return null;
    if (window.__MAILMATE_NATIVE_BOOT__) return window.MailmateBoot || null;
    window.__MAILMATE_NATIVE_BOOT__ = true;

    try {
      const savedTheme = localStorage.getItem('mailmate-theme');
      const prefersDark = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    } catch (_) {}

    const style = document.createElement('style');
    style.id = 'mailmateNativeBootStyle';
    style.textContent = `
      body.mailmate-native-boot { overflow: hidden !important; }
      body.mailmate-native-boot .app-shell {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transform: translateY(5px) !important;
      }
      body.mailmate-app-ready .app-shell {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
        transition: opacity 300ms ease, transform 360ms cubic-bezier(.16,1,.3,1);
      }
      body.mailmate-native-boot #mailmateBootGate,
      body.mailmate-native-boot #mailmateInitialLoader,
      body.mailmate-app-ready #mailmateBootGate,
      body.mailmate-app-ready #mailmateInitialLoader { display: none !important; }
      #mailmateNativeBoot {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: grid;
        place-items: center;
        background: #f3f3f0;
        color: #11110f;
        opacity: 1;
        visibility: visible;
        pointer-events: all;
        transition: opacity 280ms ease, visibility 280ms ease;
      }
      html[data-theme="dark"] #mailmateNativeBoot {
        background: #0c0c0b;
        color: #f4f4f1;
      }
      #mailmateNativeBoot.is-leaving {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      .mailmate-native-boot-inner {
        width: min(360px, calc(100vw - 48px));
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .mailmate-native-boot-brand {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        margin-bottom: 28px;
        font-family: "Space Grotesk", "Plus Jakarta Sans", system-ui, sans-serif;
        font-size: 1.55rem;
        font-weight: 700;
        letter-spacing: 0;
      }
      .mailmate-native-boot-logo {
        width: 116px;
        height: 108px;
        object-fit: contain;
        filter: drop-shadow(0 12px 30px rgba(0,0,0,.2));
      }
      .mailmate-native-buffer {
        width: 31px;
        height: 31px;
        margin-bottom: 18px;
        border-radius: 50%;
        border: 2px solid rgba(17,17,15,.13);
        border-top-color: currentColor;
        animation: mailmateNativeSpin .72s linear infinite;
      }
      html[data-theme="dark"] .mailmate-native-buffer {
        border-color: rgba(255,255,255,.13);
        border-top-color: currentColor;
      }
      .mailmate-native-status {
        min-height: 22px;
        margin: 0;
        color: #6d6d67;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        font-size: .82rem;
        font-weight: 500;
        letter-spacing: -.01em;
        opacity: 1;
        transform: translateY(0);
        transition: opacity 120ms ease, transform 160ms ease;
      }
      html[data-theme="dark"] .mailmate-native-status { color: #9c9c95; }
      .mailmate-native-status.is-changing {
        opacity: 0;
        transform: translateY(4px);
      }
      body.mailmate-app-ready #tab-overview .overview-inner {
        animation: mailmateNativeDataArrival 360ms cubic-bezier(.16,1,.3,1) both;
      }
      @keyframes mailmateNativeSpin { to { transform: rotate(360deg); } }
      @keyframes mailmateNativeDataArrival {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        #mailmateNativeBoot,
        .mailmate-native-status,
        body.mailmate-app-ready .app-shell,
        body.mailmate-app-ready #tab-overview .overview-inner {
          transition: none !important;
          animation: none !important;
        }
      }
    `;
    document.head.appendChild(style);
    document.body.classList.add('mailmate-native-boot');

    const boot = document.createElement('div');
    boot.id = 'mailmateNativeBoot';
    boot.setAttribute('role', 'status');
    boot.setAttribute('aria-live', 'polite');
    boot.setAttribute('aria-label', 'MailMate is loading');
    boot.innerHTML = `
      <div class="mailmate-native-boot-inner">
        <div class="mailmate-native-boot-brand">
          <img class="mailmate-native-boot-logo" src="./assets/images/mailmate_logo.png" alt="MailMate">
          <span>MailMate</span>
        </div>
        <span class="mailmate-native-buffer" aria-hidden="true"></span>
        <p class="mailmate-native-status" id="mailmateNativeBootStatus">Starting MailMate</p>
      </div>
    `;
    document.body.appendChild(boot);

    const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : callback => setTimeout(callback, 0);

    const startedAt = now();
    const settled = { profile: false, overview: false, calendar: false, health: false };
    let done = false;
    let statusTimer = null;
    let finishTimer = null;
    let lastEssentialSettledAt = startedAt;

    function setStatus(text) {
      if (done || !text) return;
      const node = document.getElementById('mailmateNativeBootStatus');
      if (!node || node.textContent === text) return;
      clearTimeout(statusTimer);
      node.classList.add('is-changing');
      statusTimer = setTimeout(() => {
        node.textContent = text;
        raf(() => node.classList.remove('is-changing'));
      }, 105);
    }

    function uiLooksSettled() {
      const important = document.getElementById('importantCount')?.textContent?.trim();
      const emails = document.getElementById('emailCount')?.textContent?.trim();
      const attention = document.getElementById('attentionList')?.textContent || '';
      const upcoming = document.getElementById('upcomingList')?.textContent || '';
      const profile = document.getElementById('profileName')?.textContent?.trim();
      return important && important !== '--'
        && emails && emails !== '--'
        && !/Loading current priorities/i.test(attention)
        && !/Loading upcoming commitments/i.test(upcoming)
        && profile && profile !== 'User';
    }

    function finish(reason) {
      if (done) return;
      done = true;
      clearTimeout(statusTimer);
      clearTimeout(finishTimer);
      const statusNode = document.getElementById('mailmateNativeBootStatus');
      if (statusNode) {
        statusNode.textContent = reason === 'timeout' ? 'Opening workspace' : 'Ready';
        statusNode.classList.remove('is-changing');
      }
      document.body.classList.remove('mailmate-initial-loading', 'mailmate-boot-lock');
      document.body.classList.add('mailmate-live-ready');
      document.getElementById('mailmateBootGate')?.remove();
      document.getElementById('mailmateInitialLoader')?.remove();

      const reveal = () => {
        document.body.classList.remove('mailmate-native-boot');
        document.body.classList.add('mailmate-app-ready');
        const gate = document.getElementById('mailmateNativeBoot');
        gate?.classList.add('is-leaving');
        setTimeout(() => gate?.remove(), 320);
      };
      raf(() => raf(reveal));
    }

    function maybeFinish() {
      if (done || !Object.values(settled).every(Boolean)) return;
      clearTimeout(finishTimer);
      setStatus('Preparing your workspace');
      const waitForStableUi = () => {
        if (done) return;
        const age = now() - lastEssentialSettledAt;
        if ((age >= 220 && uiLooksSettled()) || age > 1400) {
          const minDelay = Math.max(0, 420 - (now() - startedAt));
          finishTimer = setTimeout(() => finish('ready'), minDelay);
          return;
        }
        finishTimer = setTimeout(waitForStableUi, 55);
      };
      waitForStableUi();
    }

    function mark(name) {
      if (!Object.prototype.hasOwnProperty.call(settled, name)) return;
      settled[name] = true;
      lastEssentialSettledAt = now();
      maybeFinish();
    }

    if (typeof window.fetch === 'function' && !window.fetch.__mailmateNativeBoot) {
      const baseFetch = window.fetch.bind(window);
      window.fetch = async function (input, init = {}) {
        let url;
        try { url = new URL(typeof input === 'string' ? input : input?.url, window.location.href); }
        catch (_) { return baseFetch(input, init); }

        const method = String(init.method || input?.method || 'GET').toUpperCase();
        const path = url.pathname;
        let tracked = null;
        if (method === 'GET') {
          if (path === '/api/user/profile') {
            tracked = 'profile';
            setStatus('Connecting your Google account');
          } else if (path === '/api/dashboard/overview') {
            tracked = 'overview';
            setStatus('Loading Gmail context');
          } else if (path === '/api/work/jobs') {
            setStatus('Checking Kyle Work');
          } else if (path === '/api/calendar/events') {
            tracked = 'calendar';
            setStatus('Loading your calendar');
          } else if (path === '/api/health') {
            tracked = 'health';
            setStatus('Checking local services');
          } else if (path === '/api/automations') {
            setStatus('Loading automations');
          }
        }

        try {
          const response = await baseFetch(input, init);
          if (tracked) mark(tracked);
          return response;
        } catch (error) {
          if (tracked) mark(tracked);
          throw error;
        }
      };
      window.fetch.__mailmateNativeBoot = true;
    }

    setTimeout(() => {
      if (!done) {
        setStatus('Opening workspace');
        setTimeout(() => finish('timeout'), 180);
      }
    }, 10000);

    const api = { setStatus, mark, finish, settled };
    window.MailmateBoot = api;
    return api;
  }

  normalizeBrandAssets();
  installNativeBoot();

  const UI_TOOLS = new Set([
    'navigation.open', 'inbox.set_filter', 'inbox.open_email', 'calendar.open_event',
    'work.focus', 'ui.highlight', 'ui.scroll_to', 'ui.annotate', 'ui.toast',
    'calendar.preview_move', 'calendar.preview_create',
    'calendar.inspect_event', 'calendar.delete_prepare', 'calendar.refresh',
    'automation.run_now', 'automation.enable', 'automation.disable',
    'mail.compose', 'mail.reply', 'mail.update_draft', 'mail.close_composer'
  ]);
  const WRITE_TOOLS = new Set(['calendar.commit_move', 'calendar.commit_create', 'calendar.delete_confirmed', 'mail.send_draft']);
  const DESTRUCTIVE_TOOLS = new Set(['calendar.delete', 'inbox.send_reply']);

  function evaluate(action = {}) {
    const tool = String(action.tool || '');
    if (tool === 'automation.create') {
      if (!action.args?.explicit_user_request) {
        return { allowed: false, reason: 'Automation creation requires an explicit recurring request from the user.' };
      }
      return { allowed: true, risk: 'write', basis: 'explicit-user-automation' };
    }
    if (UI_TOOLS.has(tool)) return { allowed: true, risk: 'ui' };
    if (WRITE_TOOLS.has(tool)) {
      if (tool === 'mail.send_draft') {
        if (!action.args?.explicit_send) {
          return { allowed: false, approvalRequired: true, reason: 'Say send when you want Kyle to deliver this draft.' };
        }
        return { allowed: true, risk: 'write', basis: 'explicit-user-send' };
      }
      const previewId = String(action.args?.previewId || '');
      if (!previewId) return { allowed: false, reason: 'A visible preview is required before this write.' };
      if (!action.args?.approved) return { allowed: false, approvalRequired: true, reason: 'Review the preview, then confirm the change.' };
      return { allowed: true, risk: 'write' };
    }
    if (DESTRUCTIVE_TOOLS.has(tool)) {
      return { allowed: false, approvalRequired: true, reason: 'This action needs explicit confirmation.' };
    }
    return { allowed: false, reason: 'Tool is not in Kyle policy.' };
  }

  if (typeof window !== 'undefined') window.KylePolicy = { evaluate };

  function loadBranchFix(src, marker, onload) {
    if (!hasFullBrowserDom()) return;
    const selector = `script[data-${marker}]`;
    const existing = document.querySelector(selector);

    const continueChain = () => {
      if (typeof onload === 'function') onload();
    };

    if (existing) {
      const state = existing.getAttribute('data-mailmate-load-state');
      if (state === 'loaded' || state === 'failed') {
        continueChain();
      } else {
        let settled = false;
        let fallbackTimer;
        const settle = nextState => {
          if (settled) return;
          settled = true;
          clearTimeout(fallbackTimer);
          existing.removeEventListener('load', handleLoad);
          existing.removeEventListener('error', handleError);
          existing.setAttribute('data-mailmate-load-state', nextState);
          if (nextState === 'failed') {
            console.warn(`[MailMate] optional UI layer did not settle in time: ${src}`);
          }
          continueChain();
        };
        const handleLoad = () => settle('loaded');
        const handleError = () => settle('failed');

        if (existing.readyState === 'loaded' || existing.readyState === 'complete') {
          settle('loaded');
        } else {
          existing.addEventListener('load', handleLoad, { once: true });
          existing.addEventListener('error', handleError, { once: true });
          fallbackTimer = setTimeout(() => settle('failed'), 2000);
        }
      }
      return existing;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.setAttribute(`data-${marker}`, '1');
    script.setAttribute('data-mailmate-load-state', 'loading');
    script.addEventListener('load', () => {
      script.setAttribute('data-mailmate-load-state', 'loaded');
      continueChain();
    }, { once: true });
    script.addEventListener('error', () => {
      script.setAttribute('data-mailmate-load-state', 'failed');
      console.warn(`[MailMate] optional UI layer failed to load: ${src}`);
      continueChain();
    }, { once: true });
    document.head.appendChild(script);
    return script;
  }

  function loadBranchStyle(src, marker) {
    if (!hasFullBrowserDom() || document.querySelector(`link[data-${marker}]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = src;
    link.setAttribute(`data-${marker}`, '1');
    link.addEventListener('error', () => {
      console.warn(`[MailMate] optional UI stylesheet failed to load: ${src}`);
    }, { once: true });
    document.head.appendChild(link);
  }

  function installRestoredUiLayers() {
    if (!hasFullBrowserDom()) return;

    // Restored compatibility/runtime stack from fa9b8d934f. This stays here as
    // the single dashboard entry point, but only executes in a real browser DOM.
    // Keep the existing order: later layers depend on wrappers/hooks installed
    // by earlier ones and the v8/v9 behavior is covered by dashboard markup tests.
    loadBranchFix('./kyle-main-fixes.js?v=2', 'mailmateKyleMainFixes', () => {
      loadBranchFix('./mailmate-ux-fixes.js?v=1', 'mailmateUxFixes', () => {
        loadBranchFix('./mailmate-inbox-stability-v2.js?v=1', 'mailmateInboxStabilityV2', () => {
          loadBranchFix('./mailmate-product-v4.js?v=1', 'mailmateProductV4', () => {
            loadBranchFix('./mailmate-product-v5.js?v=1', 'mailmateProductV5', () => {
              loadBranchFix('./mailmate-product-v6.js?v=1', 'mailmateProductV6', () => {
                loadBranchStyle('./mailmate-product-v7.css?v=1', 'mailmate-product-v7');
                loadBranchFix('./mailmate-product-v7.js?v=1', 'mailmateProductV7', () => {
                  loadBranchStyle('./mailmate-product-v8.css?v=1', 'mailmate-product-v8');
                  loadBranchFix('./mailmate-product-v8.js?v=2', 'mailmateProductV8', () => {
                    loadBranchFix('./mailmate-live-diff.js?v=2', 'mailmateLiveDiff', () => {
                      loadBranchStyle('./mailmate-product-v9.css?v=2', 'mailmate-product-v9');
                      loadBranchFix('./mailmate-product-v9.js?v=3', 'mailmateProductV9', () => {
                        loadBranchStyle('./mailmate-settings-v1.css?v=1', 'mailmate-settings-v1');
                        loadBranchFix('./mailmate-settings-v1.js?v=1', 'mailmateSettingsV1');
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  }

  installRestoredUiLayers();
})();
