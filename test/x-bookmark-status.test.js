const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deriveXTweetCreatedAt } = require('../src/main/extension-server');

test('derives missing tweet creation time from X and Twitter status snowflakes', () => {
  assert.equal(
    deriveXTweetCreatedAt('https://x.com/mattpocockuk/status/2049506712801935611'),
    Date.parse('2026-04-29T15:10:52.982Z'),
  );
  assert.equal(
    deriveXTweetCreatedAt('https://twitter.com/example/status/2049506712801935611?ref=test'),
    Date.parse('2026-04-29T15:10:52.982Z'),
  );
  assert.equal(deriveXTweetCreatedAt('https://example.com/status/2049506712801935611'), null);
  assert.equal(deriveXTweetCreatedAt('https://x.com/example/status/not-a-number'), null);
});

test('repairs missing X tweet dates without changing save or deletion timestamps', withTempDb((db) => {
  const createdAt = Date.parse('2026-07-11T01:28:45.266Z');
  db.insertSave({
    id: 'missing-deleted',
    filePath: '/tmp/b.png',
    thumbPath: '/tmp/b.png',
    sourceUrl: 'https://twitter.com/example/status/2049506712801935611',
    tweetMeta: {},
    createdAt,
  });
  db.getDatabase().prepare('UPDATE saves SET deleted_at = ? WHERE id = ?').run(createdAt + 1, 'missing-deleted');
  db.insertSave({
    id: 'missing-active',
    filePath: '/tmp/a.png',
    thumbPath: '/tmp/a.png',
    sourceUrl: 'https://x.com/mattpocockuk/status/2049506712801935611',
    tweetMeta: { caption: 'Sandcastle' },
    createdAt,
  });

  assert.equal(db.repairMissingXTweetCreatedAt(db.getDatabase()), 2);
  const rows = db.getDatabase().prepare(`
    SELECT id, created_at, deleted_at, tweet_meta FROM saves ORDER BY id
  `).all();
  for (const row of rows) {
    assert.equal(row.created_at, createdAt);
    assert.equal(JSON.parse(row.tweet_meta).tweetCreatedAt, Date.parse('2026-04-29T15:10:52.982Z'));
  }
  assert.equal(rows.find((row) => row.id === 'missing-active').deleted_at, null);
  assert.equal(rows.find((row) => row.id === 'missing-deleted').deleted_at, createdAt + 1);
  assert.equal(db.repairMissingXTweetCreatedAt(db.getDatabase()), 0);
}));

function loadDb(userData) {
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath(name) { if (name !== 'userData') throw new Error('unexpected path'); return userData; } } },
  };
  for (const mod of ['../src/main/db.js', '../src/main/library-registry.js']) delete require.cache[require.resolve(mod)];
  return require('../src/main/db.js');
}

function withTempDb(fn) {
  return async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gatherlocal-x-status-'));
    const db = loadDb(userData);
    try { db.initDatabase(); await fn(db, userData); }
    finally { try { db.closeDatabase(); } catch {} fs.rmSync(userData, { recursive: true, force: true }); }
  };
}

test('classifyXBookmarkUrls returns ordered active, dismissed, and new statuses', withTempDb((db) => {
  db.insertSave({
    id: 'active', filePath: '/tmp/a.png', thumbPath: '/tmp/a.png',
    sourceUrl: 'https://x.com/a/status/101', tweetMeta: { caption: 'Post' },
  });
  db.dismissTweet('tw:202');
  assert.deepEqual(db.classifyXBookmarkUrls([
    'https://x.com/a/status/101',
    'https://x.com/b/status/202',
    'https://x.com/c/status/303',
  ]), {
    hasKnownHistory: true,
    statuses: ['known-active', 'known-dismissed', 'new'],
  });
}));

test('classifyXBookmarkUrls uses indexed source identity instead of scanning save URLs', withTempDb((db) => {
  db.insertSave({
    id: 'active', filePath: '/tmp/a.png', thumbPath: '/tmp/a.png',
    sourceUrl: 'https://x.com/a/status/101', tweetMeta: { caption: 'Post' },
  });
  for (let i = 0; i < 250; i += 1) {
    db.insertSave({
      id: `unrelated-${i}`, filePath: `/tmp/${i}.png`, thumbPath: `/tmp/${i}.png`,
      sourceUrl: `https://example.com/${i}`,
    });
  }

  assert.deepEqual(db.classifyXBookmarkUrls([
    'https://x.com/a/status/101',
    'https://x.com/b/status/202',
  ]), {
    hasKnownHistory: true,
    statuses: ['known-active', 'new'],
  });

  const plan = db.getDatabase().prepare(`
    EXPLAIN QUERY PLAN
    SELECT source_key FROM saves
     WHERE deleted_at IS NULL AND source_key IN (?)
  `).all('tw:101');
  assert.match(plan.map((row) => row.detail).join(' '), /idx_saves_active_source_key/);
}));

