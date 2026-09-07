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

async function testEndToEndGuidedRecentEmailFlow() {
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
      offsetWidth: 76,
      offsetHeight: 76,
      getBoundingClientRect: () => ({ top: 100, left: 200, bottom: 180, right: 350, width: 150, height: 80 }),
      scrollIntoView() { this.scrolled = true; },
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

  const inboxNav = makeMockElement('navInbox', 'div');
  inboxNav.className = 'nav-item';
  inboxNav.dataset.page = 'inbox';

  const emailRow1 = makeMockElement('row1', 'div');
  emailRow1.className = 'email-item';
  emailRow1.dataset.kyleId = 'msg_old_1';

  const emailRow2 = makeMockElement('row2', 'div');
  emailRow2.className = 'email-item';
  emailRow2.dataset.kyleId = 'msg_new_2';

  const detailHeader = makeMockElement('detailHeader', 'div');
  detailHeader.className = 'email-detail-header';

  const kyleMount = makeMockElement('kyleMount', 'div');
  kyleMount.className = 'kyle-floating-mount';

  const document = {
    createElement(tag) { return makeMockElement('', tag); },
    getElementById(id) {
      if (id === 'kyleMount') return kyleMount;
      if (id === 'navInbox') return inboxNav;
      if (id === 'row1') return emailRow1;
      if (id === 'row2') return emailRow2;
      if (id === 'detailHeader') return detailHeader;
      if (!domElements.has(id)) domElements.set(id, makeMockElement(id, 'div'));
      return domElements.get(id);
    },
    querySelector(sel) {
      if (sel.includes('data-page="inbox"')) return inboxNav;
      if (sel.includes('msg_new_2')) return emailRow2;
      if (sel.includes('msg_old_1')) return emailRow1;
      if (sel === '.email-detail-header') return detailHeader;
      if (sel === '#kyleMount' || sel === '.kyle-floating-mount') return kyleMount;
      if (sel === '.email-item') return emailRow2;
      if (sel.startsWith('#')) return this.getElementById(sel.slice(1));
      return null;
    },
    querySelectorAll() { return []; },
    body: {
      appendChild(child) {
        if (child.id) domElements.set(child.id, child);
      },
      contains() { return true; }
    }
  };

  const openedPages = [];
  const openedEmails = [];
  const orbDestinations = [];
  let orbHomeCount = 0;
  const spotlightTargets = [];

  // Intentionally place older email FIRST in array, newest email SECOND with higher timestamp
  // This verifies that Kyle sorts by timestamp and does not simply pick emails[0]
  const mockEmails = [
    {
      id: 'msg_old_1',
      sender: 'Alice Senior <alice@company.com>',
      subject: 'Quarterly Review',
      internal_date: '1600000000000'
    },
    {
      id: 'msg_new_2',
      sender: 'Rupayan Chattaraj <rupayan@ciphersquad.ai>',
      subject: 'DA Submission Report',
      internal_date: '1750000000000'
    }
  ];

  const window = {
    location: { origin: 'http://localhost:5000' },
    matchMedia: () => ({ matches: false }),
    dispatchEvent: () => {},
    addEventListener: () => {},
    innerWidth: 1280,
    innerHeight: 800,
    AgentMail: {
      getEmails: () => mockEmails,
      openEmail: async email => {
        openedEmails.push(email);
      },
      refresh: async () => {}
    },
    KyleActions: {
      openPage: page => {
        openedPages.push(page);
      }
    },
    KyleSpotlight: {
      spotlight: (element, opts) => {
        spotlightTargets.push(element);
        return { clear() {} };
      },
      clear: () => {}
    },
    KyleMotion: {
      wait: async () => {},
      moveOrbTo: async target => {
        orbDestinations.push(target);
        return true;
      },
      moveOrbHome: async () => {
        orbHomeCount += 1;
        return true;
      }
    },
    speechSynthesis: {
      speak: u => { if (u.onend) setTimeout(u.onend, 0); },
      cancel: () => {},
      getVoices: () => []
    },
    SpeechSynthesisUtterance: class FakeSpeechSynthesisUtterance {
      constructor(text) { this.text = text; }
    }
  };

  const context = vm.createContext({
    window,
    document,
    CustomEvent: class {},
    console,
    setTimeout,
    clearTimeout,
    parseFloat: Number.parseFloat,
    Date,
    Number,
    SpeechSynthesisUtterance: window.SpeechSynthesisUtterance,
    fetch: async () => ({
      ok: true,
      json: async () => ({ id: 'msg_new_2', is_important: true, labels: ['STARRED', 'IMPORTANT'] })
    })
  });

  loadScript('kyle-state.js', context);
  loadScript('kyle-ui.js', context);
  loadScript('kyle-audio.js', context);
  loadScript('kyle.js', context);

  const kyle = context.window.Kyle;
  assert.ok(kyle, 'Kyle must be defined');

  // Trigger primary user journey
  await kyle.handlePrompt('show me the most recent mail');

  // 1. Assert navigation to Inbox occurred
  assert.ok(openedPages.includes('inbox'), 'Must switch to Inbox page');

  // 2. Assert physical orb travel sequence
  assert.ok(orbDestinations.length >= 3, 'Orb must travel to at least inbox tab, email row, and detail header');
  assert.strictEqual(orbDestinations[0], inboxNav, 'Orb step 1 must glide to inbox tab');
  assert.strictEqual(orbDestinations[1], emailRow2, 'Orb step 2 must glide to newest email row');
  assert.strictEqual(orbDestinations[2], detailHeader, 'Orb step 3 must glide to email detail header');

  // 3. Assert newest email by timestamp was selected (msg_new_2, NOT msg_old_1)
  assert.equal(openedEmails.length, 1, 'Must open exactly 1 email');
  assert.equal(openedEmails[0].id, 'msg_new_2', 'Must select newest email by timestamp, not array position');

  // 4. Assert spotlight highlighted the newest email row and detail header
  assert.ok(spotlightTargets.includes(emailRow2), 'Spotlight must highlight newest email row');
  assert.ok(spotlightTargets.includes(detailHeader), 'Spotlight must highlight detail header');

  // 5. Assert orb returned home to dock
  assert.ok(orbHomeCount >= 1, 'Orb must return to home dock after guidance');

  // 6. Assert state reached SUCCESS (or SPEAKING while narrating)
  assert.ok(['SUCCESS', 'SPEAKING', 'IDLE'].includes(kyle.store.current), 'Kyle state should reach SUCCESS/SPEAKING');
  assert.equal(document.getElementById('kyleCardBadge').textContent, 'SUCCESS', 'Card badge must indicate SUCCESS');

  console.log('✓ testEndToEndGuidedRecentEmailFlow passed');
}

