(function () {
  const states = {
    IDLE: 'IDLE',
    LISTENING: 'LISTENING',
    TRANSCRIBING: 'TRANSCRIBING',
    THINKING: 'THINKING',
    SPEAKING: 'SPEAKING',
    INTERRUPTED: 'INTERRUPTED',
    ERROR: 'ERROR',
    RESULT: 'RESULT',
    ACTING: 'ACTING',
    OBSERVING: 'OBSERVING',
    NAVIGATING: 'NAVIGATING',
    WORKING: 'WORKING',
    APPROVAL: 'APPROVAL',
    WAITING_APPROVAL: 'WAITING_APPROVAL',
    SUCCESS: 'SUCCESS',
    DONE: 'DONE'
  };

  function storageKey() {
    let userId = 'guest';
    try { userId = window.localStorage?.getItem?.('userId') || 'guest'; } catch (_) {}
    return `mailmate.kyle.conversation.v1.${String(userId).toLowerCase()}`;
  }

  function loadConversation() {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem?.(storageKey()) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(-40).filter(item =>
        ['user', 'kyle'].includes(item?.role) && typeof item?.text === 'string' && item.text.trim()
      ).map(item => ({ role: item.role, text: item.text.slice(0, 2400), at: item.at || new Date().toISOString() }));
    } catch (_) {
      return [];
    }
  }

  function saveConversation(messages) {
    try { window.localStorage?.setItem?.(storageKey(), JSON.stringify(messages.slice(-40))); } catch (_) {}
  }

  function createKyleState() {
    return {
      states,
      current: states.IDLE,
      conversation: loadConversation(),
      lastResults: [],
      selectedEmail: null,
      currentPage: 'overview',
      context: null,
      muted: false,
      set(next) {
        this.current = next;
        console.log('[Kyle Voice] state', next);
        window.dispatchEvent(new CustomEvent('kyle:state', { detail: { state: next } }));
      },
      addMessage(role, text) {
        const message = { role, text, at: new Date().toISOString() };
        this.conversation.push(message);
        if (this.conversation.length > 40) this.conversation.splice(0, this.conversation.length - 40);
        saveConversation(this.conversation);
        window.dispatchEvent(new CustomEvent('kyle:message', { detail: message }));
      }
    };
  }

  window.KyleState = { createKyleState, states };
})();
