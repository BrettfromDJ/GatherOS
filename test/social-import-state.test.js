const test = require('node:test');
const assert = require('node:assert/strict');

const { createSocialImportState } = require('../src/main/social-import-state');

function snapshot(overrides = {}) {
  return {
    runId: 'run-1', platform: 'x', mode: 'fixed', stage: 'starting',
    scanned: 0, saved: 0, known: 0, failed: 0, target: 10,
    startedAt: 1000, message: null, ...overrides,
  };
}

test('accepts a starting snapshot and exposes cancel state', () => {
  const changes = [];
  const state = createSocialImportState({ onChange: (next) => changes.push(next) });
  assert.deepEqual(state.update(snapshot()), { ok: true, cancelRequested: false });
  assert.equal(state.get().runId, 'run-1');
  assert.equal(changes.length, 1);
});

test('rejects counter decreases and mismatched run ids', () => {
  const state = createSocialImportState();
  state.update(snapshot({ scanned: 2 }));
  assert.equal(state.update(snapshot({ scanned: 1 })).ok, false);
  assert.equal(state.update(snapshot({ runId: 'run-2', stage: 'scanning' })).ok, false);
});

test('cancel marks the active run stopping and reports cancellation', () => {
  const changes = [];
  const state = createSocialImportState({ onChange: (next) => changes.push(next) });
  state.update(snapshot());
  state.update(snapshot({ stage: 'scanning' }));
  assert.deepEqual(state.cancel('run-1'), { ok: true, cancelRequested: true });
  assert.equal(state.get().stage, 'stopping');
  assert.equal(state.get().cancelRequested, true);
  assert.equal(changes.at(-1).stage, 'stopping');
});

test('derives stalled after heartbeat gap without changing stage', () => {
  let now = 1000;
  let staleTimer;
  const changes = [];
  const state = createSocialImportState({
    now: () => now,
    setTimer: (fn) => { staleTimer = fn; return 1; },
    clearTimer: () => {},
    onChange: (next) => changes.push(next),
  });
  state.update(snapshot());
  state.update(snapshot({ stage: 'scanning' }));
  now = 31_001;
  staleTimer();
  assert.equal(state.get().stage, 'scanning');
  assert.equal(state.get().stalled, true);
  assert.equal(changes.at(-1).stalled, true);
});

test('terminal snapshots remain until matching dismiss', () => {
  const state = createSocialImportState();
  state.update(snapshot());
  state.update(snapshot({ stage: 'complete', scanned: 3, saved: 2 }));
  assert.equal(state.get().stage, 'complete');
  assert.deepEqual(state.dismiss('other'), { ok: false, error: 'not dismissible' });
  assert.equal(state.get().runId, 'run-1');
  assert.deepEqual(state.dismiss('run-1'), { ok: true });
  assert.equal(state.get(), null);
});

test('new starting run resets terminal counter baseline', () => {
  const state = createSocialImportState();
  state.update(snapshot());
  state.update(snapshot({ stage: 'complete', scanned: 3, saved: 2 }));
  const result = state.update(snapshot({ runId: 'run-2', stage: 'starting', scanned: 0, saved: 0 }));
  assert.deepEqual(result, { ok: true, cancelRequested: false });
  assert.equal(state.get().runId, 'run-2');
  assert.equal(state.get().scanned, 0);
});
