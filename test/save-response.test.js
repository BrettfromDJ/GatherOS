const test = require('node:test');
const assert = require('node:assert/strict');

test('save responses are accepted only when they are not skipped or sync-disabled', async () => {
  const { isAcceptedSaveResponse } = await import('../extension/save-response.mjs');

  assert.equal(isAcceptedSaveResponse({ ok: true }), true);
  assert.equal(isAcceptedSaveResponse({ ok: true, duplicate: true }), true);
  assert.equal(isAcceptedSaveResponse({ ok: true, dismissed: true }), true);
  assert.equal(isAcceptedSaveResponse({ ok: true, skipped: true }), false);
  assert.equal(isAcceptedSaveResponse({ ok: true, syncDisabled: true }), false);
  assert.equal(isAcceptedSaveResponse({ ok: false }), false);
  assert.equal(isAcceptedSaveResponse(null), false);
});

test('only genuinely new accepted saves count as imported', async () => {
  const { isNewImportedSaveResponse } = await import('../extension/save-response.mjs');

  assert.equal(isNewImportedSaveResponse({ ok: true }), true);
  assert.equal(isNewImportedSaveResponse({ ok: true, duplicate: true }), false);
  assert.equal(isNewImportedSaveResponse({ ok: true, dismissed: true }), false);
  assert.equal(isNewImportedSaveResponse({ ok: true, skipped: true }), false);
  assert.equal(isNewImportedSaveResponse({ ok: false }), false);
});
