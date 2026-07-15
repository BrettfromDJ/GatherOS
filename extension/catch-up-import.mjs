export function applyCatchUpStatus(state, status) {
  if (!state || typeof state !== 'object') throw new TypeError('state required');
  if (status === 'new') {
    state.knownStreak = 0;
    return { shouldSave: true, shouldStop: false, knownStreak: 0 };
  }
  if (status === 'known-active' || status === 'known-dismissed') {
    state.knownStreak = (Number(state.knownStreak) || 0) + 1;
    return { shouldSave: false, shouldStop: state.knownStreak >= 2, knownStreak: state.knownStreak };
  }
  throw new Error(`unknown catch-up status: ${status}`);
}

export async function processCatchUpEntries({ state, entries, statuses, save, shouldContinue = () => true, onItem = async () => {} }) {
  if (!state || !(state.processed instanceof Set)) throw new TypeError('processed state required');
  if (!Array.isArray(entries) || !Array.isArray(statuses) || entries.length !== statuses.length) {
    throw new TypeError('entries and statuses must have equal lengths');
  }
  if (typeof save !== 'function') throw new TypeError('save callback required');
  let processedCount = 0;
  for (let index = 0; index < entries.length; index += 1) {
    if (!shouldContinue()) { state.active = false; break; }
    const entry = entries[index];
    if (!entry || !entry.tweetId || state.processed.has(entry.tweetId)) continue;
    state.processed.add(entry.tweetId);
    processedCount += 1;
    const status = statuses[index];
    if (status === 'new') await save(entry);
    const decision = applyCatchUpStatus(state, status);
    await onItem({ entry, status });
    if (decision.shouldStop) return { boundaryReached: true, processedCount };
  }
  return { boundaryReached: false, processedCount };
}

export function catchUpSummary({ imported = 0, boundaryReached = false, error = null } = {}) {
  if (error) return `Bookmark import stopped — imported ${imported} so far.`;
  if (boundaryReached && imported === 0) return 'Already caught up.';
  if (imported > 0) return `Imported ${imported} bookmark${imported === 1 ? '' : 's'} from X.`;
  return 'No new bookmarks to import.';
}

export function catchUpPreflightResult(response) {
  if (response?.ok && response.hasKnownHistory === false) return { ok: false, noBoundary: true };
  return null;
}

export function importSaveOptions(mode) {
  return { force: mode !== 'catch-up' };
}