test('active social source identity is unique while trashed rows release it', withTempDb((db) => {
  const input = {
    filePath: '/tmp/a.png', thumbPath: '/tmp/a.png',
    sourceUrl: 'https://x.com/a/status/101',
    tweetMeta: { caption: 'Post' },
  };
  db.insertSave({ id: 'first', ...input });
  assert.throws(() => db.insertSave({ id: 'duplicate', ...input }), /UNIQUE constraint failed/);
  db.getDatabase().prepare('UPDATE saves SET deleted_at = ? WHERE id = ?').run(Date.now(), 'first');
  assert.doesNotThrow(() => db.insertSave({ id: 'replacement', ...input }));
}));

test('classifyXBookmarkUrls reports no boundary on empty history and invalid URLs as new', withTempDb((db) => {
  assert.deepEqual(db.classifyXBookmarkUrls([]), { hasKnownHistory: false, statuses: [] });
  assert.deepEqual(db.classifyXBookmarkUrls(['https://example.com/nope', 'not a url']), {
    hasKnownHistory: false,
    statuses: ['new', 'new'],
  });
}));

test('classifyXBookmarkUrls rejects non-array and batches over 100', withTempDb((db) => {
  assert.throws(() => db.classifyXBookmarkUrls(null), /tweetUrls must be an array/);
  assert.throws(() => db.classifyXBookmarkUrls(Array.from({ length: 101 }, () => 'https://x.com/a/status/1')), /too large/);
  assert.throws(() => db.classifyXBookmarkUrls(['https://x.com/a/status/1', null]), /strings/);
}));

test('x-bookmark-status HTTP handler authenticates and returns exact contract', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gatherlocal-x-server-'));
  const db = loadDb(userData);
  db.initDatabase();
  const server = require('../src/main/extension-server');
  const { EventEmitter } = require('node:events');
  function invoke(headers, body) {
    return new Promise((resolve) => {
      const req = new EventEmitter();
      req.headers = headers;
      const res = {
        statusCode: 0,
        writeHead(status, responseHeaders) { this.statusCode = status; this.headers = responseHeaders; },
        end(payload) { resolve({ status: this.statusCode, body: JSON.parse(payload || '{}') }); },
      };
      server.handleXBookmarkStatus(req, res);
      process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
    });
  }
  try {
    const token = server.getOrCreateToken();
    const response = await invoke({ 'x-gatheros-token': token, origin: 'chrome-extension://test' }, { tweetUrls: ['https://x.com/a/status/1'] });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true, hasKnownHistory: false, statuses: ['new'] });
    const bad = await invoke({ 'x-gatheros-token': 'bad' }, {});
    assert.equal(bad.status, 401);
    const invalidElement = await invoke(
      { 'x-gatheros-token': token, origin: 'chrome-extension://test' },
      { tweetUrls: ['https://x.com/a/status/1', 2] },
    );
    assert.equal(invalidElement.status, 400);
  } finally {
    db.closeDatabase();
    fs.rmSync(userData, { recursive: true, force: true });
    delete require.cache[require.resolve('../src/main/extension-server')];
  }
});

test('social import status HTTP handler authenticates and validates full snapshots', async () => {
  const server = require('../src/main/extension-server');
  const { EventEmitter } = require('node:events');
  function invoke(headers, body) {
    return new Promise((resolve) => {
      const req = new EventEmitter(); req.headers = headers;
      const res = {
        statusCode: 0,
        writeHead(status, responseHeaders) { this.statusCode = status; this.headers = responseHeaders; },
        end(payload) { resolve({ status: this.statusCode, body: JSON.parse(payload || '{}') }); },
      };
      server.handleSocialImportStatus(req, res);
      process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
    });
  }
  const token = server.getOrCreateToken();
  const body = {
    runId: 'run-1', platform: 'x', mode: 'fixed', stage: 'starting',
    scanned: 0, saved: 0, known: 0, failed: 0, target: 5, startedAt: 1000, message: null,
  };
  const response = await invoke({ 'x-gatheros-token': token, origin: 'chrome-extension://test' }, body);
  assert.deepEqual(response.body, { ok: true, cancelRequested: false });
  const invalid = await invoke({ 'x-gatheros-token': token, origin: 'chrome-extension://test' }, { ...body, extra: true });
  assert.equal(invalid.status, 400);
  const badToken = await invoke({ 'x-gatheros-token': 'bad' }, body);
  assert.equal(badToken.status, 401);
});

test('social import status propagates controller rejection', async () => {
  const server = require('../src/main/extension-server');
  const { EventEmitter } = require('node:events');
  const body = {
    runId: 'run-1', platform: 'x', mode: 'fixed', stage: 'scanning',
    scanned: 1, saved: 0, known: 0, failed: 0, target: 5, startedAt: 1000, message: null,
  };
  const token = server.getOrCreateToken();
  const response = await new Promise((resolve) => {
      const req = new EventEmitter(); req.headers = { 'x-gatheros-token': token, origin: 'chrome-extension://test' };
      const res = {
        statusCode: 0,
        writeHead(status) { this.statusCode = status; },
        end(payload) { resolve({ status: this.statusCode, body: JSON.parse(payload || '{}') }); },
      };
      server.handleSocialImportStatus(req, res, async () => ({ ok: false, error: 'runId mismatch' }));
      process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
  });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { ok: false, error: 'runId mismatch', cancelRequested: false });
});
