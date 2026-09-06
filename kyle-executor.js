(function () {
  const transactions = [];
  let pendingApproval = null;

  function setState(name) {
    const state = window.Kyle?.store;
    if (state?.states?.[name]) state.set(state.states[name]);
  }

  async function executePlan(plan) {
    const transaction = {
      id: plan.id,
      goal: plan.goal,
      status: 'running',
      steps: [],
      changedObjects: [],
      undo: [],
      startedAt: new Date().toISOString()
    };
    transactions.push(transaction);
    if (transactions.length > 20) transactions.shift();
    setState('ACTING');

    for (const action of plan.steps || []) {
      const policy = window.KylePolicy?.evaluate(action) || { allowed: false, reason: 'Policy unavailable.' };
      if (!policy.allowed) {
        transaction.steps.push({ action, status: policy.approvalRequired ? 'waiting-approval' : 'blocked', policy });
        transaction.status = policy.approvalRequired ? 'waiting-approval' : 'blocked';
        if (policy.approvalRequired) setState('WAITING_APPROVAL');
        window.KyleMotion?.caption(policy.reason, { transient: true });
        break;
      }

      const step = { action, status: 'running', startedAt: new Date().toISOString() };
      transaction.steps.push(step);
      window.dispatchEvent(new CustomEvent('kyle:action-start', { detail: { transaction, action } }));

      try {
        await window.KyleMotion?.before(action);
        const before = window.KyleObservation?.capture(action);
        const result = await window.KyleTools.run(action.tool, action.args || {}, transaction);
        setState('OBSERVING');
        const observation = await window.KyleObservation?.after(action, before, result);
        await window.KyleMotion?.after(action, result, observation);
        step.status = observation?.satisfied === false ? 'unverified' : 'complete';
        step.result = result;
        step.observation = observation;
        if (typeof result?.undo === 'function') transaction.undo.push(result.undo);
        if (action.args?.reference && result !== false) transaction.changedObjects.push(action.args.reference);
        window.dispatchEvent(new CustomEvent('kyle:action-complete', { detail: { transaction, action, result, observation } }));
        if (result?.requiresApproval && result?.previewId) {
          const commitTool = action.tool === 'calendar.preview_move' ? 'calendar.commit_move'
            : action.tool === 'calendar.preview_create' ? 'calendar.commit_create'
              : null;
          if (commitTool) {
            pendingApproval = {
              transaction,
              action: { tool: commitTool, args: { previewId: result.previewId, approved: true } }
            };
            transaction.status = 'waiting-approval';
            transaction.pendingApproval = { tool: commitTool, previewId: result.previewId };
            setState('WAITING_APPROVAL');
            window.KyleMotion?.caption('Preview ready. Say confirm to save it.', { transient: true });
            break;
          }
        }
      } catch (error) {
        step.status = 'failed';
        step.error = error.message;
        transaction.status = 'failed';
        window.dispatchEvent(new CustomEvent('kyle:action-complete', { detail: { transaction, action, error: error.message } }));
        break;
      }
      setState('ACTING');
    }

    if (transaction.status === 'running') transaction.status = 'complete';
    transaction.completedAt = new Date().toISOString();
    if (transaction.status === 'complete') setState('DONE');
    return transaction;
  }

  function execute(plan) {
    return window.KyleMotion?.queue
      ? window.KyleMotion.queue([() => executePlan(plan)])
      : executePlan(plan);
  }

  async function undoLast() {
    const transaction = [...transactions].reverse().find(item => item.status === 'complete' && item.undo.length);
    if (!transaction) return { ok: false, message: 'There is nothing I can safely undo yet.' };
    setState('ACTING');
    window.KyleMotion?.caption('Putting that back...');
    for (const undo of [...transaction.undo].reverse()) await undo();
    transaction.status = 'undone';
    setState('DONE');
    return { ok: true, message: 'Done. I put it back.' };
  }

  async function approvePending() {
    if (!pendingApproval) return { ok: false, message: 'There is no preview waiting for approval.' };
    const pending = pendingApproval;
    pendingApproval = null;
    pending.transaction.status = 'preview-approved';
    const transaction = await execute({
      id: `run_${Date.now().toString(36)}_approval`,
      goal: `Approve ${pending.action.tool}`,
      steps: [pending.action]
    });
    return transaction.status === 'complete'
      ? { ok: true, message: 'Done. I saved the change.' }
      : { ok: false, message: 'I could not save that change.' };
  }

  function cancelPending() {
    if (!pendingApproval) return { ok: false, message: 'There is no preview to cancel.' };
    const previewId = pendingApproval.action.args.previewId;
    window.KyleTools?.previews?.delete(previewId);
    document.querySelector(`[data-kyle-preview-id="${previewId}"]`)?.remove();
    pendingApproval.transaction.status = 'cancelled';
    pendingApproval = null;
    setState('DONE');
    return { ok: true, message: 'Cancelled. I did not change your calendar.' };
  }

  window.KyleExecutor = {
    execute,
    undoLast,
    approvePending,
    cancelPending,
    transactions,
    latest: () => transactions.at(-1) || null,
    pending: () => pendingApproval
  };
})();
