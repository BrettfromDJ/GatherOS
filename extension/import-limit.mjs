export function importProcessedCount(state) {
  return state && state.processed && typeof state.processed.size === 'number'
    ? state.processed.size
    : 0;
}

export function importLimitReached(state) {
  return !!(state && importProcessedCount(state) >= state.limit);
}

export function claimImportItem(state, id) {
  if (!state || !state.active || !id || !state.processed) return false;
  if (state.processed.has(id)) return false;
  if (importLimitReached(state)) return false;
  state.processed.add(id);
  return true;
}

export function rememberImportEntries(state, entries, key = 'tweetId') {
  if (!state || !state.seenIds || !Array.isArray(entries)) return 0;
  let added = 0;
  for (const entry of entries) {
    const id = entry && entry[key];
    if (id && !state.seenIds.has(id)) {
      state.seenIds.add(id);
      added += 1;
    }
  }
  return added;
}