async function testEndToEndSenderGuidance() {
  const domElements = new Map();
  function makeMockElement(id = '', tag = 'div') {
    const el = {
      id,
      tagName: tag.toUpperCase(),
      className: '',
      dataset: {},
      style: { getPropertyValue: () => '0', setProperty: () => {} },
      innerHTML: '',
      textContent: '',
      offsetWidth: 76,
      offsetHeight: 76,
      getBoundingClientRect: () => ({ top: 100, left: 200, bottom: 180, right: 350, width: 150, height: 80 }),
      scrollIntoView() { this.scrolled = true; },
      remove() {},
      getContext: () => ({
        clearRect() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {}
      }),
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); },
        toggle() {}
      },
      setAttribute() {},
      getAttribute() { return ''; },
      addEventListener() {},
      removeEventListener() {},
      querySelector(sel) {
        if (sel.startsWith('#')) return domElements.get(sel.slice(1)) || makeMockElement();
        return makeMockElement();
      },
      querySelectorAll() { return []; }
    };
    if (id) domElements.set(id, el);
    return el;
  }

  const sreyankoRow = makeMockElement('rowSreyanko', 'div');
  sreyankoRow.dataset.kyleId = 'msg_sreyanko';

  const document = {
    createElement(tag) { return makeMockElement('', tag); },
    getElementById(id) { return domElements.get(id) || makeMockElement(id); },
    querySelector(sel) {
      if (sel.includes('msg_sreyanko')) return sreyankoRow;
      if (sel === '.email-item') return sreyankoRow;
      return makeMockElement();
    },
    querySelectorAll() { return []; },
    body: { appendChild() {}, contains() { return true; } }
  };

  const openedEmails = [];
  const mockEmails = [
    {
      id: 'msg_sreyanko',
      sender: 'Sreyanko New <sreyanko@ciphersquad.ai>',
      from: { name: 'Sreyanko New', email: 'sreyanko@ciphersquad.ai' },
      subject: 'Weekly Sprint Goals',
      internal_date: '1720000000000'
    }
  ];

  const window = {
    location: { origin: 'http://localhost:5000' },
    matchMedia: () => ({ matches: false }),
    dispatchEvent: () => {},
    addEventListener: () => {},
    innerWidth: 1280,
    innerHeight: 800,
    AgentMail: {
      getEmails: () => mockEmails,
      openEmail: async email => { openedEmails.push(email); },
      refresh: async () => {}
    },
    KyleActions: { openPage: () => {} },
    KyleSpotlight: { spotlight: () => ({ clear() {} }), clear: () => {} },
    KyleMotion: {
      wait: async () => {},
      moveOrbTo: async () => true,
      moveOrbHome: async () => true
    },
    speechSynthesis: { speak: u => u.onend?.(), cancel: () => {}, getVoices: () => [] },
    SpeechSynthesisUtterance: class FakeSpeechSynthesisUtterance {
      constructor(text) { this.text = text; }
    }
  };

  const context = vm.createContext({
    window,
    document,
    CustomEvent: class {},
    console,
    setTimeout,
    clearTimeout,
    parseFloat: Number.parseFloat,
    Date,
    Number,
    SpeechSynthesisUtterance: window.SpeechSynthesisUtterance,
    fetch: async () => ({ ok: true, json: async () => ({}) })
  });

  loadScript('kyle-state.js', context);
  loadScript('kyle-ui.js', context);
  loadScript('kyle-audio.js', context);
  loadScript('kyle.js', context);

  // Test multi-word sender matching
  await context.window.Kyle.handlePrompt('show emails from Sreyanko New');
  assert.equal(openedEmails.length, 1, 'Must open matched email for multi-word sender');
  assert.equal(openedEmails[0].id, 'msg_sreyanko', 'Must open Sreyanko New email');
  assert.ok(['SUCCESS', 'SPEAKING', 'IDLE'].includes(context.window.Kyle.store.current), 'State should reach SUCCESS/SPEAKING');

  console.log('✓ testEndToEndSenderGuidance passed');
}

(async () => {
  testKyleSpotlight();
  testKyleStates();
  testKyleCommandCardAndError();
  await testEndToEndGuidedRecentEmailFlow();
  await testEndToEndSenderGuidance();
  console.log('ALL KYLE GUIDED UX TESTS PASSED!');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
