/**
 * kyle-drag.js
 * Magnetic corner snapping + drag for:
 *   1. The Kyle floating mount (.kyle-floating-mount) — orb + input bar
 *   2. The Kyle action panel (.kyle-action-panel) — composer / command card
 */
(function () {
  const SNAP_MARGIN = 24;        // px from viewport edge when snapped
  const SNAP_THRESHOLD = 80;     // px from corner to trigger magnetic snap
  const SPRING_DURATION = 380;   // ms for snap spring animation

  /* ── helpers ──────────────────────────────────────────────────── */
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function nearestCorner(x, y, w, h) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const corners = [
      { label: 'bl', x: SNAP_MARGIN, y: vh - h - SNAP_MARGIN },
      { label: 'br', x: vw - w - SNAP_MARGIN, y: vh - h - SNAP_MARGIN },
      { label: 'tl', x: SNAP_MARGIN, y: SNAP_MARGIN },
      { label: 'tr', x: vw - w - SNAP_MARGIN, y: SNAP_MARGIN },
    ];
    let best = corners[0], bestDist = Infinity;
    for (const c of corners) {
      const d = Math.hypot(x - (c.x + w / 2), y - (c.y + h / 2));
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return { ...best, dist: bestDist };
  }

  function springTo(el, tx, ty, callback) {
    el.style.transition = `transform ${SPRING_DURATION}ms cubic-bezier(0.22, 1.2, 0.36, 1), left ${SPRING_DURATION}ms cubic-bezier(0.22, 1.2, 0.36, 1), top ${SPRING_DURATION}ms cubic-bezier(0.22, 1.2, 0.36, 1)`;
    el.style.left = tx + 'px';
    el.style.top = ty + 'px';
    if (callback) setTimeout(callback, SPRING_DURATION);
  }

  /* ── makeDraggable ────────────────────────────────────────────── */
  function makeDraggable(el, opts = {}) {
    const {
      handle = el,
      magnetic = true,
      onSnap = null,
      initialCorner = 'br',  // bl | br | tl | tr
      zBase = 1400,
    } = opts;

    let dragging = false;
    let startPointerX = 0, startPointerY = 0;
    let startElX = 0, startElY = 0;
    let snapped = true;
    let currentCorner = initialCorner;

    // Put element in absolute positioning mode
    function getRect() { return el.getBoundingClientRect(); }

    function snapToCorner(corner, animate = true) {
      const rect = getRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let tx, ty;
      if (corner === 'bl') { tx = SNAP_MARGIN; ty = vh - rect.height - SNAP_MARGIN; }
      else if (corner === 'br') { tx = vw - rect.width - SNAP_MARGIN; ty = vh - rect.height - SNAP_MARGIN; }
      else if (corner === 'tl') { tx = SNAP_MARGIN; ty = SNAP_MARGIN; }
      else { tx = vw - rect.width - SNAP_MARGIN; ty = SNAP_MARGIN; }

      currentCorner = corner;
      snapped = true;

      // Switch from fixed right/bottom to fixed left/top positioning
      el.style.right = 'auto';
      el.style.bottom = 'auto';

      if (animate) {
        springTo(el, tx, ty, () => {
          el.style.transition = '';
          onSnap?.(corner);
        });
      } else {
        el.style.transition = 'none';
        el.style.left = tx + 'px';
        el.style.top = ty + 'px';
        requestAnimationFrame(() => { el.style.transition = ''; });
        onSnap?.(corner);
      }
    }

    // Initialize position
    requestAnimationFrame(() => {
      snapToCorner(initialCorner, false);
    });

    // Re-snap on window resize
    window.addEventListener('resize', () => {
      if (snapped) snapToCorner(currentCorner, true);
    });

    handle.style.cursor = 'grab';
    handle.addEventListener('pointerdown', startDrag);

    function startDrag(e) {
      // Don't intercept button clicks inside the handle
      if (e.target.closest('button, input, textarea, select, a')) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      dragging = true;
      snapped = false;
      const rect = getRect();

      // Convert from fixed right/bottom to fixed left/top
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.transition = 'none';
      el.style.zIndex = String(zBase + 10);

      startPointerX = e.clientX;
      startPointerY = e.clientY;
      startElX = rect.left;
      startElY = rect.top;

      handle.style.cursor = 'grabbing';
      el.setPointerCapture(e.pointerId);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', endDrag);
      el.addEventListener('pointercancel', endDrag);
    }

    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - startPointerX;
      const dy = e.clientY - startPointerY;
      const rect = getRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const nx = clamp(startElX + dx, 0, vw - rect.width);
      const ny = clamp(startElY + dy, 0, vh - rect.height);
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';

      // Magnetic pull: highlight nearest corner if close
      if (magnetic) {
        const nearest = nearestCorner(nx + rect.width / 2, ny + rect.height / 2, rect.width, rect.height);
        el.classList.toggle('kyle-drag-near-corner', nearest.dist < SNAP_THRESHOLD);
      }
    }

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = 'grab';
      el.style.zIndex = String(zBase);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);

      if (!magnetic) return;

      const rect = getRect();
      const nearest = nearestCorner(rect.left + rect.width / 2, rect.top + rect.height / 2, rect.width, rect.height);

      if (nearest.dist < SNAP_THRESHOLD) {
        // Magnetic snap
        el.classList.remove('kyle-drag-near-corner');
        // Small bounce before snapping
        el.style.transition = 'left 60ms ease-in, top 60ms ease-in';
        setTimeout(() => snapToCorner(nearest.label, true), 60);
      } else {
        snapped = false;
        el.style.transition = '';
      }
    }

    return { snapToCorner };
  }

  /* ── init (wait for DOM + Kyle to be ready) ──────────────────── */
  function init() {
    const floatingMount = document.getElementById('kyleMount');
    const actionPanel = document.querySelector('.kyle-action-panel');

    if (!floatingMount) {
      // Kyle not yet initialized — retry
      setTimeout(init, 300);
      return;
    }

    // 1. Make the entire floating mount (orb + input bar) draggable
    //    The handle is the orb button itself
    const orbHandle = floatingMount.querySelector('.kyle-orb');
    if (orbHandle && !floatingMount._dragInit) {
      floatingMount._dragInit = true;
      makeDraggable(floatingMount, {
        handle: orbHandle,
        magnetic: true,
        initialCorner: 'br',
        zBase: 1400,
      });
    }

    // 2. Make the action panel (composer) draggable
    //    The handle is the panel header
    if (actionPanel && !actionPanel._dragInit) {
      actionPanel._dragInit = true;
      // Switch from fixed right/bottom to left/top managed by drag
      actionPanel.style.right = 'auto';
      actionPanel.style.bottom = 'auto';

      const header = actionPanel.querySelector('.kyle-panel-header');
      makeDraggable(actionPanel, {
        handle: header || actionPanel,
        magnetic: true,
        initialCorner: 'br',
        zBase: 1050,
        onSnap: (corner) => {
          // When snapping to a corner, choose whether panel opens upward or downward
          const isTop = corner.startsWith('t');
          actionPanel.classList.toggle('opens-downward', isTop);
        }
      });
    }

    // 3. Handle dynamically created panels (when composer opens)
    const observer = new MutationObserver(() => {
      const panel = document.querySelector('.kyle-action-panel');
      if (panel && !panel._dragInit) init();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 600));
  } else {
    setTimeout(init, 600);
  }

  window.KyleDrag = { init, makeDraggable };
})();
