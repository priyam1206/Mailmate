(function () {
  const REFERENCE_PATTERN = /\b(this one|that one|the selected one|the open one|this|that|it|these|those)\b/ig;

  function expectedType(prompt) {
    const text = String(prompt || '').toLowerCase();
    if (/\b(add|put|save)\s+(this|that|it)\s+(to|on)\s+(my\s+)?calendar\b/.test(text)) return 'email';
    if (/\b(reply|email|message|sender|archive|star|unread|inbox)\b/.test(text)) return 'email';
    if (/\b(calendar|event|meeting|schedule|reschedule|move|appointment)\b/.test(text)) return 'calendar-event';
    if (/\b(task|work item|action item|blocker)\b/.test(text)) return 'work-item';
    return null;
  }

  function matches(reference, type) {
    return Boolean(reference && (!type || reference.type === type));
  }

  function unique(references) {
    const seen = new Set();
    return references.filter(reference => {
      const key = `${reference?.type}:${reference?.id}`;
      if (!reference?.type || !reference?.id || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function resolvePrompt(prompt) {
    const text = String(prompt || '').trim();
    const mentions = [...text.matchAll(REFERENCE_PATTERN)].map(match => match[0].toLowerCase());
    const hasReference = mentions.length > 0;
    const type = expectedType(text);
    const context = window.MailmateContext?.snapshot?.() || {};

    if (!hasReference) {
      return { hasReference: false, references: [], unresolved: false, context };
    }

    const tiers = [
      ['selected text source', [context.selectedText ? context.selectedTextSource : null]],
      ['selected object', [context.selected]],
      ['open object', [context.open]],
      ['hovered object', [context.hovered]],
      ['focused object', [context.focused]],
      ['last clicked object', [context.lastClicked]],
      ['last manipulated object', [context.references?.lastManipulated]],
      ['recently mentioned object', [context.references?.lastMentioned, context.references?.lastOpened]],
      ['visible object', context.visibleObjects || []]
    ];

    const resolved = [];
    const bindings = {};
    const reasons = [];
    for (const mention of mentions) {
      let found = null;
      for (const [reason, references] of tiers) {
        const candidates = unique(references
          .filter(reference => matches(reference, type))
          .filter(reference => mentions.length === 1 || !resolved.some(item => item.type === reference.type && item.id === reference.id)));
        if (candidates.length === 1) {
          found = candidates[0];
          reasons.push(reason);
          break;
        }
        if (candidates.length > 1) return clarification(type, context, candidates);
      }
      if (!found) return clarification(type, context, []);
      resolved.push(found);
      bindings[mention] = found;
    }

    resolved.forEach(reference => window.MailmateContext?.remember?.('mentioned', reference));
    return {
      hasReference: true,
      references: resolved,
      bindings,
      unresolved: false,
      confidence: reasons.includes('visible object') ? 'medium' : 'high',
      reason: reasons.join(', '),
      expectedType: type,
      context
    };
  }

  function clarification(type, context, candidates) {
    const noun = type === 'calendar-event' ? 'calendar event' : type === 'email' ? 'email' : type === 'work-item' ? 'work item' : 'item';
    return {
      hasReference: true,
      references: [],
      unresolved: true,
      ambiguous: candidates.length > 1,
      expectedType: type,
      context,
      clarification: candidates.length > 1
        ? `Which ${noun} do you mean? Select or open it first.`
        : `Which ${noun} do you mean? Click it, then ask me again.`
    };
  }

  window.KyleReferents = { resolvePrompt, expectedType };
})();
