(function () {
  const API_BASE = window.location.origin;

  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request returned ${response.status}`);
    return data;
  }

  function createKyleActions() {
    return {
      openPage(page) {
        console.log('[Harness] navigation action', page);
        document.querySelector(`.nav-tab[data-tab="${page}"]`)?.click();
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
        if (!email) return false;
        window.Kyle.store.selectedEmail = email;
        window.dispatchEvent(new CustomEvent('harness:open-email', { detail: email }));
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
  window.KyleActions = actions;
})();
