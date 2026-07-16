const test = require('node:test');
const assert = require('node:assert/strict');

async function helper() { return import('../extension/catch-up-import.mjs'); }

function run(policy, apply) {
  const state = { knownStreak: 0, imported: 0 };
  let stopped = false;
  for (const status of policy) {
    const result = apply(state, status);
    if (result.shouldSave) state.saves = (state.saves || 0) + 1;
    if (result.shouldStop) { stopped = true; break; }
  }
  return { saves: state.saves || 0, stopped, knownStreak: state.knownStreak };
}

test('catch-up stops after two known bookmarks and saves new bookmark', async () => {
  const { applyCatchUpStatus } = await helper();
  assert.deepEqual(run(['new', 'known-active', 'known-active'], applyCatchUpStatus), {
    saves: 1, stopped: true, knownStreak: 2,
  });
});

test('catch-up repairs isolated missed bookmark between known entries', async () => {
  const { applyCatchUpStatus } = await helper();
  assert.deepEqual(run(['known-active', 'new', 'known-dismissed', 'known-active'], applyCatchUpStatus), {
    saves: 1, stopped: true, knownStreak: 2,
  });
});

test('dismissed and active known entries stop without save', async () => {
  const { applyCatchUpStatus } = await helper();
  assert.deepEqual(run(['known-dismissed', 'known-active'], applyCatchUpStatus), {
    saves: 0, stopped: true, knownStreak: 2,
  });
});

test('new resets known streak', async () => {
  const { applyCatchUpStatus } = await helper();
  assert.deepEqual(run(['known-active', 'new', 'known-active', 'known-active'], applyCatchUpStatus), {
    saves: 1, stopped: true, knownStreak: 2,
  });
});

test('ordered processor saves before resetting streak and stops at boundary', async () => {
  const { processCatchUpEntries } = await helper();
  const state = { knownStreak: 1, processed: new Set() };
  const events = [];
  const result = await processCatchUpEntries({
    state,
    entries: [{ tweetId: 'new' }, { tweetId: 'known-1' }, { tweetId: 'known-2' }, { tweetId: 'older' }],
    statuses: ['new', 'known-active', 'known-dismissed', 'new'],
    save: async (entry) => { events.push(`save:${entry.tweetId}:streak:${state.knownStreak}`); },
  });
  assert.deepEqual(events, ['save:new:streak:1']);
  assert.deepEqual(result, { boundaryReached: true, processedCount: 3 });
  assert.equal(state.knownStreak, 2);
  assert.deepEqual([...state.processed], ['new', 'known-1', 'known-2']);
});

test('ordered processor stops on save failure before later statuses', async () => {
  const { processCatchUpEntries } = await helper();
  const state = { knownStreak: 1, processed: new Set() };
  await assert.rejects(processCatchUpEntries({
    state,
    entries: [{ tweetId: 'new' }, { tweetId: 'later' }],
    statuses: ['new', 'known-active'],
    save: async () => { throw new Error('save rejected'); },
  }), /save rejected/);
  assert.equal(state.knownStreak, 1);
  assert.deepEqual([...state.processed], ['new']);
});

test('ordered processor reports pagination page ended before boundary', async () => {
  const { processCatchUpEntries } = await helper();
  const state = { knownStreak: 0, processed: new Set() };
  const result = await processCatchUpEntries({
    state,
    entries: [{ tweetId: 'new' }, { tweetId: 'known' }],
    statuses: ['new', 'known-active'],
    save: async () => {},
  });
  assert.deepEqual(result, { boundaryReached: false, processedCount: 2 });
  assert.equal(state.knownStreak, 1);
});

test('catch-up summary distinguishes boundary, bottom, imported, and error', async () => {
  const { catchUpSummary } = await helper();
  assert.equal(catchUpSummary({ imported: 0, boundaryReached: true }), 'Already caught up.');
  assert.equal(catchUpSummary({ imported: 0 }), 'No new bookmarks to import.');
  assert.equal(catchUpSummary({ imported: 2 }), 'Imported 2 bookmarks from X.');
  assert.equal(catchUpSummary({ imported: 1, error: new Error('x') }), 'Bookmark import stopped — imported 1 so far.');
});

test('preflight returns no-boundary without starting when history is empty', async () => {
  const { catchUpPreflightResult } = await helper();
  assert.deepEqual(catchUpPreflightResult({ ok: true, hasKnownHistory: false, statuses: [] }), {
    ok: false, noBoundary: true,
  });
  assert.equal(catchUpPreflightResult({ ok: true, hasKnownHistory: true, statuses: [] }), null);
});

test('fixed and all modes force saves while catch-up preserves tombstones', async () => {
  const { importSaveOptions } = await helper();
  assert.deepEqual(importSaveOptions('fixed'), { force: true });
  assert.deepEqual(importSaveOptions('all'), { force: true });
  assert.deepEqual(importSaveOptions('catch-up'), { force: false });
});
