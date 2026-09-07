/**
 * Kyle fixed positioning manager.
 *
 * Kyle and the action/composer panel are intentionally NOT draggable.
 * _dragController remains only as a compatibility shim for resnap() callers.
 *
 * NO pointerdown, pointermove, pointerup, or pointer capture is installed.
 */
(function () {
  function isOverviewMount(el) {
    return !!(el && el.closest('.kyle-overview-mount'));
  }

  function clearLegacyGeometry(el) {
    if (!el) return;
    el.classList.remove('kyle-drag-near-corner', 'snapped', 'kyle-traveling');
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    el.style.transform = '';
    el.style.transition = '';
    el.style.cursor = '';
  }

  function dockMount(mount) {
    if (!mount || isOverviewMount(mount)) return;
    clearLegacyGeometry(mount);
    mount.classList.add('kyle-floating-mount');
    mount.style.visibility = 'visible';
    mount.style.opacity = '1';
    if (typeof mount.removeAttribute === 'function') mount.removeAttribute('hidden');
    else mount.hidden = false;
  }

  function dockPanel(panel) {
    if (!panel) return;
    if (window.KyleCanvas?.isInlineComposer?.(panel)) return;
    clearLegacyGeometry(panel);
    panel.style.position = 'fixed';
    panel.style.right = '24px';
    panel.style.bottom = '116px';
  }

  function controller(el, kind) {
    function resnap() {
      if (kind === 'panel') dockPanel(el);
      else dockMount(el);
    }

    return {
      snapToCorner: resnap,
      resnap,
      getCorner: function () { return 'br'; }
    };
  }

  function makeDraggable(el, opts) {
    const kind = opts?.kind || (el?.classList?.contains('kyle-action-panel') ? 'panel' : 'mount');
    const ctl = controller(el, kind);
    ctl.resnap();
    return ctl;
  }

  function init() {
    const mount = document.getElementById('kyleMount');
    if (mount) {
      mount._dragController = mount._dragController || controller(mount, 'mount');
      mount._dragInit = true;
      dockMount(mount);
    }

    const panel = document.querySelector('.kyle-action-panel');
    if (panel) {
      panel._dragController = panel._dragController || controller(panel, 'panel');
      panel._dragInit = true;
      dockPanel(panel);
    }

    if (!window._kyleFixedDockLayoutBound) {
      window._kyleFixedDockLayoutBound = true;
      window.addEventListener('kyle:layout-changed', function () {
        requestAnimationFrame(function () {
          dockMount(document.getElementById('kyleMount'));
          dockPanel(document.querySelector('.kyle-action-panel.is-open'));
        });
      });
    }

    if (!window._kyleFixedDockObserver) {
      window._kyleFixedDockObserver = new MutationObserver(function () {
        dockMount(document.getElementById('kyleMount'));
        dockPanel(document.querySelector('.kyle-action-panel.is-open'));
      });

      window._kyleFixedDockObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 200); });
  } else {
    setTimeout(init, 200);
  }

  window.KyleDrag = { init, makeDraggable, dockMount, dockPanel };
})();
