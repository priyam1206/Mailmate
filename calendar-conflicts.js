(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CalendarConflicts = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DERIVED_SOURCES = new Set(['ai', 'deadline', 'email', 'attention', 'work', 'virtual']);

  function parseDate(value) {
    if (!value || String(value).length <= 10) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function interval(event) {
    const start = parseDate(event?.start);
    const end = parseDate(event?.end);
    return start && end && start < end ? { start, end } : null;
  }

  function marker(event) {
    const harness = event?.agent_harness || {};
    return String(event?.marker || event?.source_message_id || harness.agent_harness_marker || harness.source_message_id || '').trim();
  }

  function normalizedTitle(event) {
    return String(event?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function sourceOf(event) {
    return String(event?.source || 'google').trim().toLowerCase();
  }

  function isDeadlineMarker(event) {
    const deadlineWording = /\b(deadline|due|submit|submission|registration closes?)\b/.test(normalizedTitle(event));
    const invitedOthers = (event?.attendees || []).some(attendee => !attendee?.self);
    const attendanceSignal = Boolean(event?.location || invitedOthers || event?.hangout_link);
    return deadlineWording && !attendanceSignal;
  }

  function isBlocking(event) {
    const source = sourceOf(event);

    // Derived deadlines and plain deadline markers do not occupy time. A
    // location, attendee, or meeting link makes it an attendance commitment.
    if (DERIVED_SOURCES.has(source)) return false;
    if (source !== 'google' || event?.all_day || !interval(event) || isDeadlineMarker(event)) return false;
    if (event?.status === 'cancelled' || event?.cancelled === true || event?.transparency === 'transparent') return false;
    if (event?.blocking === false) return false;
    return true;
  }

  function isDuplicate(first, second) {
    const firstMarker = marker(first);
    const secondMarker = marker(second);
    if (firstMarker && secondMarker && firstMarker === secondMarker) return true;

    const firstId = String(first?.id || '');
    const secondId = String(second?.id || '');
    if (firstId && secondId && firstId === secondId) return true;

    // Two distinct Google event IDs are authoritative identities. Do not
    // collapse separate meetings merely because their titles/times match.
    // Fuzzy title/time matching remains available for Google <-> MailMate
    // derived representations when a shared marker is unavailable.
    if (firstId && secondId && firstId !== secondId && sourceOf(first) === 'google' && sourceOf(second) === 'google') {
      return false;
    }

    if (!normalizedTitle(first) || normalizedTitle(first) !== normalizedTitle(second)) return false;
    const a = interval(first);
    const b = interval(second);
    if (!a || !b) return false;
    const tolerance = 5 * 60 * 1000;
    return Math.abs(a.start - b.start) <= tolerance && Math.abs(a.end - b.end) <= tolerance;
  }

  function score(event) {
    return [
      isBlocking(event) ? 1 : 0,
      sourceOf(event) === 'google' ? 1 : 0,
      event?.html_link ? 1 : 0
    ];
  }

  function higherScore(first, second) {
    const a = score(first);
    const b = score(second);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return a[index] > b[index];
    }
    return false;
  }

  function deduplicate(events) {
    const unique = [];
    for (const raw of events || []) {
      const candidate = { ...raw };
      const index = unique.findIndex(existing => isDuplicate(existing, candidate));
      if (index < 0) unique.push(candidate);
      else if (higherScore(candidate, unique[index])) unique[index] = candidate;
    }
    return unique;
  }

  function annotate(events) {
    const cleanEvents = deduplicate(events);
    cleanEvents.forEach(event => {
      event.conflict = false;
      event.conflict_with = [];
      event.blocking = isBlocking(event);
    });
    const candidates = cleanEvents
      .map(event => ({ event, interval: interval(event) }))
      .filter(item => item.event.blocking && item.interval);
    const pairs = [];
    const seen = new Set();

    for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
      const first = candidates[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
        const second = candidates[secondIndex];
        if (isDuplicate(first.event, second.event)) continue;
        if (first.interval.start < second.interval.end && second.interval.start < first.interval.end) {
          const firstId = String(first.event.id || '');
          const secondId = String(second.event.id || '');
          const key = [firstId, secondId].sort().join(':');
          if (!firstId || !secondId || firstId === secondId || seen.has(key)) continue;
          seen.add(key);
          const overlapMinutes = Math.round((Math.min(first.interval.end, second.interval.end) - Math.max(first.interval.start, second.interval.start)) / 600) / 100;
          pairs.push({ a: firstId, b: secondId, overlapMinutes });
          first.event.conflict = true;
          second.event.conflict = true;
          first.event.conflict_with.push({ id: secondId, title: second.event.title });
          second.event.conflict_with.push({ id: firstId, title: first.event.title });
        }
      }
    }
    return { events: cleanEvents, pairs };
  }

  return { annotate, deduplicate, isBlocking, isDuplicate };
});
