import { processCatchUpEntries, importSaveOptions } from './catch-up-import.mjs';
import { claimImportItem, importLimitReached } from './import-limit.mjs';

export async function runCatchUpTransportBatch({
  state, entries, classify, save, isAccepted, isNew,
}) {
  const statuses = await classify(entries);
  const acceptedIds = [];
  const result = await processCatchUpEntries({
    state,
    entries,
    statuses,
    save: async (entry) => {
      const response = await save(entry, importSaveOptions('catch-up'));
      if (!isAccepted(response)) throw new Error(response?.error || 'save rejected');
      if (isNew(response)) state.imported += 1;
      acceptedIds.push(entry.tweetId);
    },
  });
  return { boundaryReached: result.boundaryReached, acceptedIds };
}

export async function runFixedTransportBatch({
  state, entries, save, isAccepted, isNew, onError = () => {},
}) {
  const acceptedIds = [];
  const attemptedIds = [];
  let reachedLimit = false;
  for (const entry of entries) {
    if (!claimImportItem(state, entry?.tweetId)) {
      if (importLimitReached(state)) { reachedLimit = true; break; }
      continue;
    }
    if (importLimitReached(state)) reachedLimit = true;
    attemptedIds.push(entry.tweetId);
    try {
      const response = await save(entry, importSaveOptions(state.mode));
      if (!state.active) break;
      if (isNew(response)) state.imported += 1;
      if (isAccepted(response)) acceptedIds.push(entry.tweetId);
    } catch (error) {
      onError(error, entry);
    }
    if (reachedLimit) break;
  }
  return { reachedLimit, acceptedIds, attemptedIds };
}

export function launchScrollFallback(start, limit, mode) {
  return start(limit, mode);
}
