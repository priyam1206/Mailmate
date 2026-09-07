/**
 * kyle-drag.js
 * Magnetic corner drag for FLOATING elements only.
 * The Overview page embedded prompt bar is intentionally excluded -- it stays static.
 * Only:
 *   1. #kyleMount when it is NOT inside .kyle-overview-mount
 *   2. .kyle-action-panel (composer/command card)
 * are made draggable.
 */
(function () {
  const SNAP_MARGIN = 24;
  const SNAP_THRESHOLD = 80;
  const SPRING_DURATION = 380;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function isInOverviewMount(el) {
    return !!(el && el.closest('.kyle-overview-mount'));
  }

  function nearestCorner(x, y, w, h) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const corners = [
      { label: 'bl', x: SNAP_MARGIN,              y: vh - h - SNAP_MARGIN },
      { label: 'br', x: vw - w - SNAP_MARGIN,     y: vh - h - SNAP_MARGIN },
      { label: 'tl', x: SNAP_MARGIN,              y: SNAP_MARGIN },
      { label: 'tr', x: vw - w - SNAP_MARGIN,     y: SNAP_MARGIN },
    ];
    let best = corners[0], bestDist = Infinity;
    for (const c of corners) {
      const d = Math.hypot(x - (c.x + w / 2), y - (c.y + h / 2));
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return { ...best, dist: bestDist };
  }

  function springTo(el, tx, ty, cb) {
    el.style.transition = 'left ' + SPRING_DURATION + 'ms cubic-bezier(0.22,1.2,0.36,1), top ' + SPRING_DURATION + 'ms cubic-bezier(0.22,1.2,0.36,1)';
    el.style.left = tx + 'px';
    el.style.top  = ty + 'px';
    if (cb) setTimeout(cb, SPRING_DURATION);
  }

  function makeDraggable(el, opts) {
    opts = opts || {};
    var handle        = opts.handle || el;
    var magnetic      = opts.magnetic !== false;
    var onSnap        = opts.onSnap || null;
    var initialCorner = opts.initialCorner || 'br';
    var zBase         = opts.zBase || 1400;
    var bottomOffset  = Number(opts.bottomOffset || 0);

    var dragging = false;
    var startPX = 0, startPY = 0, startEX = 0, startEY = 0;
    var snapped = true;
    var currentCorner = initialCorner;

    function getRect() { return el.getBoundingClientRect(); }

    function snapToCorner(corner, animate) {
      var rect = getRect();
      var vw = window.innerWidth, vh = window.innerHeight;
      var tx, ty;
      if      (corner === 'bl') { tx = SNAP_MARGIN;             ty = vh - rect.height - SNAP_MARGIN - bottomOffset; }
      else if (corner === 'br') { tx = vw - rect.width - SNAP_MARGIN; ty = vh - rect.height - SNAP_MARGIN - bottomOffset; }
      else if (corner === 'tl') { tx = SNAP_MARGIN;             ty = SNAP_MARGIN; }
      else                      { tx = vw - rect.width - SNAP_MARGIN; ty = SNAP_MARGIN; }

      tx = clamp(tx, 8, Math.max(8, vw - rect.width - 8));
      ty = clamp(ty, 8, Math.max(8, vh - rect.height - 8));

      currentCorner = corner;
      snapped = true;
      el.style.transform = '';
      el.classList.remove('kyle-traveling');
      el.style.right  = 'auto';
      el.style.bottom = 'auto';

      if (animate) {
        springTo(el, tx, ty, function () {
          el.style.transition = '';
          el.classList.add('snapped');
          setTimeout(function () { el.classList.remove('snapped'); }, 420);
          if (onSnap) onSnap(corner);
        });
      } else {
        el.style.transition = 'none';
        el.style.left = tx + 'px';
        el.style.top  = ty + 'px';
        requestAnimationFrame(function () { el.style.transition = ''; });
        if (onSnap) onSnap(corner);
      }
    }

    requestAnimationFrame(function () { snapToCorner(initialCorner, false); });
    window.addEventListener('resize', function () { if (snapped) snapToCorner(currentCorner, false); });

    handle.style.cursor = 'grab';
    handle.addEventListener('pointerdown', startDrag);

    function startDrag(e) {
      if (e.target.closest('button, input, textarea, select, a, [role="button"]')) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      dragging = true;
      snapped  = false;
      var rect = getRect();
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
      el.style.left   = rect.left + 'px';
      el.style.top    = rect.top  + 'px';
      el.style.transition = 'none';
      el.style.zIndex = String(zBase + 10);
      startPX = e.clientX; startPY = e.clientY;
      startEX = rect.left; startEY = rect.top;
      handle.style.cursor = 'grabbing';
      el.setPointerCapture(e.pointerId);
      el.addEventListener('pointermove',   onMove);
      el.addEventListener('pointerup',     endDrag);
      el.addEventListener('pointercancel', endDrag);
    }

    function onMove(e) {
      if (!dragging) return;
      var dx = e.clientX - startPX, dy = e.clientY - startPY;
      var rect = getRect();
      var vw = window.innerWidth, vh = window.innerHeight;
      var nx = clamp(startEX + dx, 0, vw - rect.width);
      var ny = clamp(startEY + dy, 0, vh - rect.height);
      el.style.left = nx + 'px';
      el.style.top  = ny + 'px';
      if (magnetic) {
        var nearest = nearestCorner(nx + rect.width / 2, ny + rect.height / 2, rect.width, rect.height);
        el.classList.toggle('kyle-drag-near-corner', nearest.dist < SNAP_THRESHOLD);
      }
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = 'grab';
      el.style.zIndex = String(zBase);
      el.removeEventListener('pointermove',   onMove);
      el.removeEventListener('pointerup',     endDrag);
      el.removeEventListener('pointercancel', endDrag);
      el.classList.remove('kyle-drag-near-corner');
      if (!magnetic) { snapped = false; el.style.transition = ''; return; }
      var rect    = getRect();
      var nearest = nearestCorner(rect.left + rect.width / 2, rect.top + rect.height / 2, rect.width, rect.height);
      if (nearest.dist < SNAP_THRESHOLD) {
        el.style.transition = 'left 60ms ease-in, top 60ms ease-in';
        setTimeout(function () { snapToCorner(nearest.label, true); }, 60);
      } else {
        snapped = false;
        el.style.transition = '';
      }
    }

    return {
      snapToCorner: snapToCorner,
      resnap: function (animate) { snapToCorner(currentCorner, animate !== false); },
      getCorner: function () { return currentCorner; }
    };
  }

  /* â”€â”€ init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  function init() {
    var floatingMount = document.getElementById('kyleMount');
    if (!floatingMount) { setTimeout(init, 300); return; }

    // 1. Floating orb: SKIP if it is currently embedded in the Overview bar
    if (!isInOverviewMount(floatingMount) && !floatingMount._dragInit) {
      floatingMount._dragInit = true;
      var orbHandle = floatingMount.querySelector('.kyle-orb');
      if (orbHandle) {
        floatingMount._dragController = makeDraggable(floatingMount, {
          handle: orbHandle, magnetic: true, initialCorner: 'br', zBase: 1400,
        });
      }
    }

    // 2. Action panel (composer/command card) -- always position:fixed, always draggable
    var actionPanel = document.querySelector('.kyle-action-panel');
    if (actionPanel && !actionPanel._dragInit) {
      actionPanel._dragInit = true;
      actionPanel.style.right  = 'auto';
      actionPanel.style.bottom = 'auto';
      var header = actionPanel.querySelector('.kyle-panel-header');
      actionPanel._dragController = makeDraggable(actionPanel, {
        handle: header || actionPanel, magnetic: true, initialCorner: 'br', zBase: 1450,
        bottomOffset: 96,
        onSnap: function (corner) {
          actionPanel.classList.toggle('opens-downward', corner.charAt(0) === 't');
        },
      });
    }


    // Re-anchor floating surfaces after transcript/composer size changes.
    if (!window._kyleLayoutResnapBound) {
      window._kyleLayoutResnapBound = true;
      window.addEventListener('kyle:layout-changed', function () {
        requestAnimationFrame(function () {
          var mount = document.getElementById('kyleMount');
          if (mount && !isInOverviewMount(mount) && mount._dragController) {
            mount.style.transform = '';
            mount.classList.remove('kyle-traveling');
            mount._dragController.resnap(false);
          }

          var panel = document.querySelector('.kyle-action-panel.is-open');
          if (panel && panel._dragController) {
            panel._dragController.resnap(false);
          }
        });
      });
    }
    // 3. Watch for Overview -> floating transition and new panels
    var observer = new MutationObserver(function () {
      var mount = document.getElementById('kyleMount');
      if (mount && !mount._dragInit && !isInOverviewMount(mount)) init();
      var panel = document.querySelector('.kyle-action-panel');
      if (panel && !panel._dragInit) init();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 600); });
  } else {
    setTimeout(init, 600);
  }

  window.KyleDrag = { init: init, makeDraggable: makeDraggable };
})();

