const test = require('node:test');
const assert = require('node:assert/strict');

test('X bookmark date sort uses tweet date only when enabled', async () => {
  const { getSaveSortDate } = await import('../src/renderer/lib/saveSortDate.mjs');
  const savedAt = 1770000000000;
  const tweetAt = 1700000000000;
  const record = {
    created_at: savedAt,
    source: 'x',
    tweet_meta: JSON.stringify({ tweetCreatedAt: tweetAt }),
  };

  assert.equal(getSaveSortDate(record, true), tweetAt);
  assert.equal(getSaveSortDate(record, false), savedAt);
});

test('date sort falls back to save date for non-X and missing tweet dates', async () => {
  const { getSaveSortDate } = await import('../src/renderer/lib/saveSortDate.mjs');
  const savedAt = 1770000000000;

  assert.equal(
    getSaveSortDate({ created_at: savedAt, source: 'instagram', tweet_meta: JSON.stringify({ tweetCreatedAt: 1700000000000 }) }, true),
    savedAt,
  );
  assert.equal(
    getSaveSortDate({ created_at: savedAt, source: 'x', tweet_meta: JSON.stringify({ caption: 'No date' }) }, true),
    savedAt,
  );
  assert.equal(
    getSaveSortDate({ created_at: savedAt, source: 'x', tweet_meta: '{bad json' }, true),
    savedAt,
  );
});
