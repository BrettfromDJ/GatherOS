import { processCatchUpEntries, importSaveOptions } from './catch-up-import.mjs';
import { claimImportItem, importLimitReached } from './import-limit.mjs';

export async function runCatchUpTransportBatch({
  state, entries, classify, save, isAccepted, isNew, progress = null,
}) {
  state.known = Number(state.known) || 0;
  state.failed = Number(state.failed) || 0;
  const statuses = await classify(entries);
  const acceptedIds = [];
  const result = await processCatchUpEntries({
    state,
    entries,
    statuses,
    save: async (entry) => {
      if (progress && !progress.beforeNext()) {
        state.active = false;
        const error = new Error('import stopped');
        error.code = 'IMPORT_STOPPED';
        throw error;
      }
      let response;
      try { response = await save(entry, importSaveOptions('catch-up')); }
      catch (error) {
        state.failed += 1;
        if (progress) await progress.update({ stage: 'saving', scanned: state.processed.size, saved: state.imported, known: state.known, failed: state.failed });
        throw error;
      }
      if (!isAccepted(response)) {
        state.failed += 1;
        if (progress) await progress.update({ stage: 'saving', scanned: state.processed.size, saved: state.imported, known: state.known, failed: state.failed });
        throw new Error(response?.error || 'save rejected');
      }
      if (isNew(response)) state.imported += 1;
      acceptedIds.push(entry.tweetId);
    },
    shouldContinue: () => !progress || progress.beforeNext(),
    onItem: async ({ status }) => {
      if (status === 'known-active' || status === 'known-dismissed') state.known += 1;
      if (progress) await progress.update({ stage: 'saving', scanned: state.processed.size, saved: state.imported, known: state.known, failed: state.failed });
    },
  });
  return { boundaryReached: result.boundaryReached, acceptedIds };
}

export async function runFixedTransportBatch({
  state, entries, save, isAccepted, isNew, onError = () => {}, progress = null,
}) {
  state.known = Number(state.known) || 0;
  state.failed = Number(state.failed) || 0;
  const acceptedIds = [];
  const attemptedIds = [];
  let reachedLimit = false;
  for (const entry of entries) {
    if (progress && !progress.beforeNext()) { state.active = false; break; }
    if (!claimImportItem(state, entry?.tweetId)) {
      if (importLimitReached(state)) { reachedLimit = true; break; }
      continue;
    }
    if (importLimitReached(state)) reachedLimit = true;
    attemptedIds.push(entry.tweetId);
    try {
      const response = await save(entry, importSaveOptions(state.mode));
      if (isNew(response)) state.imported += 1;
      if (isAccepted(response)) {
        if (!isNew(response)) state.known += 1;
        acceptedIds.push(entry.tweetId);
      } else {
        state.failed += 1;
      }
      if (progress) await progress.update({ stage: 'saving', scanned: state.processed.size, saved: state.imported, known: state.known, failed: state.failed });
    } catch (error) {
      state.failed += 1;
      if (progress) await progress.update({ stage: 'saving', scanned: state.processed.size, saved: state.imported, known: state.known, failed: state.failed });
      onError(error, entry);
    }
    if (reachedLimit) break;
  }
  return { reachedLimit, acceptedIds, attemptedIds };
}
