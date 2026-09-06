(function () {
  const API_BASE = window.location.origin;

  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request returned ${response.status}`);
    return data;
  }

  const PAGES = new Set(['overview', 'inbox', 'work', 'calendar', 'automations', 'status', 'integrations', 'settings']);
  const INBOX_FILTERS = new Set(['all', 'important', 'action', 'unread']);

  function exactReference(args = {}) {
    const reference = args.reference || args;
    if (!reference?.type || !reference?.id) throw new Error('Kyle tool requires an exact object reference');
    return { type: String(reference.type), id: String(reference.id) };
  }

  function findEmail(id) {
    const emails = window.Kyle?.store?.context?.emails || [];
    return emails.find(email => String(email.id || email.gmail_id || email.threadId || email.subject) === String(id));
  }

  function createKyleActions() {
    return {
      openPage(page) {
        if (!PAGES.has(page)) return false;
        console.log('[Harness] navigation action', page);
        document.querySelector(`.nav-tab[data-tab="${page}"]`)?.click();
        return true;
      },

      showEmailResults(results) {
        console.log('[Harness] tool result gmail.search');
        window.Kyle.store.lastResults = results || [];
        this.openPage('inbox');
      },

      openEmail(indexOrId) {
        const results = window.Kyle.store.lastResults || [];
        const index = Number(indexOrId);
        const email = Number.isFinite(index)
          ? results[index - 1]
          : results.find(item => item.id === indexOrId);
        const exact = email || findEmail(indexOrId);
        if (!exact) return false;
        window.Kyle.store.selectedEmail = exact;
        window.dispatchEvent(new CustomEvent('harness:open-email', { detail: exact }));
        this.openPage('inbox');
        return true;
      },

      navigation: {
        openCalendar() {
          document.querySelector('.nav-tab[data-tab="calendar"]')?.click();
          return true;
        }
      },

      calendar: {
        async listEvents({ start, end, limit = 100 } = {}) {
          const url = new URL(`${API_BASE}/api/calendar/events`);
          if (start) url.searchParams.set('start', start);
          if (end) url.searchParams.set('end', end);
          url.searchParams.set('limit', String(limit));
          return readJson(await fetch(url));
        },

        async createEvent(payload) {
          const event = await readJson(await fetch(`${API_BASE}/api/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }));
          window.dispatchEvent(new CustomEvent('harness:calendar-refresh'));
          return event;
        },

        async updateEvent(eventId, payload) {
          if (!eventId) throw new Error('No calendar event selected');
          const event = await readJson(await fetch(`${API_BASE}/api/calendar/events/${encodeURIComponent(eventId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }));
          window.dispatchEvent(new CustomEvent('harness:calendar-refresh'));
          return event;
        },

        async deleteEvent(eventId) {
          if (!eventId) throw new Error('No calendar event selected');
          const result = await readJson(await fetch(`${API_BASE}/api/calendar/events/${encodeURIComponent(eventId)}`, {
            method: 'DELETE'
          }));
          window.dispatchEvent(new CustomEvent('harness:calendar-refresh'));
          return result;
        }
      }
    };
  }

  const actions = createKyleActions();
  // Stable tool names for Kyle/agent integrations.
  actions.calendar.list_events = actions.calendar.listEvents;
  actions.calendar.create_event = actions.calendar.createEvent;
  actions.calendar.update_event = actions.calendar.updateEvent;
  actions.calendar.delete_event = actions.calendar.deleteEvent;
  actions.navigation.open_calendar = actions.navigation.openCalendar;

  const semanticTools = {
    'navigation.open': async args => actions.openPage(String(args?.page || '')),
    'inbox.set_filter': async args => {
      const filter = String(args?.filter || '');
      if (!INBOX_FILTERS.has(filter)) throw new Error('Unknown inbox filter');
      actions.openPage('inbox');
      document.querySelector(`.filter-tab[data-filter="${filter}"]`)?.click();
      return true;
    },
    'inbox.open_email': async args => {
      const reference = exactReference(args);
      if (reference.type !== 'email') throw new Error('Expected an email reference');
      return actions.openEmail(reference.id);
    },
    'calendar.open_event': async args => {
      const reference = exactReference(args);
      if (reference.type !== 'calendar-event') throw new Error('Expected a calendar event reference');
      actions.openPage('calendar');
      await new Promise(resolve => setTimeout(resolve, 80));
      const element = window.MailmateObjects?.getElement(reference);
      if (!element) throw new Error('That calendar event is not visible in this week');
      element.click();
      return true;
    },
    'work.focus': async args => {
      const reference = exactReference(args);
      actions.openPage('work');
      await new Promise(resolve => setTimeout(resolve, 60));
      const element = window.MailmateObjects?.getElement(reference);
      if (!element) throw new Error('That work item is not currently available');
      element.click();
      return true;
    },
    'ui.highlight': async args => {
      const reference = exactReference(args);
      const element = window.MailmateObjects?.getElement(reference);
      if (!element) return false;
      element.classList.remove('kyle-focus');
      void element.offsetWidth;
      element.classList.add('kyle-focus');
      setTimeout(() => element.classList.remove('kyle-focus'), 2600);
      return true;
    },
    'ui.scroll_to': async args => {
      const reference = exactReference(args);
      const element = window.MailmateObjects?.getElement(reference);
      if (!element) return false;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    },
    'ui.toast': async args => {
      const message = String(args?.message || '').trim().slice(0, 180);
      if (!message) return false;
      let toast = document.getElementById('kyleToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'kyleToast';
        toast.className = 'kyle-toast';
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.classList.add('is-visible');
      clearTimeout(toast.hideTimer);
      toast.hideTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
      return true;
    }
  };

  async function execute(requestedActions = []) {
    const results = [];
    for (const action of requestedActions.slice(0, 5)) {
      const tool = semanticTools[action?.tool];
      if (!tool) {
        results.push({ tool: action?.tool || '', ok: false, error: 'Tool is not allowed' });
        continue;
      }
      try {
        const result = await tool(action.args || {});
        const reference = action.args?.reference;
        if (reference && result !== false) window.MailmateContext?.remember?.('manipulated', reference);
        results.push({ tool: action.tool, ok: result !== false });
      } catch (error) {
        results.push({ tool: action.tool, ok: false, error: error.message });
      }
    }
    return results;
  }

  window.KyleActions = actions;
  window.KyleTools = { execute, names: Object.freeze(Object.keys(semanticTools)) };
})();
