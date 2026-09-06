(() => {
  'use strict';

  const POLL_MS = 4000;
  const ACTIVE_WAIT_STATES = new Set([
    'waiting_local_model',
    'queued',
    'planning',
    'reading_context',
    'researching',
    'generating',
    'drafting_reply',
    'creating_files',
    'verifying',
    'preparing',
    'working'
  ]);

  const runtime = {
    timer: null,
    polling: false,
    lastReady: null,
    autoRetriedForReadyCycle: false
  };

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      cache: 'no-store',
      ...options
    });

    let body = {};
    try {
      body = await response.json();
    } catch (_) {}

    if (!response.ok) {
      throw new Error(body.error || `${url} returned ${response.status}`);
    }
    return body;
  };

  function ensureBanner() {
    const workTab = document.querySelector('#tab-work');
    if (!workTab) return null;

    let banner = document.querySelector('#kyleComputeBanner');
    if (banner) return banner;

    banner = document.createElement('section');
    banner.id = 'kyleComputeBanner';
    banner.className = 'kyle-compute-banner';
    banner.hidden = true;
    banner.innerHTML = `
      <div class="kyle-compute-icon" aria-hidden="true">
        <i class="fas fa-microchip"></i>
      </div>
      <div class="kyle-compute-copy">
        <div class="kyle-compute-title-row">
          <strong id="kyleComputeTitle">Kyle Work compute</strong>
          <span id="kyleComputeState" class="kyle-compute-state">Checking…</span>
        </div>
        <p id="kyleComputeMessage">Checking local AI availability…</p>
        <small id="kyleComputeMeta"></small>
      </div>
      <div class="kyle-compute-actions">
        <button id="kyleComputeRetry" type="button" class="secondary-btn">
          <i class="fas fa-rotate-right"></i>
          Retry connection
        </button>
        <button id="kyleWorkResume" type="button" class="primary-btn" hidden>
          <i class="fas fa-play"></i>
          Resume Kyle Work
        </button>
      </div>
    `;

    const first = workTab.firstElementChild;
    if (first) workTab.insertBefore(banner, first);
    else workTab.appendChild(banner);

    banner.querySelector('#kyleComputeRetry')?.addEventListener('click', () => {
      poll(true);
    });

    banner.querySelector('#kyleWorkResume')?.addEventListener('click', async () => {
      await resumeWaitingJobs();
      await poll(true);
    });

    return banner;
  }

  function ensureStatusRow() {
    const statusTab = document.querySelector('#tab-status');
    if (!statusTab) return null;

    let row = document.querySelector('#kyleComputeStatusCard');
    if (row) return row;

    row = document.createElement('section');
    row.id = 'kyleComputeStatusCard';
    row.className = 'status-section kyle-compute-status-card';
    row.innerHTML = `
      <div class="section-heading">
        <p class="section-label">Kyle Work compute</p>
        <span id="kyleComputeStatusBadge">Checking</span>
      </div>
      <div class="kyle-compute-status-grid">
        <div><span>This device</span><strong id="kyleLocalComputeStatus">Checking</strong></div>
        <div><span>Team workstation</span><strong id="kyleRemoteComputeStatus">Checking</strong></div>
        <div><span>Routing</span><strong id="kyleComputeModeStatus">Checking</strong></div>
      </div>
    `;

    statusTab.insertBefore(row, statusTab.firstChild);
    return row;
  }

  async function loadJobs() {
    try {
      const jobs = await api('/api/work/jobs');
      return Array.isArray(jobs) ? jobs : [];
    } catch (_) {
      return [];
    }
  }

  function waitingJobs(jobs) {
    return jobs.filter(job => job?.status === 'waiting_local_model');
  }

  function activeJobs(jobs) {
    return jobs.filter(job => ACTIVE_WAIT_STATES.has(job?.status));
  }

  async function resumeWaitingJobs() {
    const jobs = await loadJobs();
    const waiting = waitingJobs(jobs);

    if (!waiting.length) return;

    await Promise.allSettled(
      waiting.map(job =>
        api(`/api/work/jobs/${encodeURIComponent(job.id)}/run`, {
          method: 'POST'
        })
      )
    );

    window.dispatchEvent(new CustomEvent('mailmate:work-refresh'));
  }

  function updateStatusPage(compute) {
    ensureStatusRow();

    const local = document.querySelector('#kyleLocalComputeStatus');
    const remote = document.querySelector('#kyleRemoteComputeStatus');
    const mode = document.querySelector('#kyleComputeModeStatus');
    const badge = document.querySelector('#kyleComputeStatusBadge');

    if (local) {
      local.textContent = compute.local?.available ? 'Ready' : 'Unavailable';
      local.dataset.state = compute.local?.available ? 'ready' : 'offline';
    }

    if (remote) {
      remote.textContent = compute.remote?.available
        ? 'Connected · Private LAN'
        : compute.remote?.configured
        ? 'Waiting for hotspot'
        : 'Not configured';
      remote.dataset.state = compute.remote?.available ? 'ready' : 'offline';
    }

    if (mode) {
      mode.textContent =
        compute.mode === 'local' ? 'Local LM Studio' :
        compute.mode === 'remote_local' ? 'Team workstation' :
        'No local compute';
    }

    if (badge) {
      badge.textContent = compute.ready ? 'Ready' : 'Offline';
    }
  }

  function updateBanner(compute, jobs) {
    const banner = ensureBanner();
    if (!banner) return;

    const title = banner.querySelector('#kyleComputeTitle');
    const state = banner.querySelector('#kyleComputeState');
    const message = banner.querySelector('#kyleComputeMessage');
    const meta = banner.querySelector('#kyleComputeMeta');
    const retry = banner.querySelector('#kyleComputeRetry');
    const resume = banner.querySelector('#kyleWorkResume');

    const waiting = waitingJobs(jobs);
    const active = activeJobs(jobs);

    banner.classList.remove('is-ready', 'needs-hotspot', 'needs-config');

    if (compute.ready) {
      banner.classList.add('is-ready');
      state.textContent = compute.mode === 'remote_local'
        ? 'TEAM WORKSTATION CONNECTED'
        : 'LOCAL COMPUTE READY';

      title.textContent = compute.mode === 'remote_local'
        ? 'Kyle Work is connected'
        : 'Kyle Work compute ready';

      message.textContent = waiting.length
        ? `${waiting.length} paused Work ${waiting.length === 1 ? 'job is' : 'jobs are'} ready to resume.`
        : compute.mode === 'remote_local'
        ? 'Using the team workstation over the private hotspot.'
        : 'Using LM Studio on this device.';

      meta.textContent = compute.mode === 'remote_local'
        ? `Private LAN · zero-retention worker${compute.remote?.latency_ms != null ? ` · ${compute.remote.latency_ms} ms` : ''}`
        : `Local inference${compute.local?.latency_ms != null ? ` · ${compute.local.latency_ms} ms` : ''}`;

      retry.hidden = true;
      resume.hidden = waiting.length === 0;

      // Hide healthy banner when there is nothing waiting.
      banner.hidden = waiting.length === 0;

    } else if (compute.remote?.configured) {
      banner.hidden = false;
      banner.classList.add('needs-hotspot');

      state.textContent = 'WAITING FOR HOTSPOT';
      title.textContent = waiting.length
        ? 'Kyle Work is paused'
        : 'Connect to enable Kyle Work';

      message.textContent =
        `Connect this laptop to ${compute.connect_label || "Priyam's hotspot"}. ` +
        'Once connected, Mailmate will use the team workstation local AI automatically.';

      meta.textContent = waiting.length
        ? `${waiting.length} Work ${waiting.length === 1 ? 'job is' : 'jobs are'} waiting for local compute.`
        : 'Your Gmail still works; only autonomous Work preparation is paused.';

      retry.hidden = false;
      resume.hidden = true;

    } else {
      banner.hidden = false;
      banner.classList.add('needs-config');

      state.textContent = 'COMPUTE NOT CONFIGURED';
      title.textContent = 'Kyle Work needs team compute';
      message.textContent =
        `Connect to ${compute.connect_label || "Priyam's hotspot"} and configure MAILMATE_REMOTE_WORKER_URL on this laptop.`;
      meta.textContent = active.length
        ? `${active.length} Work job(s) cannot use a local model yet.`
        : 'Inbox and Calendar remain available.';

      retry.hidden = false;
      resume.hidden = true;
    }
  }

  async function poll(force = false) {
    if (runtime.polling && !force) return;
    runtime.polling = true;

    try {
      const [compute, jobs] = await Promise.all([
        api('/api/compute/status'),
        loadJobs()
      ]);

      updateBanner(compute, jobs);
      updateStatusPage(compute);

      // When a teammate connects to the hotspot after being offline,
      // automatically resume jobs that were explicitly waiting for a local model.
      if (
        compute.ready &&
        runtime.lastReady === false &&
        !runtime.autoRetriedForReadyCycle &&
        waitingJobs(jobs).length
      ) {
        runtime.autoRetriedForReadyCycle = true;
        await resumeWaitingJobs();
      }

      if (!compute.ready) {
        runtime.autoRetriedForReadyCycle = false;
      }

      runtime.lastReady = compute.ready;
    } catch (error) {
      const banner = ensureBanner();
      if (banner) {
        banner.hidden = false;
        banner.classList.add('needs-hotspot');
        const state = banner.querySelector('#kyleComputeState');
        const message = banner.querySelector('#kyleComputeMessage');
        if (state) state.textContent = 'CHECK FAILED';
        if (message) {
          message.textContent =
            "Connect to Priyam's hotspot, then press Retry connection.";
        }
      }
      console.warn('[Kyle Compute]', error);
    } finally {
      runtime.polling = false;
    }
  }

  function start() {
    ensureBanner();
    ensureStatusRow();
    poll(true);

    if (runtime.timer) clearInterval(runtime.timer);
    runtime.timer = setInterval(() => poll(false), POLL_MS);

    window.addEventListener('focus', () => poll(true));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poll(true);
    });

    window.addEventListener('mailmate:work-refresh', () => poll(true));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
