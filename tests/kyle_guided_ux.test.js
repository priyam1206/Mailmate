const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScript(name, context) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), context, { filename: name });
}

function testKyleSpotlight() {
  const elements = new Map();
  const document = {
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        id: '',
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); el.className = [...this.classes].join(' '); },
          remove(c) { this.classes.delete(c); el.className = [...this.classes].join(' '); },
          contains(c) { return this.classes.has(c); }
        },
        setAttribute(k, v) { this[k] = v; },
        getBoundingClientRect: () => ({ top: 100, left: 50, bottom: 200, right: 300 }),
        scrollIntoView() { el.scrolled = true; }
      };
      return el;
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector(selector) {
      if (selector === '#targetRow') return elements.get('targetRow');
      return null;
    },
    body: {
      appendChild(child) {
        if (child.id) elements.set(child.id, child);
      },
      contains(child) {
        return Boolean(child && elements.has(child.id));
      }
    }
  };

  const targetRow = document.createElement('div');
  targetRow.id = 'targetRow';
  elements.set('targetRow', targetRow);

  const context = vm.createContext({
    window: { matchMedia: () => ({ matches: false }), dispatchEvent: () => {} },
    document,
    CustomEvent: class {},
    setTimeout,
    clearTimeout,
    console
  });

  loadScript('kyle-spotlight.js', context);
  const { KyleSpotlight } = context.window;
  assert.ok(KyleSpotlight, 'KyleSpotlight should be defined on window');

  // Spotlight target
  const handle = KyleSpotlight.spotlight(targetRow, { duration: 0 });
  assert.ok(handle, 'handle should be returned');
  assert.ok(targetRow.classList.contains('kyle-spotlight-active'), 'target should have kyle-spotlight-active');
  assert.ok(targetRow.classList.contains('kyle-spotlight-pulse'), 'target should have kyle-spotlight-pulse');

  const overlay = document.getElementById('kyleSpotlightOverlay');
  assert.ok(overlay, 'overlay should have been created in body');
  assert.ok(overlay.classList.contains('is-visible'), 'overlay should be visible');

  // Clear spotlight
  KyleSpotlight.clear();
  assert.ok(!targetRow.classList.contains('kyle-spotlight-active'), 'target should no longer have active spotlight');
  assert.ok(!overlay.classList.contains('is-visible'), 'overlay should no longer be visible');

  console.log('✓ testKyleSpotlight passed');
}

function testKyleStates() {
  const context = vm.createContext({
    window: {},
    console
  });
  loadScript('kyle-state.js', context);
  const { states } = context.window.KyleState;
  const required = [
    'IDLE', 'LISTENING', 'THINKING', 'NAVIGATING',
    'WORKING', 'WAITING_APPROVAL', 'SUCCESS', 'ERROR'
  ];
  for (const st of required) {
    assert.ok(states[st], `State ${st} must be defined`);
  }
  console.log('✓ testKyleStates passed');
}

function testKyleCommandCardAndError() {
  const domElements = new Map();
  function makeMockElement(id = '', tag = 'div') {
    const el = {
      id,
      tagName: tag.toUpperCase(),
      className: '',
      dataset: {},
      style: {
        getPropertyValue: () => '0',
        setProperty: () => {}
      },
      innerHTML: '',
      textContent: '',
      width: 192,
      height: 192,
      getContext: () => ({
        clearRect() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {}
      }),
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); el.className = [...this.classes].join(' '); },
        remove(c) { this.classes.delete(c); el.className = [...this.classes].join(' '); },
        contains(c) { return this.classes.has(c); },
        toggle(c, force) {
          if (force !== undefined) {
            if (force) this.add(c); else this.remove(c);
          } else {
            if (this.contains(c)) this.remove(c); else this.add(c);
          }
        }
      },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k]; },
      addEventListener() {},
      removeEventListener() {},
      querySelector(sel) {
        if (sel.startsWith('#')) {
          const key = sel.slice(1);
          if (!domElements.has(key)) domElements.set(key, makeMockElement(key, 'div'));
          return domElements.get(key);
        }
        if (sel === '.orb-canvas') return makeMockElement('', 'canvas');
        return makeMockElement('', 'div');
      },
      querySelectorAll() { return []; },
      remove() {}
    };
    if (id) domElements.set(id, el);
    return el;
  }

  const document = {
    createElement(tag) { return makeMockElement('', tag); },
    getElementById(id) {
      if (!domElements.has(id)) domElements.set(id, makeMockElement(id, 'div'));
      return domElements.get(id);
    },
    querySelector(sel) {
      if (sel.startsWith('#')) {
        const key = sel.slice(1);
        if (!domElements.has(key)) domElements.set(key, makeMockElement(key, 'div'));
        return domElements.get(key);
      }
      if (sel === '.orb-canvas') return makeMockElement('', 'canvas');
      return null;
    },
    querySelectorAll() { return []; },
    body: {
      appendChild(child) { if (child.id) domElements.set(child.id, child); },
      contains() { return true; }
    }
  };

  const context = vm.createContext({
    window: {
      KyleUi: {},
      dispatchEvent() {},
      addEventListener() {}
    },
    document,
    CustomEvent: class {},
    console,
    setTimeout,
    clearTimeout,
    parseFloat: Number.parseFloat
  });

  loadScript('kyle-state.js', context);
  const store = context.window.KyleState.createKyleState();

  // Create UI
  loadScript('kyle-ui.js', context);
  const ui = context.window.KyleUi.createKyleUi(store);

  assert.ok(typeof ui.showCommandCard === 'function', 'showCommandCard must be exposed');
  assert.ok(typeof ui.updateCommandStep === 'function', 'updateCommandStep must be exposed');
  assert.ok(typeof ui.showErrorRecovery === 'function', 'showErrorRecovery must be exposed');

  // Verify showCommandCard
  ui.showCommandCard({
    title: 'Most recent mail',
    subtitle: 'From: Sreyanko · Urgent',
    badge: 'SUCCESS',
    steps: [
      { id: 'step1', label: 'Switched to Inbox', status: 'done' },
      { id: 'step2', label: 'Opened thread', status: 'done' }
    ],
    actions: [
      { label: 'Summarize', primary: true }
    ]
  });

  const panel = document.getElementById('kyleActionPanel');
  assert.ok(panel.classList.contains('is-open'), 'Panel must be open');
  assert.equal(document.getElementById('kylePanelTitle').textContent, 'Most recent mail');

  // Verify showErrorRecovery
  ui.showErrorRecovery({
    title: 'Server connection took too long',
    reason: 'Could not connect to AI backend.',
    actions: [{ label: 'Retry now', primary: true }]
  });
  assert.equal(document.getElementById('kyleErrorTitle').textContent, 'Server connection took too long');
  assert.equal(document.getElementById('kyleErrorReason').textContent, 'Could not connect to AI backend.');

  console.log('✓ testKyleCommandCardAndError passed');
}

(async () => {
  testKyleSpotlight();
  testKyleStates();
  testKyleCommandCardAndError();
  console.log('ALL KYLE GUIDED UX TESTS PASSED!');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
