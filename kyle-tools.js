(function () {
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
        const email = Number.isFinite(index) ? results[index - 1] : results.find(item => item.id === indexOrId);
        if (!email) return false;
        window.Kyle.store.selectedEmail = email;
        window.dispatchEvent(new CustomEvent('harness:open-email', { detail: email }));
        this.openPage('inbox');
        return true;
      }
    };
  }

  window.KyleActions = createKyleActions();
})();
