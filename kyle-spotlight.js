(function () {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let activeSpotlightEl = null;
  let clearTimer = null;
  let overlayEl = null;

  function ensureOverlay() {
    if (overlayEl && document.body?.contains?.(overlayEl)) return overlayEl;
    overlayEl = document.getElementById ? document.getElementById('kyleSpotlightOverlay') : null;
    if (!overlayEl && document.createElement && document.body?.appendChild) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'kyleSpotlightOverlay';
      overlayEl.className = 'kyle-spotlight-overlay';
      overlayEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(overlayEl);
    }
    return overlayEl;
  }

  function resolveElement(target) {
    if (!target) return null;
    if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) return target;
    if (target && target.classList && (typeof target.getBoundingClientRect === 'function' || target.nodeType)) return target;
    if (typeof target === 'string' && document.querySelector) {
      return document.querySelector(target);
    }
    if (typeof target === 'object' && target.type && target.id) {
      if (window.MailmateObjects?.getElement) {
        const el = window.MailmateObjects.getElement(target);
        if (el) return el;
      }
      if (document.querySelector) {
        return document.querySelector(`[data-kyle-type="${target.type}"][data-kyle-id="${target.id}"]`);
      }
    }
    return null;
  }

  function spotlight(target, options = {}) {
    if (typeof document === 'undefined') return false;
    const el = resolveElement(target);
    clearTimeout(clearTimer);

    if (!el) {
      console.warn('[Kyle Spotlight] Target element could not be resolved:', target);
      return false;
    }

    if (activeSpotlightEl && activeSpotlightEl !== el) {
      activeSpotlightEl.classList.remove('kyle-spotlight-active', 'kyle-spotlight-pulse');
    }

    const overlay = ensureOverlay();
    if (options.dim !== false && overlay) {
      overlay.classList.add('is-visible');
    }

    if (options.scroll !== false && typeof el.scrollIntoView === 'function') {
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const winHeight = window.innerHeight || document.documentElement?.clientHeight || 800;
      const winWidth = window.innerWidth || document.documentElement?.clientWidth || 1200;
      const inView = rect ? (
        rect.top >= 60 &&
        rect.left >= 0 &&
        rect.bottom <= winHeight - 60 &&
        rect.right <= winWidth
      ) : false;
      if (!inView) {
        el.scrollIntoView({
          behavior: reducedMotion?.matches ? 'auto' : 'smooth',
          block: options.scrollBlock || 'center',
          inline: 'nearest'
        });
      }
    }

    activeSpotlightEl = el;
    el.classList.remove('kyle-spotlight-active', 'kyle-spotlight-pulse');
    if (typeof el.offsetWidth === 'number') void el.offsetWidth;
    el.classList.add('kyle-spotlight-active');
    if (options.pulse !== false) {
      el.classList.add('kyle-spotlight-pulse');
    }

    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('kyle:spotlight-start', {
        detail: { target: el, options }
      }));
    }

    const duration = options.duration !== undefined ? options.duration : 4000;
    if (duration > 0) {
      clearTimer = setTimeout(() => {
        clear();
      }, duration);
    }

    return {
      element: el,
      clear: () => clear()
    };
  }

  function clear() {
    clearTimeout(clearTimer);
    if (activeSpotlightEl) {
      activeSpotlightEl.classList.remove('kyle-spotlight-active', 'kyle-spotlight-pulse');
      activeSpotlightEl = null;
    }
    if (overlayEl) {
      overlayEl.classList.remove('is-visible');
    }
    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('kyle:spotlight-clear'));
    }
  }

  async function sequence(steps = []) {
    for (const step of steps) {
      if (!step) continue;
      const target = step.target || step.element || step;
      const opts = step.options || (step.target ? step : {});
      spotlight(target, { ...opts, duration: step.duration || 2200 });
      const delay = step.delay || step.duration || 2200;
      await new Promise(r => setTimeout(r, delay));
    }
    clear();
  }

  window.KyleSpotlight = {
    spotlight,
    clear,
    sequence,
    resolveElement,
    isActive: () => Boolean(activeSpotlightEl)
  };
})();
