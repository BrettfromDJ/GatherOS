const test = require('node:test');
const assert = require('node:assert/strict');

test('import limit claims each item once and stops exactly at the limit', async () => {
  const { claimImportItem, importLimitReached, importProcessedCount } = await import('../extension/import-limit.mjs');
  const state = { active: true, limit: 2, processed: new Set() };

  assert.equal(claimImportItem(state, 'a'), true);
  assert.equal(claimImportItem(state, 'a'), false);
  assert.equal(claimImportItem(state, 'b'), true);
  assert.equal(importProcessedCount(state), 2);
  assert.equal(importLimitReached(state), true);
  assert.equal(claimImportItem(state, 'c'), false);
});

test('remembered entries are deduplicated without consuming the traversal limit', async () => {
  const { rememberImportEntries } = await import('../extension/import-limit.mjs');
  const state = { seenIds: new Set(['a']) };

  assert.equal(rememberImportEntries(state, [{ tweetId: 'a' }, { tweetId: 'b' }, { tweetId: 'b' }]), 1);
  assert.deepEqual([...state.seenIds].sort(), ['a', 'b']);
});
