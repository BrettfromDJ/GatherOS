const test = require('node:test');
const assert = require('node:assert/strict');

async function transport() { return import('../extension/x-import-transport.mjs'); }

function catchUpState() {
  return { active: true, mode: 'catch-up', knownStreak: 0, processed: new Set(), imported: 0 };
}

test('API and scroll adapters execute identical ordered catch-up behavior', async () => {
  const { runCatchUpTransportBatch } = await transport();
  for (const transportName of ['api', 'scroll']) {
    const state = catchUpState();
    const saved = [];
    const result = await runCatchUpTransportBatch({
      state,
      entries: [{ tweetId: 'known' }, { tweetId: 'missed' }, { tweetId: 'known-2' }, { tweetId: 'known-3' }],
      classify: async () => ['known-active', 'new', 'known-dismissed', 'known-active'],
      save: async (entry, options) => { saved.push([transportName, entry.tweetId, options]); return { ok: true, id: entry.tweetId }; },
      isAccepted: (response) => response.ok,
      isNew: (response) => !!response.id,
    });
    assert.deepEqual(saved, [[transportName, 'missed', { force: false }]]);
    assert.deepEqual(result, { boundaryReached: true, acceptedIds: ['missed'] });
    assert.equal(state.imported, 1);
  }
});

test('save failure stops before later status with accurate partial progress', async () => {
  const { runCatchUpTransportBatch } = await transport();
  const state = catchUpState();
  let saves = 0;
  await assert.rejects(runCatchUpTransportBatch({
    state,
    entries: [{ tweetId: 'first' }, { tweetId: 'failed' }, { tweetId: 'later' }],
    classify: async () => ['new', 'new', 'known-active'],
    save: async (entry) => {
      saves += 1;
      if (entry.tweetId === 'failed') return { ok: false, error: 'rejected' };
      return { ok: true, id: entry.tweetId };
    },
    isAccepted: (response) => response.ok,
    isNew: (response) => !!response.id,
  }), /rejected/);
  assert.equal(saves, 2);
  assert.equal(state.imported, 1);
  assert.equal(state.knownStreak, 0);
  assert.deepEqual([...state.processed], ['first', 'failed']);
});

test('classification failure performs no saves', async () => {
  const { runCatchUpTransportBatch } = await transport();
  let saves = 0;
  await assert.rejects(runCatchUpTransportBatch({
    state: catchUpState(), entries: [{ tweetId: 'a' }],
    classify: async () => { throw new Error('classification unavailable'); },
    save: async () => { saves += 1; },
    isAccepted: () => true, isNew: () => true,
  }), /classification unavailable/);
  assert.equal(saves, 0);
});

test('fixed/all transport keeps force and limit behavior', async () => {
  const { runFixedTransportBatch } = await transport();
  for (const mode of ['fixed', 'all']) {
    const state = { active: true, mode, limit: 2, processed: new Set(), imported: 0 };
    const calls = [];
    const result = await runFixedTransportBatch({
      state,
      entries: [{ tweetId: 'a' }, { tweetId: 'a' }, { tweetId: 'b' }, { tweetId: 'c' }],
      save: async (entry, options) => { calls.push([entry.tweetId, options]); return { ok: true, id: entry.tweetId }; },
      isAccepted: (response) => response.ok,
      isNew: (response) => !!response.id,
    });
    assert.deepEqual(calls, [['a', { force: true }], ['b', { force: true }]]);
    assert.equal(result.reachedLimit, true);
    assert.deepEqual(result.attemptedIds, ['a', 'b']);
    assert.equal(state.imported, 2);
  }
});

test('API fallback launcher preserves catch-up mode and limit', async () => {
  const { launchScrollFallback } = await transport();
  const calls = [];
  await launchScrollFallback((limit, mode) => calls.push({ limit, mode }), Infinity, 'catch-up');
  assert.deepEqual(calls, [{ limit: Infinity, mode: 'catch-up' }]);
});
