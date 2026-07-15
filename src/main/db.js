const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app } = require('electron');
const Database = require('better-sqlite3');
const { deriveXTweetCreatedAt } = require('./x-tweet-date');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS saves (
  id          TEXT PRIMARY KEY,
  file_path   TEXT NOT NULL,
  thumb_path  TEXT NOT NULL,
  title       TEXT,
  source_url  TEXT,
  width       INTEGER,
  height      INTEGER,
  file_size   INTEGER,
  palette     TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saves_created_at ON saves (created_at DESC);

CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id  TEXT REFERENCES collections(id) ON DELETE CASCADE,
  save_id        TEXT REFERENCES saves(id) ON DELETE CASCADE,
  added_at       INTEGER NOT NULL,
  PRIMARY KEY (collection_id, save_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id    TEXT PRIMARY KEY,
  name  TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS save_tags (
  save_id  TEXT REFERENCES saves(id) ON DELETE CASCADE,
  tag_id   TEXT REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (save_id, tag_id)
);

CREATE TABLE IF NOT EXISTS boards (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  thumb_path   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boards_updated_at ON boards (updated_at DESC);

CREATE TABLE IF NOT EXISTS board_items (
  id           TEXT PRIMARY KEY,
  board_id     TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  x            REAL NOT NULL,
  y            REAL NOT NULL,
  width        REAL,
  height       REAL,
  rotation     REAL DEFAULT 0,
  z_index      INTEGER NOT NULL DEFAULT 0,
  data         TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_board_items_board_id ON board_items (board_id);

-- Tombstones for X bookmarks the user has removed from Gather. The
-- bookmark watcher re-captures whatever scrolls into view, so without
-- this a deleted bookmark would silently come back. Keyed by tweet id.
CREATE TABLE IF NOT EXISTS dismissed_tweets (
  tweet_key     TEXT PRIMARY KEY,
  dismissed_at  INTEGER NOT NULL
);

`;

let db = null;

function getDatabasePath() {
  // Resolved per-call so a library switch (which writes a new
  // active id into the registry) is reflected the next time the
  // DB is opened.
  const { getActiveLibraryRoot } = require('./library-registry');
  return path.join(getActiveLibraryRoot(), 'moodmark.db');
}

function initDatabase() {
  if (db) return db;
  const file = getDatabasePath();
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Baseline schema first — CREATE TABLE IF NOT EXISTS is a no-op on
  // existing DBs but bootstraps fresh ones. Then run versioned
  // migrations on top to bring any older shape up to current.
  db.exec(SCHEMA);
  migrate();
  // Cheap insurance against the SQLite-corruption stories that haunt
  // local-first apps. Result is cached so the renderer can pull it on
  // mount and surface a recoverable warning if anything turned up.
  lastIntegrityResult = checkIntegrity(db);
  return db;
}

// Result of the most recent PRAGMA integrity_check, captured at init
// time so the renderer can ask for it once on mount without rerunning
// a full-table scan on every poll.
let lastIntegrityResult = { ok: true, errors: [] };

function checkIntegrity(database) {
  try {
    // quick_check, not integrity_check: the full check reads the ENTIRE
    // database on every launch, which is seconds of cold-start on a
    // multi-GB library. quick_check catches the same page-level
    // corruption classes (it skips some index cross-validation) in a
    // small fraction of the time.
    const rows = database.prepare('PRAGMA quick_check').all();
    const errors = rows
      .map((r) => r.quick_check)
      .filter((s) => s && s !== 'ok');
    if (errors.length > 0) {
      console.error('[db] integrity_check found issues:', errors);
      return { ok: false, errors };
    }
    return { ok: true, errors: [] };
  } catch (err) {
    console.error('[db] integrity_check threw:', err);
    return { ok: false, errors: [err.message || String(err)] };
  }
}

function getIntegrityResult() {
  return lastIntegrityResult;
}

// ── Versioned migrations ───────────────────────────────────────────
//
// SQLite's user_version pragma is our schema version cursor. Each
// entry of MIGRATIONS is a function run exactly once on databases
// whose user_version is below the entry's index. After a successful
// run, user_version is bumped to that index + 1.
//
// Adding a migration:
//   1. Append a new function to MIGRATIONS. Never reorder/delete
//      existing entries — that breaks any DB in the field already
//      advanced past your insertion point.
//   2. Each migration is wrapped in a transaction, so a throw rolls
//      back the entire change atomically and leaves user_version
//      unchanged.
//   3. Make data-touching logic idempotent where you can; even with
//      transactional rollback, an inconsistent half-migration on
//      disk is safer to retry than to assume.
const MIGRATIONS = [
  // v0 → v1: pulls every legacy DB up to today's baseline. Idempotent
  // so DBs that pre-date user_version tracking (and have already had
  // these columns added by the old best-effort migration) pass
  // through cleanly.
  (database) => {
    addColumnIfMissing(database, 'collections', 'order_index', 'INTEGER DEFAULT 0');
    // Seed order_index in created_at order so existing buckets keep
    // their visual order. Only fires when no row has been ordered
    // (avoids re-shuffling on a re-migrate against an already-seeded
    // table).
    const ordered = database
      .prepare('SELECT COUNT(*) AS n FROM collections WHERE order_index > 0')
      .get().n;
    if (ordered === 0) {
      const rows = database.prepare('SELECT id FROM collections ORDER BY created_at ASC').all();
      const stmt = database.prepare('UPDATE collections SET order_index = ? WHERE id = ?');
      rows.forEach((r, i) => stmt.run(i, r.id));
    }
    addColumnIfMissing(database, 'saves', 'ai_description', 'TEXT');
    addColumnIfMissing(database, 'saves', 'embedding', 'BLOB');
    addColumnIfMissing(database, 'saves', 'ocr_text', 'TEXT');
    addColumnIfMissing(database, 'saves', 'ai_prompt', 'TEXT');
    addColumnIfMissing(database, 'saves', 'deleted_at', 'INTEGER');
    // Generic per-save metadata as JSON. Used today for tag-specific
    // extras (e.g. the "font" tag stores name/designer/buy_url here).
    addColumnIfMissing(database, 'saves', 'meta', 'TEXT');
    addColumnIfMissing(database, 'saves', 'notes', 'TEXT');
    // One level of bucket nesting; cascade-on-delete handled in
    // application code (SQLite ALTER doesn't allow REFERENCES).
    addColumnIfMissing(database, 'collections', 'parent_id', 'TEXT');
  },
  // v1 → v2: SHA-256 of the original bytes per save. Powers the
  // "already in your library" duplicate-on-save toast. New rows get
  // a hash from the storage layer; existing rows are filled in by a
  // background backfill kicked off after init (see backfillContentHashes).
  (database) => {
    addColumnIfMissing(database, 'saves', 'content_hash', 'TEXT');
    database.exec(
      'CREATE INDEX IF NOT EXISTS idx_saves_content_hash ON saves(content_hash)',
    );
  },
  // v2 → v3: precomputed LAB triplets for every palette swatch. The
  // color filter and "find similar" path used to call hexToLab on
  // every swatch on every save on every keystroke; storing the
  // conversion once at save time turns those into a JSON.parse.
  (database) => {
    addColumnIfMissing(database, 'saves', 'palette_lab', 'TEXT');
    const rows = database
      .prepare('SELECT id, palette FROM saves WHERE palette IS NOT NULL AND palette_lab IS NULL')
      .all();
    if (rows.length === 0) return;
    const upd = database.prepare('UPDATE saves SET palette_lab = ? WHERE id = ?');
    const txn = database.transaction((items) => {
      for (const r of items) {
        let pal;
        try { pal = JSON.parse(r.palette); } catch { continue; }
        if (!Array.isArray(pal)) continue;
        const labs = pal.map(hexToLab).filter(Boolean);
        if (labs.length === 0) continue;
        upd.run(JSON.stringify(labs), r.id);
      }
    });
    txn(rows);
  },
  // v? → next: boards.order_index for drag-to-reorder on the Spaces
  // grid. Mirrors collections.order_index — seed existing rows in
  // created_at order so the first launch after upgrade preserves
  // current visual order.
  (database) => {
    addColumnIfMissing(database, 'boards', 'order_index', 'INTEGER DEFAULT 0');
    const ordered = database
      .prepare('SELECT COUNT(*) AS n FROM boards WHERE order_index > 0')
      .get().n;
    if (ordered === 0) {
      const rows = database.prepare('SELECT id FROM boards ORDER BY created_at ASC').all();
      const stmt = database.prepare('UPDATE boards SET order_index = ? WHERE id = ?');
      rows.forEach((r, i) => stmt.run(i, r.id));
    }
  },
  // v? → next: saves.kind to distinguish URL-kind saves (saved
  // websites) from the original image saves. Existing rows default
  // to 'image'; new URL saves carry kind='url' so FocusedView can
  // swap the <img> for a live <webview> at view time.
  (database) => {
    addColumnIfMissing(database, 'saves', 'kind', "TEXT NOT NULL DEFAULT 'image'");
  },
  // X-bookmark capture: holds the source tweet's author + handle +
  // avatar + caption + every image URL on the tweet so the detail
  // panel can render a glass tweet card and let the user click any
  // image on the tweet to swap into the focused view. Stored as
  // JSON so future Twitter / X / Bluesky / Threads payloads can
  // share the same field without another migration.
  (database) => {
    addColumnIfMissing(database, 'saves', 'tweet_meta', 'TEXT');
  },
  // Multi-source capture: a `source` column tags each save with its
  // origin — 'x' (X bookmarks, the original capture surface) or
  // 'instagram' (Instagram saved posts). Defaults to 'x' so every
  // existing row reads as an X/native save with no data touch. The
  // per-source structured payload keeps living in the existing
  // tweet_meta JSON column, which was always intended to be source-
  // agnostic (see the migration above) — so we generalize by adding a
  // discriminator rather than renaming the column, leaving the working
  // X read/write path untouched.
  (database) => {
    addColumnIfMissing(database, 'saves', 'source', "TEXT NOT NULL DEFAULT 'x'");
  },
  // Backfill source for Instagram saves imported before the source column
  // (and native-host forwarding) landed — they defaulted to 'x' and so
  // showed the X badge in the grid instead of the Instagram one. Their
  // permalink is an instagram.com URL, which distinguishes them. Idempotent.
  (database) => {
    database.prepare(
      "UPDATE saves SET source = 'instagram' WHERE source = 'x' AND source_url LIKE '%instagram.com%'",
    ).run();
  },
  // Rename the namespaced auto-tags to plain words: 'x:bookmark' →
  // 'bookmark', 'instagram:save' → 'instagram'. If the plain name already
  // exists (e.g. a user-made tag), merge into it — repoint every edge then
  // drop the old row — so the UNIQUE(name) constraint holds. Idempotent.
  (database) => {
    const rename = (from, to) => {
      const old = database.prepare('SELECT id FROM tags WHERE name = ?').get(from);
      if (!old) return;
      const existing = database.prepare('SELECT id FROM tags WHERE name = ?').get(to);
      if (existing) {
        database.prepare(
          'INSERT OR IGNORE INTO save_tags (save_id, tag_id) SELECT save_id, ? FROM save_tags WHERE tag_id = ?',
        ).run(existing.id, old.id);
        database.prepare('DELETE FROM save_tags WHERE tag_id = ?').run(old.id);
        database.prepare('DELETE FROM tags WHERE id = ?').run(old.id);
      } else {
        database.prepare('UPDATE tags SET name = ? WHERE id = ?').run(to, old.id);
      }
    };
    rename('x:bookmark', 'bookmark');
    rename('instagram:save', 'instagram');
  },
  // Variant model groundwork (Phase 1). A medium "preview" render that
  // sits between the 400px thumb and the full original — the focused
  // view / peek will use it, and it's the local file the cloud layer
  // keeps when originals are offloaded. Nullable: existing saves have
  // none, and resolveAsset() falls back to the original until one is
  // generated, so this migration is purely additive and invisible.
  (database) => {
    addColumnIfMissing(database, 'saves', 'preview_path', 'TEXT');
  },
  // Per-save view counter — bumped when a save opens in the focused
  // view. Powers the grid's "Most viewed" sort.
  (database) => {
    addColumnIfMissing(database, 'saves', 'view_count', 'INTEGER NOT NULL DEFAULT 0');
  },
  // Partial index covering the hot list query: nearly every fetch
  // filters deleted_at IS NULL and orders by created_at DESC. The bare
  // created_at index can't serve the filter; this serves both at once.
  (database) => {
    database.exec(
      'CREATE INDEX IF NOT EXISTS idx_saves_live_created ON saves (created_at DESC) WHERE deleted_at IS NULL',
    );
  },
  // FTS5 shadow table for text search. The LIKE pass scanned every row
  // and json_extract-parsed tweet_meta per row PER KEYSTROKE — fine at
  // 2k saves, the wall at 20k. Triggers keep it in sync with saves;
  // tag-name matching stays in plain SQL (tags is a small table).
  // Tokenizer note: FTS matches token prefixes ("mou" → mountain), not
  // mid-word substrings — accepted trade for indexed lookups.
  (database) => {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS saves_fts USING fts5(
        save_id UNINDEXED,
        title,
        ocr_text,
        tweet_text,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS saves_fts_ai AFTER INSERT ON saves BEGIN
        INSERT INTO saves_fts (save_id, title, ocr_text, tweet_text)
        VALUES (
          new.id,
          COALESCE(new.title, ''),
          COALESCE(new.ocr_text, ''),
          COALESCE(json_extract(new.tweet_meta,'$.caption'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.authorName'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.authorHandle'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.thread'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.quoted.caption'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.quoted.authorName'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.quoted.authorHandle'),'')
        );
      END;
      CREATE TRIGGER IF NOT EXISTS saves_fts_ad AFTER DELETE ON saves BEGIN
        DELETE FROM saves_fts WHERE save_id = old.id;
      END;
      CREATE TRIGGER IF NOT EXISTS saves_fts_au
      AFTER UPDATE OF title, ocr_text, tweet_meta ON saves BEGIN
        DELETE FROM saves_fts WHERE save_id = new.id;
        INSERT INTO saves_fts (save_id, title, ocr_text, tweet_text)
        VALUES (
          new.id,
          COALESCE(new.title, ''),
          COALESCE(new.ocr_text, ''),
          COALESCE(json_extract(new.tweet_meta,'$.caption'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.authorName'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.authorHandle'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.thread'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.quoted.caption'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.quoted.authorName'),'') || ' ' ||
          COALESCE(json_extract(new.tweet_meta,'$.quoted.authorHandle'),'')
        );
      END;
    `);
    // Backfill existing rows once; triggers own it from here.
    database.exec(`
      INSERT INTO saves_fts (save_id, title, ocr_text, tweet_text)
      SELECT id, COALESCE(title, ''), COALESCE(ocr_text, ''),
        COALESCE(json_extract(saves.tweet_meta,'$.caption'),'') || ' ' ||
          COALESCE(json_extract(saves.tweet_meta,'$.authorName'),'') || ' ' ||
          COALESCE(json_extract(saves.tweet_meta,'$.authorHandle'),'') || ' ' ||
          COALESCE(json_extract(saves.tweet_meta,'$.thread'),'') || ' ' ||
          COALESCE(json_extract(saves.tweet_meta,'$.quoted.caption'),'') || ' ' ||
          COALESCE(json_extract(saves.tweet_meta,'$.quoted.authorName'),'') || ' ' ||
          COALESCE(json_extract(saves.tweet_meta,'$.quoted.authorHandle'),'')
      FROM saves;
    `);
  },
  // FTS repair: the triggers/backfill above call json_extract on
  // tweet_meta directly, and json_extract THROWS on any malformed-JSON
  // value. A single legacy/corrupt tweet_meta row therefore aborted the
  // one-time backfill, leaving every pre-existing save unindexed (and so
  // unsearchable — a save's own title/caption wouldn't match). Guard
  // every extraction with json_valid so a bad row yields '' instead of
  // throwing, recreate the triggers, and rebuild the index so already-
  // broken libraries recover on this launch.
  (database) => {
    const safe = (col) => `(CASE WHEN json_valid(${col}) THEN ${col} END)`;
    const tweetText = (col) => `
      COALESCE(json_extract(${safe(col)},'$.caption'),'') || ' ' ||
      COALESCE(json_extract(${safe(col)},'$.authorName'),'') || ' ' ||
      COALESCE(json_extract(${safe(col)},'$.authorHandle'),'') || ' ' ||
      COALESCE(json_extract(${safe(col)},'$.thread'),'') || ' ' ||
      COALESCE(json_extract(${safe(col)},'$.quoted.caption'),'') || ' ' ||
      COALESCE(json_extract(${safe(col)},'$.quoted.authorName'),'') || ' ' ||
      COALESCE(json_extract(${safe(col)},'$.quoted.authorHandle'),'')`;
    database.exec(`
      DROP TRIGGER IF EXISTS saves_fts_ai;
      DROP TRIGGER IF EXISTS saves_fts_au;
      CREATE TRIGGER saves_fts_ai AFTER INSERT ON saves BEGIN
        INSERT INTO saves_fts (save_id, title, ocr_text, tweet_text)
        VALUES (new.id, COALESCE(new.title,''), COALESCE(new.ocr_text,''), ${tweetText('new.tweet_meta')});
      END;
      CREATE TRIGGER saves_fts_au
      AFTER UPDATE OF title, ocr_text, tweet_meta ON saves BEGIN
        DELETE FROM saves_fts WHERE save_id = new.id;
        INSERT INTO saves_fts (save_id, title, ocr_text, tweet_text)
        VALUES (new.id, COALESCE(new.title,''), COALESCE(new.ocr_text,''), ${tweetText('new.tweet_meta')});
      END;
      DELETE FROM saves_fts;
      INSERT INTO saves_fts (save_id, title, ocr_text, tweet_text)
      SELECT id, COALESCE(title,''), COALESCE(ocr_text,''), ${tweetText('saves.tweet_meta')}
      FROM saves;
    `);
  },
  // Last-viewed timestamp, so the command palette can show a
  // "Recently viewed" strip ordered by when each save was opened.
  (database) => {
    addColumnIfMissing(database, 'saves', 'viewed_at', 'INTEGER');
  },
  // Repair older X saves whose extension payload predated tweetCreatedAt.
  (database) => {
    repairMissingXTweetCreatedAt(database);
  },
  // Stable social-post identity. Keep every existing row; assign only the
  // oldest active copy so future active duplicates can be rejected safely.
  (database) => {
    addColumnIfMissing(database, 'saves', 'source_key', 'TEXT');
    const rows = database.prepare(`
      SELECT id, source_url
        FROM saves
       WHERE deleted_at IS NULL AND source_url IS NOT NULL AND tweet_meta IS NOT NULL
       ORDER BY created_at ASC, id ASC
    `).all();
    const claimed = new Set();
    const assign = database.prepare('UPDATE saves SET source_key = ? WHERE id = ?');
    for (const row of rows) {
      const key = sourceKeyFromUrl(row.source_url);
      if (!key || claimed.has(key)) continue;
      claimed.add(key);
      assign.run(key, row.id);
    }
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_saves_active_source_key
        ON saves(source_key)
       WHERE deleted_at IS NULL AND source_key IS NOT NULL;
    `);
  },
];

function repairMissingXTweetCreatedAt(database) {
  const rows = database.prepare(`
    SELECT id, source_url, tweet_meta
      FROM saves
     WHERE source != 'instagram'
       AND source_url LIKE '%/status/%'
  `).all();
  const update = database.prepare('UPDATE saves SET tweet_meta = ? WHERE id = ?');
  let repaired = 0;
  for (const row of rows) {
    let meta;
    try {
      meta = row.tweet_meta ? JSON.parse(row.tweet_meta) : {};
    } catch {
      continue;
    }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
    const existing = Number(meta.tweetCreatedAt);
    if (Number.isFinite(existing) && existing > 0) continue;
    const derived = deriveXTweetCreatedAt(row.source_url);
    if (derived === null) continue;
    update.run(JSON.stringify({ ...meta, tweetCreatedAt: derived }), row.id);
    repaired += 1;
  }
  return repaired;
}

function addColumnIfMissing(database, table, name, type) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find((c) => c.name === name)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

function migrate() {
  const currentVersion = db.pragma('user_version', { simple: true });
  const targetVersion = MIGRATIONS.length;
  if (currentVersion >= targetVersion) return;

  // One copy-on-disk before applying any unapplied migrations, in case
  // a downstream change in the queue corrupts the file. Backup is best-
  // effort: if it fails (no disk, permissions), we log and proceed —
  // the per-migration transaction is the real safety net.
  if (databaseHasUserData()) {
    backupDatabaseBeforeMigrate(currentVersion);
  }

  for (let v = currentVersion; v < targetVersion; v++) {
    const fn = MIGRATIONS[v];
    if (!fn) {
      db.pragma(`user_version = ${v + 1}`);
      continue;
    }
    try {
      const apply = db.transaction(() => {
        fn(db);
        db.pragma(`user_version = ${v + 1}`);
      });
      apply();
    } catch (err) {
      console.error(`[db] migration v${v} → v${v + 1} failed:`, err.message);
      // Rethrow so the app surfaces the failure rather than booting
      // into a half-migrated DB. The transaction has already rolled
      // back; user_version remains at the prior value.
      throw err;
    }
  }
}

function databaseHasUserData() {
  // Brand-new databases skip the backup — there's nothing to lose,
  // and the file may not even exist on disk yet on first run.
  try {
    const file = getDatabasePath();
    if (!fs.existsSync(file)) return false;
    const stat = fs.statSync(file);
    if (stat.size < 4096) return false;
    const row = db.prepare('SELECT COUNT(*) AS n FROM saves').get();
    return row.n > 0;
  } catch {
    return false;
  }
}

function backupDatabaseBeforeMigrate(fromVersion) {
  try {
    const file = getDatabasePath();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.pre-v${fromVersion + 1}.${stamp}.bak`;
    fs.copyFileSync(file, backup);
    console.log(`[db] migration backup written: ${path.basename(backup)}`);
  } catch (err) {
    console.error('[db] migration backup failed (continuing):', err.message);
  }
}

function getDatabase() {
  if (!db) return initDatabase();
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
  // The cache belongs to the closed library's DB.
  invalidateEmbeddingCache();
}

// Closes the current handle and reopens against whatever library
// is now active in the registry. Called by the library-switch IPC
// after the registry's active id has been flipped.
function reopenDatabase() {
  closeDatabase();
  return initDatabase();
}

function insertSave({
  id,
  filePath,
  thumbPath,
  width,
  height,
  fileSize,
  sourceUrl,
  sourceKey,
  title,
  // Optional pre-populated notes — currently set by the X-bookmark
  // capture path with the tweet's caption text so the user sees the
  // tweet context in the detail panel right after the save lands.
  // The notes column is added via the saves-notes migration in
  // MIGRATIONS, so it's safe to write to here unconditionally.
  notes,
  // X-bookmark capture only. Object with keys authorName, authorHandle,
  // authorAvatarUrl, caption, imageUrls — see the content script
  // (extension/content/x-bookmark-watcher.js) and DetailPanel's tweet
  // card section for the consumer.
  tweetMeta,
  palette,
  contentHash,
  kind,
  // Capture origin — 'x' (default) or 'instagram'. Drives the per-card
  // source badge and the combined "Saved" view filter.
  source,
  // Optional explicit creation timestamp. Defaults to now. The extension
  // sync passes a descending clock so a newest-first social stream keeps
  // its order (newest social = newest in the app) instead of inverting.
  createdAt,
} = {}) {
  const db = getDatabase();
  const paletteArr = Array.isArray(palette) && palette.length ? palette : null;
  // Pre-compute LAB once on insert. filterByColor and the similar-by-
  // palette query both used to recompute these per swatch per call;
  // doing it once at save time pays off on the second filter onwards.
  const paletteLabArr = paletteArr
    ? paletteArr.map(hexToLab).filter(Boolean)
    : null;
  const record = {
    id: id || crypto.randomUUID(),
    file_path: filePath,
    thumb_path: thumbPath,
    title: title || null,
    notes: notes || null,
    source_url: sourceUrl || null,
    source_key: tweetMeta ? (sourceKey || sourceKeyFromUrl(sourceUrl) || null) : null,
    width: width || null,
    height: height || null,
    file_size: fileSize || null,
    palette: paletteArr ? JSON.stringify(paletteArr) : null,
    palette_lab: paletteLabArr && paletteLabArr.length
      ? JSON.stringify(paletteLabArr)
      : null,
    content_hash: contentHash || null,
    kind: kind || 'image',
    tweet_meta: tweetMeta ? JSON.stringify(tweetMeta) : null,
    source: source || 'x',
    created_at: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
  db.prepare(`
    INSERT INTO saves
      (id, file_path, thumb_path, title, notes, source_url, source_key, width, height, file_size, palette, palette_lab, content_hash, kind, tweet_meta, source, created_at)
    VALUES
      (@id, @file_path, @thumb_path, @title, @notes, @source_url, @source_key, @width, @height, @file_size, @palette, @palette_lab, @content_hash, @kind, @tweet_meta, @source, @created_at)
  `).run(record);
  return record;
}

// Image saves eligible for the "reclaim space" sweep — non-trashed,
// non-video/url rows with a file on disk. The caller decides per row
// whether re-encoding actually saves space (and skips animated images).
function getReclaimableSaves() {
  return getDatabase()
    .prepare(
      `SELECT id, file_path, file_size
         FROM saves
        WHERE deleted_at IS NULL
          AND file_path IS NOT NULL
          AND kind NOT IN ('video', 'url')`,
    )
    .all();
}

// Repoint a save at its newly-optimized file. Used by the reclaim sweep
// after it has written + verified the optimized image. content_hash is
// deliberately left alone — it identifies the original source bytes for
// dedup, not the stored file.
function updateSaveStorage(id, { filePath, fileSize, width, height } = {}) {
  getDatabase()
    .prepare(
      `UPDATE saves
          SET file_path = @file_path, file_size = @file_size,
              width = @width, height = @height
        WHERE id = @id`,
    )
    .run({
      id,
      file_path: filePath,
      file_size: fileSize ?? null,
      width: width ?? null,
      height: height ?? null,
    });
}

// Find a non-trashed save by its SHA-256 hash. Returns the row or
// undefined. Trashed dupes are ignored on purpose — re-saving a
// previously-deleted image should produce a fresh entry rather than
// silently linking the user to a record they tossed.
function findSaveByHash(hash) {
  if (!hash) return undefined;
  const db = getDatabase();
  return db
    .prepare(
      'SELECT * FROM saves WHERE content_hash = ? AND deleted_at IS NULL LIMIT 1',
    )
    .get(hash);
}

// Iterate rows that pre-date the content_hash column and fill in
// hashes from disk. Called once after init from a background task —
// libraries with thousands of images can take a few seconds, so we
// chunk and yield to avoid stalling the main thread's event loop.
async function backfillContentHashes({ batchSize = 50 } = {}) {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT id, file_path FROM saves WHERE content_hash IS NULL')
    .all();
  if (rows.length === 0) return 0;

  const fs = require('node:fs');
  const update = db.prepare('UPDATE saves SET content_hash = ? WHERE id = ?');
  let filled = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const tx = db.transaction(() => {
      for (const row of slice) {
        try {
          if (!fs.existsSync(row.file_path)) continue;
          const buf = fs.readFileSync(row.file_path);
          const hash = crypto.createHash('sha256').update(buf).digest('hex');
          update.run(hash, row.id);
          filled += 1;
        } catch (err) {
          console.error('[gatheros] hash backfill failed for', row.id, err.message);
        }
      }
    });
    tx();
    // Yield so the renderer's startup work isn't starved.
    await new Promise((r) => setImmediate(r));
  }
  return filled;
}

// ── Color search helpers ──────────────────────────────────────────────────
// Convert sRGB hex → CIELAB so we can measure perceptual distance.
// "Looks similar" in screen colors maps poorly to RGB Manhattan; LAB
// matches what designers mean when they say "find me anything in this
// red".

function hexToRgb(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function rgbToLab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  // sRGB → XYZ (D65)
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750) / 1.00000;
  const z = (lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(a, b) {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );
}

function hexToLab(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToLab(rgb[0], rgb[1], rgb[2]) : null;
}

// Parse the precomputed palette_lab JSON off a save row. Returns
// null on malformed / missing data so callers can fall through to
// regenerating from `palette`.
function parseStoredLabs(row) {
  if (!row || !row.palette_lab) return null;
  try {
    const parsed = JSON.parse(row.palette_lab);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch { return null; }
}

// Fallback: rebuild the LAB triplets from the legacy `palette` JSON
// for rows that haven't been backfilled yet.
function labsFromPalette(paletteJson) {
  if (!paletteJson) return null;
  let pal;
  try { pal = JSON.parse(paletteJson); } catch { return null; }
  if (!Array.isArray(pal)) return null;
  const labs = pal.map(hexToLab).filter(Boolean);
  return labs.length ? labs : null;
}

// Returns id only — palette filter runs in JS over the parsed swatches,
// applied as a post-filter on top of the SQL conditions below.
//
// `paletteLimit` is for the color-name search path (e.g. "blue") where
// we want strict "this image is dominated by that color" semantics —
// not "there's some near-grey in a shadow that happens to be near
// blue". Defaults to null = check every swatch (chip-click filter).
function filterByColor(saves, hex, threshold = 22, paletteLimit = null) {
  const target = hexToLab(hex);
  if (!target) return saves;
  return saves.filter((s) => {
    const labs = parseStoredLabs(s) || labsFromPalette(s.palette);
    if (!labs || labs.length === 0) return false;
    const swatches = paletteLimit ? labs.slice(0, paletteLimit) : labs;
    return swatches.some((lab) => deltaE76(target, lab) <= threshold);
  });
}

// view: 'all' (default — excludes trashed), 'unsorted' (no bucket
// membership, excludes trashed), or 'trash' (only trashed).
// Find saves that look like the anchor based on palette alone — no
// AI required. For each anchor swatch we take the closest swatch in
// the candidate's palette (ΔE76 in LAB) and average those distances;
// smaller average = more similar. Skips deleted rows and the anchor
// itself. Returns full save records sorted ascending by score.
function findSimilarByPalette(anchorId, limit = 24) {
  if (!anchorId) return [];
  const anchor = getSave(anchorId);
  if (!anchor) return [];
  // Pull anchor LABs from the precomputed column when available;
  // otherwise reconstruct from `palette` (covers the brief window
  // between schema upgrade and migration backfill, plus rows missing
  // a palette entirely).
  const anchorLabs = parseStoredLabs(anchor) || labsFromPalette(anchor.palette);
  if (!anchorLabs || anchorLabs.length === 0) return [];

  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT id, palette, palette_lab FROM saves WHERE deleted_at IS NULL AND id != ? AND palette IS NOT NULL',
    )
    .all(anchorId);

  const scored = [];
  for (const row of rows) {
    const labs = parseStoredLabs(row) || labsFromPalette(row.palette);
    if (!labs || labs.length === 0) continue;
    let total = 0;
    for (const a of anchorLabs) {
      let best = Infinity;
      for (const b of labs) {
        const d = deltaE76(a, b);
        if (d < best) best = d;
      }
      total += best;
    }
    scored.push({ id: row.id, score: total / anchorLabs.length });
  }

  // Hard cap on average ΔE — beyond ~28 the palettes have nothing
  // meaningful in common and the suggestions read as random.
  scored.sort((a, b) => a.score - b.score);
  const ids = scored
    .filter((s) => s.score <= 28)
    .slice(0, Math.max(1, Math.min(limit, 60)))
    .map((s) => s.id);
  if (ids.length === 0) return [];
  const records = getSavesByIds(ids);
  const orderById = new Map(ids.map((id, i) => [id, i]));
  records.sort((a, b) => orderById.get(a.id) - orderById.get(b.id));
  return records;
}

// Columns shipped to the renderer for list views — everything EXCEPT
// the search-only heavies the UI never reads: embedding (a ~6 KB
// Float32 BLOB per save), ocr_text and ai_description. With SELECT *,
// every grid reload serialized megabytes of them over IPC. palette_lab
// stays: filterByColor reads it off these rows before they leave the
// main process (it's a few dozen bytes of JSON). The semantic path has
// its own getSaveEmbeddings() query and is unaffected.
const SAVE_LIST_COLUMNS = [
  'id', 'file_path', 'thumb_path', 'title', 'source_url', 'width',
  'height', 'file_size', 'palette', 'palette_lab', 'created_at',
  'ai_prompt', 'deleted_at', 'meta', 'notes', 'content_hash', 'kind',
  'tweet_meta', 'source', 'preview_path', 'view_count',
].join(', ');

// Sanitize free text into an FTS5 phrase-prefix query: each whitespace
// term becomes "term"* (quotes doubled), joined with implicit AND.
// Returns null when nothing tokenizable remains.
function ftsPrefixQuery(text) {
  const terms = String(text)
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '""').trim())
    .filter(Boolean);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"*`).join(' ');
}

function getAllSaves({ search = '', sort = 'newest', collectionId = null, colorHex = null, view = 'all', _noFts = false } = {}) {
  const db = getDatabase();
  const conditions = [];
  const params = [];

  // Parse `tag:`, `bucket:`, `color:`, `is:untagged`, `before:`, `after:`
  // out of the search string so the SQL applies them directly. The
  // remaining `text` is what runs through the substring LIKE pass.
  const { parseSearchQuery } = require('./searchQuery');
  const parsed = parseSearchQuery(search);
  const text = parsed.text;
  // Explicit color: filter wins over any caller-passed colorHex
  // because the user typed it directly.
  const effectiveColorHex = parsed.colorHex || colorHex;

  if (view === 'trash') {
    conditions.push('deleted_at IS NOT NULL');
  } else {
    conditions.push('deleted_at IS NULL');
    if (view === 'unsorted') {
      conditions.push('id NOT IN (SELECT save_id FROM collection_items)');
    } else if (view === 'bookmarks') {
      // The combined "Saved" view — saves captured from X (tagged
      // 'bookmark') or Instagram (tagged 'instagram'). The legacy
      // namespaced tags are kept in the filter as a safety net for any
      // row a tag-rename migration didn't reach. The view key stays
      // 'bookmarks' for back-compat; the chip label reads "Saved".
      conditions.push(`id IN (
        SELECT save_id FROM save_tags
        JOIN tags ON save_tags.tag_id = tags.id
        WHERE tags.name IN ('bookmark', 'instagram', 'x:bookmark', 'instagram:save')
      )`);
    } else if (view === 'onThisDay') {
      // Same calendar month + day as today, in any prior year. Local
      // time so a save made yesterday at 11pm doesn't slip into the
      // wrong bucket because of UTC math. Excludes today's saves so
      // the view reads as 'memories', not 'recent activity'.
      conditions.push(
        "strftime('%m-%d', created_at / 1000, 'unixepoch', 'localtime')"
        + " = strftime('%m-%d', 'now', 'localtime')",
      );
      conditions.push(
        "strftime('%Y', created_at / 1000, 'unixepoch', 'localtime')"
        + " < strftime('%Y', 'now', 'localtime')",
      );
    }
  }

  if (collectionId) {
    // Roll-up semantics: a parent collection CONTAINS its children, so
    // its view shows direct members plus every child's members (the IN
    // over both dedups naturally). One level deep, like the schema.
    conditions.push(`id IN (
      SELECT save_id FROM collection_items
      WHERE collection_id = ?
         OR collection_id IN (SELECT id FROM collections WHERE parent_id = ?)
    )`);
    params.push(collectionId, collectionId);
  }

  // tag:<name> — INNER JOIN through save_tags. Multiple tag filters
  // AND together so `tag:serif tag:minimal` returns the intersection.
  for (const name of parsed.tagNames) {
    conditions.push(`id IN (
      SELECT save_id FROM save_tags
      JOIN tags ON save_tags.tag_id = tags.id
      WHERE tags.name = ?
    )`);
    params.push(name);
  }

  // bucket:<name> — resolve via collections.name (case-insensitive).
  // Multiple bucket filters intersect, same as tags.
  for (const name of parsed.bucketNames) {
    // Same roll-up as the collectionId filter: collection:"Branding"
    // matches saves filed in Branding OR any of its children.
    conditions.push(`id IN (
      SELECT save_id FROM collection_items
      WHERE collection_id IN (
        SELECT id FROM collections WHERE LOWER(name) = ?
        UNION
        SELECT id FROM collections WHERE parent_id IN (SELECT id FROM collections WHERE LOWER(name) = ?)
      )
    )`);
    params.push(name, name);
  }

  if (parsed.untagged) {
    conditions.push('id NOT IN (SELECT save_id FROM save_tags WHERE save_id IS NOT NULL)');
  }

  if (parsed.before != null) {
    conditions.push('created_at < ?');
    params.push(parsed.before);
  }
  if (parsed.after != null) {
    conditions.push('created_at > ?');
    params.push(parsed.after);
  }

  if (text) {
    // Indexed FTS5 match over title / ocr_text / tweet text (the old
    // LIKE pass full-scanned the table and json_extract-parsed
    // tweet_meta per row on every keystroke). ai_description stays
    // intentionally excluded — descriptions enumerate every visible
    // object, so matching them turns "sky" into a 50% hit rate.
    // Tag-name matching keeps the substring LIKE (tags is tiny).
    // ftsQuery is null for punctuation-only input; _noFts is the
    // fallback escape hatch if an FTS query ever errors at run time.
    const ftsQuery = _noFts ? null : ftsPrefixQuery(text);
    if (ftsQuery) {
      conditions.push(`(id IN (SELECT save_id FROM saves_fts WHERE saves_fts MATCH ?)
        OR id IN (
          SELECT save_id FROM save_tags
          JOIN tags ON save_tags.tag_id = tags.id
          WHERE tags.name LIKE ?
        ))`);
      params.push(ftsQuery, `%${text}%`);
    } else {
      conditions.push(`(title LIKE ? OR ocr_text LIKE ?
        OR json_extract(tweet_meta, '$.caption') LIKE ?
        OR json_extract(tweet_meta, '$.authorName') LIKE ?
        OR json_extract(tweet_meta, '$.authorHandle') LIKE ?
        OR json_extract(tweet_meta, '$.thread') LIKE ?
        OR json_extract(tweet_meta, '$.quoted.caption') LIKE ?
        OR json_extract(tweet_meta, '$.quoted.authorName') LIKE ?
        OR json_extract(tweet_meta, '$.quoted.authorHandle') LIKE ?
        OR id IN (
          SELECT save_id FROM save_tags
          JOIN tags ON save_tags.tag_id = tags.id
          WHERE tags.name LIKE ?
        ))`);
      const like = `%${text}%`;
      params.push(like, like, like, like, like, like, like, like, like, like);
    }
  }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const recency = sort === 'oldest' ? 'created_at ASC' : 'created_at DESC';
  let order;
  if (text) {
    // Relevance first: a save the user literally NAMED like the query
    // should outrank items that only mention it in a tweet caption or
    // OCR text. Exact title → prefix → any-substring → everything else,
    // then the chosen recency sort within each tier. The ORDER BY params
    // are bound after the WHERE params (positional), so push them here.
    order = ` ORDER BY
      CASE
        WHEN LOWER(COALESCE(title,'')) = LOWER(?) THEN 0
        WHEN LOWER(COALESCE(title,'')) LIKE LOWER(?) || '%' THEN 1
        WHEN LOWER(COALESCE(title,'')) LIKE '%' || LOWER(?) || '%' THEN 2
        ELSE 3
      END, ${recency}`;
    params.push(text, text, text);
  } else {
    order = ` ORDER BY ${recency}`;
  }
  let rows;
  try {
    rows = db.prepare(`SELECT ${SAVE_LIST_COLUMNS} FROM saves${where}${order}`).all(...params);
  } catch (err) {
    // Belt-and-braces: a malformed FTS MATCH shouldn't be possible with
    // the sanitized phrase-prefix form, but if one slips through, run
    // the legacy LIKE pass rather than failing the whole search.
    if (!_noFts && text) {
      console.warn('[db] FTS search failed, falling back to LIKE:', err.message);
      return getAllSaves({ search, sort, collectionId, colorHex, view, _noFts: true });
    }
    throw err;
  }
  // Color filter: requested hex matched against each save's stored
  // palette in LAB space. Done in JS because SQLite doesn't have the
  // math we need; tractable up to a few thousand saves.
  return effectiveColorHex ? filterByColor(rows, effectiveColorHex) : rows;
}

// Fire-and-forget view bump. Deliberately does NOT emit save:updated —
// a view count changing shouldn't reflow the grid mid-session; the new
// order applies on the next reload.
function markSaveViewed(id) {
  if (!id) return;
  getDatabase()
    .prepare('UPDATE saves SET view_count = COALESCE(view_count, 0) + 1, viewed_at = ? WHERE id = ?')
    .run(Date.now(), id);
}

// Most-recently-opened saves, newest view first. Powers the command
// palette's "Recently viewed" strip. Only rows actually opened (a
// viewed_at timestamp) qualify.
function getRecentlyViewed(limit = 12) {
  const n = Math.max(1, Math.min(50, Number(limit) || 12));
  return getDatabase()
    .prepare(`SELECT ${SAVE_LIST_COLUMNS} FROM saves
       WHERE deleted_at IS NULL AND viewed_at IS NOT NULL
       ORDER BY viewed_at DESC LIMIT ?`)
    .all(n);
}

function getSave(id) {
  return getDatabase().prepare('SELECT * FROM saves WHERE id = ?').get(id);
}

// ── Tweet tombstones ─────────────────────────────────────────────
// A stable per-tweet key from a status permalink, e.g.
// https://x.com/foo/status/123 → 'tw:123'. Non-tweet URLs → null, so
// only X bookmarks ever get tombstoned.
function tweetKeyFromUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
  return m ? `tw:${m[1]}` : null;
}

// An Instagram permalink → a stable per-post key, e.g.
// https://www.instagram.com/p/Cabc123/ → 'ig:Cabc123'. Covers posts
// (/p/), reels (/reel/), and IGTV (/tv/). Non-IG URLs → null. The
// dismissed_tweets table is source-agnostic (keyed by an opaque
// string) so Instagram saves tombstone through the same machinery as
// X bookmarks — a deleted IG save won't come back on the next sync.
function igKeyFromUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
  return m ? `ig:${m[1]}` : null;
}

// Source-agnostic tombstone key — resolves an X status OR an Instagram
// post permalink to its key. Used by delete/restore so deletions stick
// for either source.
function sourceKeyFromUrl(url) {
  return tweetKeyFromUrl(url) || igKeyFromUrl(url);
}

function findActiveSaveBySourceKey(key) {
  if (!key) return undefined;
  return getDatabase().prepare(
    'SELECT * FROM saves WHERE source_key = ? AND deleted_at IS NULL LIMIT 1',
  ).get(key);
}

// Classify ordered X bookmark URLs against desktop save/tombstone history.
// Desktop DB remains boundary source; extension seen-set is intentionally
// excluded because baseline IDs may never have been saved.
function classifyXBookmarkUrls(tweetUrls) {
  if (!Array.isArray(tweetUrls)) throw new TypeError('tweetUrls must be an array');
  if (tweetUrls.length > 100) throw new RangeError('tweetUrls batch too large');
  if (tweetUrls.some((url) => typeof url !== 'string')) throw new TypeError('tweetUrls entries must be strings');

  const database = getDatabase();
  const keys = tweetUrls.map((url) => {
    const key = sourceKeyFromUrl(url);
    return key && key.startsWith('tw:') ? key : null;
  });
  const requestedKeys = [...new Set(keys.filter(Boolean))];
  const active = new Set();
  const dismissed = new Set();
  if (requestedKeys.length > 0) {
    const placeholders = requestedKeys.map(() => '?').join(', ');
    for (const row of database.prepare(`
      SELECT source_key FROM saves
       WHERE deleted_at IS NULL AND source_key IN (${placeholders})
    `).all(...requestedKeys)) active.add(row.source_key);
    for (const row of database.prepare(`
      SELECT tweet_key FROM dismissed_tweets
       WHERE tweet_key IN (${placeholders})
    `).all(...requestedKeys)) dismissed.add(row.tweet_key);
  }

  const hasKnownHistory = !!database.prepare(`
    SELECT 1 FROM saves
     WHERE deleted_at IS NULL AND source_key LIKE 'tw:%'
     LIMIT 1
  `).get() || !!database.prepare(`
    SELECT 1 FROM dismissed_tweets
     WHERE tweet_key LIKE 'tw:%'
     LIMIT 1
  `).get();
  const statuses = keys.map((key) => {
    if (!key) return 'new';
    if (dismissed.has(key)) return 'known-dismissed';
    if (active.has(key)) return 'known-active';
    return 'new';
  });
  return { hasKnownHistory, statuses };
}

function isTweetDismissed(key) {
  if (!key) return false;
  return !!getDatabase()
    .prepare('SELECT 1 FROM dismissed_tweets WHERE tweet_key = ?')
    .get(key);
}

function dismissTweet(key) {
  if (!key) return;
  getDatabase()
    .prepare('INSERT OR IGNORE INTO dismissed_tweets (tweet_key, dismissed_at) VALUES (?, ?)')
    .run(key, Date.now());
}

function undismissTweet(key) {
  if (!key) return;
  getDatabase().prepare('DELETE FROM dismissed_tweets WHERE tweet_key = ?').run(key);
}

// Soft delete: marks the row as trashed and severs every bucket
// membership in the same transaction. The image and thumbnail files
// stay on disk until the user permanently deletes from Trash (or
// empties Trash). Restoring from trash brings the save back as a
// bucket-less item — by design, deleting is treated as "this is no
// longer part of any collection," not just "hide it temporarily."
function deleteSave(id) {
  const db = getDatabase();
  const save = db.prepare('SELECT id, source_url FROM saves WHERE id = ?').get(id);
  if (!save) return { ok: false };
  // Tombstone the source post so the watcher doesn't re-capture it the
  // next time it scrolls into view. No-op for saves with no X/IG
  // permalink.
  dismissTweet(sourceKeyFromUrl(save.source_url));
  const tx = db.transaction(() => {
    db.prepare('UPDATE saves SET deleted_at = ? WHERE id = ?').run(Date.now(), id);
    db.prepare('DELETE FROM collection_items WHERE save_id = ?').run(id);
    // board_items reference saves via a JSON blob (data.saveId) so
    // there's no FK to cascade — trash any image item that points
    // at this save so it stops rendering on every board it was on.
    db.prepare(
      `DELETE FROM board_items
       WHERE type = 'image'
         AND json_extract(data, '$.saveId') = ?`
    ).run(id);
  });
  tx();
  return { ok: true };
}

function restoreSave(id) {
  const db = getDatabase();
  const save = db.prepare('SELECT source_url FROM saves WHERE id = ?').get(id);
  // Bringing a save back out of trash lifts its tombstone so it's
  // allowed to sync again.
  if (save) undismissTweet(sourceKeyFromUrl(save.source_url));
  db.prepare('UPDATE saves SET deleted_at = NULL WHERE id = ?').run(id);
  return { ok: true };
}

// Hard delete: removes the DB row and returns the file paths so the
// caller (ipc.js) can unlink the underlying files.
function permanentlyDeleteSave(id) {
  invalidateEmbeddingCache();
  const db = getDatabase();
  const save = db.prepare('SELECT file_path, thumb_path, source_url FROM saves WHERE id = ?').get(id);
  if (!save) return { ok: false };
  // Keep the tombstone for permanently-removed saves.
  dismissTweet(sourceKeyFromUrl(save.source_url));
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM board_items
       WHERE type = 'image'
         AND json_extract(data, '$.saveId') = ?`
    ).run(id);
    db.prepare('DELETE FROM saves WHERE id = ?').run(id);
  });
  tx();
  return { ok: true, filePath: save.file_path, thumbPath: save.thumb_path };
}

function emptyTrash() {
  invalidateEmbeddingCache();
  const db = getDatabase();
  const rows = db
    .prepare('SELECT id, file_path, thumb_path FROM saves WHERE deleted_at IS NOT NULL')
    .all();
  if (rows.length === 0) return { ok: true, files: [], ids: [] };
  const ids = rows.map((r) => r.id);
  const tx = db.transaction(() => {
    // Sweep any orphaned board_items whose saveId is among the
    // trashed rows we're about to nuke. (deleteSave already cleans
    // these up on trash, but be defensive in case anything slipped
    // past — e.g. saves trashed before this code shipped.)
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `DELETE FROM board_items
       WHERE type = 'image'
         AND json_extract(data, '$.saveId') IN (${placeholders})`
    ).run(...ids);
    db.prepare('DELETE FROM saves WHERE deleted_at IS NOT NULL').run();
  });
  tx();
  return {
    ok: true,
    ids,
    files: rows.map((r) => ({ filePath: r.file_path, thumbPath: r.thumb_path })),
  };
}

// Auto-purge variant: deletes only the trashed rows older than
// `cutoff` ms (deleted_at < cutoff). Honors the Settings →
// "Auto-empty trash" retention pref. Returns the same shape as
// emptyTrash so the caller can unlink the files.
function purgeTrashBefore(cutoff) {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT id, file_path, thumb_path FROM saves WHERE deleted_at IS NOT NULL AND deleted_at < ?',
    )
    .all(cutoff);
  if (rows.length === 0) return { ok: true, files: [], ids: [] };
  const ids = rows.map((r) => r.id);
  const tx = db.transaction(() => {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `DELETE FROM board_items
       WHERE type = 'image'
         AND json_extract(data, '$.saveId') IN (${placeholders})`
    ).run(...ids);
    db.prepare(
      `DELETE FROM saves WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    ).run(cutoff);
  });
  tx();
  return {
    ok: true,
    ids,
    files: rows.map((r) => ({ filePath: r.file_path, thumbPath: r.thumb_path })),
  };
}

// Nuclear "Erase Library" — wipes every save (including trashed
// ones), every bucket, every tag, in one transaction. Returns the
// list of file paths so ipc.js can unlink them off disk afterward.
// Caller is responsible for guarding behind a confirmation prompt.
function wipeLibrary() {
  invalidateEmbeddingCache();
  const db = getDatabase();
  const rows = db.prepare('SELECT file_path, thumb_path FROM saves').all();
  const tx = db.transaction(() => {
    // collection_items / save_tags / save_embeddings cascade off
    // saves and collections via the schema's ON DELETE CASCADE.
    // boards + board_items don't FK to saves (image references live
    // in JSON data), so wipe them explicitly — board_items cascades
    // off boards.
    db.prepare('DELETE FROM saves').run();
    db.prepare('DELETE FROM collections').run();
    db.prepare('DELETE FROM tags').run();
    db.prepare('DELETE FROM boards').run();
  });
  tx();
  return {
    ok: true,
    files: rows.map((r) => ({ filePath: r.file_path, thumbPath: r.thumb_path })),
  };
}

function updateSave({ id, title, sourceUrl, aiDescription, ocrText, aiPrompt, embedding, meta, notes } = {}) {
  const db = getDatabase();
  const fields = [];
  const params = [];
  if (title !== undefined) { fields.push('title = ?'); params.push(title); }
  if (sourceUrl !== undefined) { fields.push('source_url = ?'); params.push(sourceUrl); }
  if (aiDescription !== undefined) { fields.push('ai_description = ?'); params.push(aiDescription); }
  if (ocrText !== undefined) { fields.push('ocr_text = ?'); params.push(ocrText); }
  if (aiPrompt !== undefined) { fields.push('ai_prompt = ?'); params.push(aiPrompt); }
  if (embedding !== undefined) {
    fields.push('embedding = ?');
    params.push(embedding);
    invalidateEmbeddingCache();
  }
  if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }
  if (meta !== undefined) {
    // Accept either a JSON string or an object — better-sqlite3 only
    // binds primitives, so any object gets serialized here.
    const v = meta == null ? null : (typeof meta === 'string' ? meta : JSON.stringify(meta));
    fields.push('meta = ?'); params.push(v);
  }
  if (!fields.length) return { ok: true };
  params.push(id);
  db.prepare(`UPDATE saves SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return { ok: true };
}

// Returns id + embedding (BLOB) for every save that has one. Used by
// the semantic-search ranker to compute cosine sim in JS — fine up to
// a few thousand saves; revisit if that scales out.
// Counts that drive the sidebar's smart-view badges:
//   all:      all non-trashed saves
//   unsorted: non-trashed saves that aren't in any bucket
//   trash:    soft-deleted saves
function getSmartViewCounts() {
  const db = getDatabase();
  const all = db.prepare('SELECT COUNT(*) AS n FROM saves WHERE deleted_at IS NULL').get();
  const unsorted = db.prepare(`
    SELECT COUNT(*) AS n FROM saves
    WHERE deleted_at IS NULL
      AND id NOT IN (SELECT save_id FROM collection_items)
  `).get();
  const trash = db.prepare('SELECT COUNT(*) AS n FROM saves WHERE deleted_at IS NOT NULL').get();
  const bookmarks = db.prepare(`
    SELECT COUNT(*) AS n FROM saves
    WHERE deleted_at IS NULL
      AND id IN (
        SELECT save_id FROM save_tags
        JOIN tags ON save_tags.tag_id = tags.id
        WHERE tags.name IN ('bookmark', 'instagram', 'x:bookmark', 'instagram:save')
      )
  `).get();
  // Saves whose calendar date matches today in some prior year — same
  // condition the 'onThisDay' view applies in getAllSaves.
  const onThisDay = db.prepare(`
    SELECT COUNT(*) AS n FROM saves
    WHERE deleted_at IS NULL
      AND strftime('%m-%d', created_at / 1000, 'unixepoch', 'localtime')
        = strftime('%m-%d', 'now', 'localtime')
      AND strftime('%Y', created_at / 1000, 'unixepoch', 'localtime')
        < strftime('%Y', 'now', 'localtime')
  `).get();
  return {
    all: all?.n ?? 0,
    unsorted: unsorted?.n ?? 0,
    trash: trash?.n ?? 0,
    bookmarks: bookmarks?.n ?? 0,
    onThisDay: onThisDay?.n ?? 0,
  };
}

function getSaveEmbeddings() {
  return getDatabase()
    .prepare('SELECT id, embedding FROM saves WHERE embedding IS NOT NULL')
    .all();
}

// ── In-memory embedding cache ──────────────────────────────────────
// Semantic search and find-similar used to re-read and re-parse every
// embedding BLOB from SQLite on every query. Cache them once as
// pre-NORMALIZED Float32Arrays so cosine similarity reduces to a dot
// product. ~6 KB per save → ~60 MB at 10k saves, main-process only.
// Trashed saves stay in the cache on purpose: scored candidates are
// intersected with live rows downstream, and keeping them means a
// restore needs no invalidation.
let embeddingCache = null;

function invalidateEmbeddingCache() {
  embeddingCache = null;
}

function normalizeEmbedding(buf) {
  const src = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const out = new Float32Array(src.length);
  let norm = 0;
  for (let i = 0; i < src.length; i += 1) norm += src[i] * src[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < src.length; i += 1) out[i] = src[i] / norm;
  return out;
}

function getSaveEmbeddingsCached() {
  if (embeddingCache) return embeddingCache;
  embeddingCache = getSaveEmbeddings().map((r) => ({
    id: r.id,
    vec: normalizeEmbedding(r.embedding),
  }));
  return embeddingCache;
}

function getSavesByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  // Same renderer-bound column list as getAllSaves — these rows flow
  // straight to the grid as semantic-search candidates.
  return getDatabase()
    .prepare(`SELECT ${SAVE_LIST_COLUMNS} FROM saves WHERE id IN (${placeholders})`)
    .all(...ids);
}

// Saves that haven't been fully through the AI pipeline. Catches both
// "never processed" (embedding NULL) and "processed before a newer
// signal was added" (ocr_text NULL but embedding present). After a
// successful processing pass we set ocr_text to '' instead of NULL
// when no text is found, so re-runs don't keep re-processing the same
// rows forever.
const UNINDEXED_WHERE = 'embedding IS NULL OR ocr_text IS NULL';

function getUnindexedSaves() {
  return getDatabase()
    .prepare(`SELECT id, file_path, title FROM saves WHERE ${UNINDEXED_WHERE} ORDER BY created_at DESC`)
    .all();
}

function getUnindexedCount() {
  return getDatabase()
    .prepare(`SELECT COUNT(*) AS c FROM saves WHERE ${UNINDEXED_WHERE}`)
    .get().c;
}

// ── Collections ────────────────────────────────────────────────────────────

function getAllCollections() {
  // save_count rolls up: a parent counts its own members plus its
  // children's, deduped (a save in parent AND child counts once).
  return getDatabase().prepare(`
    SELECT c.id, c.name, c.color, c.created_at, c.order_index, c.parent_id,
           (SELECT COUNT(DISTINCT ci.save_id) FROM collection_items ci
             WHERE ci.collection_id = c.id
                OR ci.collection_id IN (SELECT id FROM collections k WHERE k.parent_id = c.id)
           ) AS save_count
    FROM collections c
    ORDER BY c.order_index ASC, c.created_at ASC
  `).all();
}

// Same shape as getAllCollections plus a `thumbs: string[]` field
// containing up to four of the most-recent thumbnails per bucket.
// Powers the Folders-mode tile grid where each folder renders its
// fanned stack artwork — same recipe as FeaturedBuckets' cards on
// the Library page, which fan four thumbs. Window function does the
// per-collection LIMIT 4 in a single query; group_concat aggregates
// the paths into a delimiter-joined string (x'01' = SOH, can never
// appear in a path).
function getAllCollectionsWithThumbs() {
  const rows = getDatabase().prepare(`
    WITH membership AS (
      -- Roll-up membership: every item row counts for its own
      -- collection AND for that collection's parent (one level).
      -- GROUP BY dedups a save that sits in both parent and child;
      -- MAX(added_at) keeps "latest drop on top" honest either way.
      SELECT cid, save_id, MAX(added_at) AS added_at FROM (
        SELECT ci.collection_id AS cid, ci.save_id, ci.added_at FROM collection_items ci
        UNION ALL
        SELECT k.parent_id AS cid, ci.save_id, ci.added_at
        FROM collection_items ci
        JOIN collections k ON k.id = ci.collection_id
        WHERE k.parent_id IS NOT NULL
      )
      GROUP BY cid, save_id
    ),
    ranked AS (
      -- thumb_or_file mirrors the FeaturedBuckets fallback so legacy
      -- saves with empty thumb_path still feed the fanned tile. GIFs
      -- get the original file_path so they animate in the stack
      -- instead of showing the static first-frame JPG that sharp
      -- generates for the thumb_path.
      SELECT m.cid AS collection_id,
             CASE
               WHEN LOWER(s.file_path) LIKE '%.gif' THEN s.file_path
               ELSE COALESCE(NULLIF(s.thumb_path, ''), s.file_path)
             END AS thumb_or_file,
             ROW_NUMBER() OVER (
               PARTITION BY m.cid
               ORDER BY m.added_at DESC, s.created_at DESC
             ) AS rn
      FROM membership m
      JOIN saves s ON s.id = m.save_id
      WHERE s.deleted_at IS NULL
    ),
    top_thumbs AS (
      -- Concatenate in rn order (newest drop first) via the aggregate
      -- ORDER BY — plain group_concat leaves the order undefined, so
      -- the cover thumb (thumbs[0]) could otherwise be an older save
      -- instead of the most recently added one.
      SELECT collection_id,
             group_concat(thumb_or_file, x'01' ORDER BY rn) AS thumbs
      FROM ranked
      WHERE rn <= 4
      GROUP BY collection_id
    )
    SELECT c.id, c.name, c.color, c.created_at, c.order_index, c.parent_id,
           (SELECT COUNT(*) FROM membership m WHERE m.cid = c.id) AS save_count,
           tt.thumbs AS thumbs_blob
    FROM collections c
    LEFT JOIN top_thumbs tt ON tt.collection_id = c.id
    ORDER BY c.order_index ASC, c.created_at ASC
  `).all();
  return rows.map((row) => {
    const { thumbs_blob, ...rest } = row;
    return { ...rest, thumbs: thumbs_blob ? thumbs_blob.split('\x01') : [] };
  });
}

function getCollectionsForSave(saveId) {
  return getDatabase().prepare(`
    SELECT c.* FROM collections c
    JOIN collection_items ci ON ci.collection_id = c.id
    WHERE ci.save_id = ?
    ORDER BY c.order_index ASC, c.created_at ASC
  `).all(saveId);
}

// Returns the ids of collections that contain ALL of the given saves.
// Used to grey out / hide "Add to Bucket" entries that would be a
// no-op for every selected card.
function getCollectionsContainingAll(saveIds) {
  if (!Array.isArray(saveIds) || saveIds.length === 0) return [];
  const placeholders = saveIds.map(() => '?').join(',');
  const rows = getDatabase().prepare(`
    SELECT collection_id AS id FROM collection_items
    WHERE save_id IN (${placeholders})
    GROUP BY collection_id
    HAVING COUNT(DISTINCT save_id) = ?
  `).all(...saveIds, saveIds.length);
  return rows.map((r) => r.id);
}

function createCollection({ name, color, parentId } = {}) {
  const db = getDatabase();
  const next = db.prepare(
    'SELECT COALESCE(MAX(order_index), -1) + 1 AS n FROM collections'
  ).get();
  // Resolve / validate the parent. We only allow one level of nesting,
  // so a parent that's itself a child is rejected (silently flattened
  // to top-level rather than rejected outright — this is forgiving for
  // future callers and keeps the constraint enforced server-side).
  let parent_id = null;
  if (parentId) {
    const parent = db.prepare(
      'SELECT id, parent_id FROM collections WHERE id = ?'
    ).get(parentId);
    if (parent && !parent.parent_id) parent_id = parent.id;
  }
  const record = {
    id: crypto.randomUUID(),
    name: name || 'Untitled',
    color: color || '#007aff',
    created_at: Date.now(),
    order_index: next.n,
    parent_id,
  };
  db.prepare(
    'INSERT INTO collections (id, name, color, created_at, order_index, parent_id) VALUES (@id, @name, @color, @created_at, @order_index, @parent_id)'
  ).run(record);
  return record;
}

// ── Tags ───────────────────────────────────────────────────────────────────

// Internal tags are namespaced with a leading "__" (e.g. "__starter__",
// which the starter pack uses to find its images for "Start fresh"). They
// drive behaviour, not user organization, so they're filtered out of every
// tag query the UI reads — starter images then read as untagged. The
// ESCAPE clause treats the underscores as literals (otherwise LIKE's "_"
// wildcard would match anything).
const NOT_INTERNAL_TAG = `t.name NOT LIKE '\\_\\_%' ESCAPE '\\'`;

function getAllTags() {
  return getDatabase().prepare(`
    SELECT t.*, COUNT(st.save_id) AS save_count
    FROM tags t
    LEFT JOIN save_tags st ON st.tag_id = t.id
    WHERE ${NOT_INTERNAL_TAG}
    GROUP BY t.id
    ORDER BY t.name ASC
  `).all();
}

function getTagsForSave(saveId) {
  return getDatabase().prepare(`
    SELECT t.* FROM tags t
    JOIN save_tags st ON st.tag_id = t.id
    WHERE st.save_id = ? AND ${NOT_INTERNAL_TAG}
    ORDER BY t.name ASC
  `).all(saveId);
}

function addTagToSave({ saveId, name } = {}) {
  const trimmed = (name || '').trim().toLowerCase().replace(/^#+/, '');
  if (!trimmed || !saveId) return { ok: false };
  const db = getDatabase();
  let tag = db.prepare('SELECT * FROM tags WHERE name = ?').get(trimmed);
  if (!tag) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, trimmed);
    tag = { id, name: trimmed };
  }
  db.prepare(
    'INSERT OR IGNORE INTO save_tags (save_id, tag_id) VALUES (?, ?)'
  ).run(saveId, tag.id);
  return { ok: true, tag };
}

function removeTagFromSave({ saveId, tagId } = {}) {
  if (!saveId || !tagId) return { ok: false };
  const db = getDatabase();
  db.prepare('DELETE FROM save_tags WHERE save_id = ? AND tag_id = ?').run(saveId, tagId);
  // Sweep orphaned tags so the global tag list stays clean.
  db.prepare(
    'DELETE FROM tags WHERE id = ? AND id NOT IN (SELECT tag_id FROM save_tags)'
  ).run(tagId);
  return { ok: true };
}

// Rename a tag globally. If the new name already exists as another
// tag, merge the two — every save that had the old tag now points at
// the survivor and the renamed row is deleted. Idempotent on no-op.
function renameTag({ id, name } = {}) {
  const trimmed = (name || '').trim().toLowerCase().replace(/^#+/, '');
  if (!id || !trimmed) return { ok: false, reason: 'invalid' };
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.name === trimmed) return { ok: true, tag: existing };

  const collision = db.prepare('SELECT * FROM tags WHERE name = ? AND id != ?').get(trimmed, id);
  if (collision) {
    // Merge: repoint every save_tags row from id → collision.id, then
    // delete the now-empty source tag. INSERT OR IGNORE handles the
    // case where a save already had both tags applied.
    const merge = db.transaction(() => {
      db.prepare(
        'INSERT OR IGNORE INTO save_tags (save_id, tag_id) SELECT save_id, ? FROM save_tags WHERE tag_id = ?',
      ).run(collision.id, id);
      db.prepare('DELETE FROM save_tags WHERE tag_id = ?').run(id);
      db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    });
    merge();
    return { ok: true, tag: collision, merged: true };
  }
  db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(trimmed, id);
  return { ok: true, tag: { ...existing, name: trimmed } };
}

// Hard-delete a tag everywhere — drops every save_tags edge first, then
// the tag row. Returns the number of saves that lost the tag so the UI
// can surface "removed from N saves" feedback.
function deleteTag(tagId) {
  if (!tagId) return { ok: false };
  const db = getDatabase();
  const txn = db.transaction(() => {
    const { changes } = db
      .prepare('DELETE FROM save_tags WHERE tag_id = ?')
      .run(tagId);
    db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
    return changes;
  });
  const removed = txn();
  return { ok: true, removed };
}

// Bulk-cleanup for the tag manager — drops every tag that no save
// references. Single statement so 1000-tag libraries don't pay
// transaction overhead per row.
function deleteUnusedTags() {
  const db = getDatabase();
  const { changes } = db
    .prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM save_tags WHERE tag_id IS NOT NULL)')
    .run();
  return { ok: true, deleted: changes };
}

function reorderCollections(orderedIds) {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE collections SET order_index = ? WHERE id = ?');
  const txn = db.transaction((ids) => {
    ids.forEach((id, idx) => stmt.run(idx, id));
  });
  txn(orderedIds);
  return { ok: true };
}

function renameCollection({ id, name } = {}) {
  getDatabase().prepare('UPDATE collections SET name = ? WHERE id = ?').run(name, id);
  return { ok: true };
}

// Move a folder under a different parent — or back to the top level
// when parentId is null. Enforces the schema's one-level cap by
// rejecting moves that would create a grandparent-grandchild chain
// (i.e. trying to nest under a folder that's itself nested) and by
// preventing self-parenting / cycles.
function setCollectionParent({ id, parentId } = {}) {
  if (!id || id === parentId) return { ok: false, reason: 'invalid' };
  const db = getDatabase();
  if (parentId) {
    const parent = db
      .prepare('SELECT id, parent_id FROM collections WHERE id = ?')
      .get(parentId);
    if (!parent) return { ok: false, reason: 'parent-missing' };
    if (parent.parent_id) return { ok: false, reason: 'too-deep' };
    // If the moving folder already has children, demoting it under
    // a parent would create a 3-level chain. Promote its children
    // to the top level first.
    db.prepare('UPDATE collections SET parent_id = NULL WHERE parent_id = ?').run(id);
  }
  db.prepare('UPDATE collections SET parent_id = ? WHERE id = ?')
    .run(parentId || null, id);
  return { ok: true };
}

function deleteCollection(id) {
  const db = getDatabase();
  // Promote any children to top-level rather than cascading the
  // delete. Less destructive — users who accidentally delete a parent
  // can still find the children in the sidebar afterward, with all
  // their saves intact.
  db.prepare('UPDATE collections SET parent_id = NULL WHERE parent_id = ?').run(id);
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  return { ok: true };
}

function addSaveToCollection({ collectionId, saveId } = {}) {
  getDatabase().prepare(
    'INSERT OR IGNORE INTO collection_items (collection_id, save_id, added_at) VALUES (?, ?, ?)'
  ).run(collectionId, saveId, Date.now());
  return { ok: true };
}

function removeSaveFromCollection({ collectionId, saveId } = {}) {
  getDatabase().prepare(
    'DELETE FROM collection_items WHERE collection_id = ? AND save_id = ?'
  ).run(collectionId, saveId);
  return { ok: true };
}

// ── Boards ──────────────────────────────────────────────────────────
//
// Boards are an infinite-canvas surface. A board has many board_items,
// where each item has type-specific data stashed as a JSON blob in the
// `data` column. Position/size live as columns so we can index/query
// them later if needed (e.g. compute board bounds for thumbnails).

function listBoards() {
  return getDatabase().prepare(
    'SELECT id, name, thumb_path, created_at, updated_at, order_index FROM boards ORDER BY order_index ASC, created_at ASC'
  ).all();
}

function reorderBoards(orderedIds) {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE boards SET order_index = ? WHERE id = ?');
  const txn = db.transaction((ids) => {
    ids.forEach((id, idx) => stmt.run(idx, id));
  });
  txn(orderedIds);
  return { ok: true };
}

// Same shape as listBoards plus a `thumbs: string[]` field with up
// to four save thumbnails — the first image items on the canvas
// ordered bottom-up. Powers the Boards-mode tile grid where each
// board renders as a small mosaic of its content. board_items.data
// is JSON; json_extract pulls saveId out without needing a join
// through a materialised intermediate. Filters by deleted_at on
// the joined save so stale references to trashed saves don't
// appear as broken thumbs.
function listBoardsWithThumbs() {
  const rows = getDatabase().prepare(`
    WITH item_data AS (
      -- Pull every board item with the geometry + minimal type data
      -- the snapshot renderer needs. Image items resolve their save's
      -- thumb_path here so the renderer doesn't need a separate lookup.
      SELECT bi.board_id, bi.type, bi.x, bi.y, bi.width, bi.height,
             bi.rotation, bi.z_index,
             json_extract(bi.data, '$.kind')         AS kind,
             json_extract(bi.data, '$.fill')         AS fill,
             json_extract(bi.data, '$.stroke')       AS stroke,
             json_extract(bi.data, '$.strokeWidth')  AS stroke_width,
             json_extract(bi.data, '$.fontSize')     AS font_size,
             json_extract(bi.data, '$.text')         AS text_content,
             CASE WHEN bi.type = 'image'
                  THEN CASE
                         WHEN LOWER(s.file_path) LIKE '%.gif' THEN s.file_path
                         ELSE COALESCE(NULLIF(s.thumb_path, ''), s.file_path)
                       END
                  ELSE NULL END                       AS thumb_path
        FROM board_items bi
        LEFT JOIN saves s
          ON s.id = json_extract(bi.data, '$.saveId')
         AND s.deleted_at IS NULL
       ORDER BY bi.board_id, bi.z_index ASC
    ),
    items_per_board AS (
      SELECT board_id,
             json_group_array(json_object(
               'type', type,
               'x', x, 'y', y, 'width', width, 'height', height,
               'rotation', rotation,
               'kind', kind,
               'fill', fill,
               'stroke', stroke,
               'strokeWidth', stroke_width,
               'fontSize', font_size,
               'text', text_content,
               'thumb_path', thumb_path
             )) AS items_json
        FROM item_data
       GROUP BY board_id
    )
    SELECT b.id, b.name, b.thumb_path, b.created_at, b.updated_at, b.order_index,
           COALESCE(ipb.items_json, '[]') AS items_json
      FROM boards b
      LEFT JOIN items_per_board ipb ON ipb.board_id = b.id
     ORDER BY b.order_index ASC, b.created_at ASC
  `).all();
  return rows.map((row) => {
    const { items_json, ...rest } = row;
    let items = [];
    try { items = JSON.parse(items_json || '[]'); } catch { items = []; }
    return { ...rest, items };
  });
}

function getBoard(id) {
  return getDatabase().prepare(
    'SELECT id, name, thumb_path, created_at, updated_at FROM boards WHERE id = ?'
  ).get(id);
}

function createBoard({ name = 'Untitled board' } = {}) {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDatabase().prepare(
    'INSERT INTO boards (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(id, name, now, now);
  return { id, name, thumb_path: null, created_at: now, updated_at: now };
}

function renameBoard({ id, name } = {}) {
  getDatabase().prepare(
    'UPDATE boards SET name = ?, updated_at = ? WHERE id = ?'
  ).run(name, Date.now(), id);
  return { ok: true };
}

function deleteBoard(id) {
  // ON DELETE CASCADE drops board_items automatically.
  getDatabase().prepare('DELETE FROM boards WHERE id = ?').run(id);
  return { ok: true };
}

function touchBoard(id) {
  getDatabase().prepare(
    'UPDATE boards SET updated_at = ? WHERE id = ?'
  ).run(Date.now(), id);
}

function getBoardItems(boardId) {
  const rows = getDatabase().prepare(
    'SELECT id, board_id, type, x, y, width, height, rotation, z_index, data, created_at, updated_at FROM board_items WHERE board_id = ? ORDER BY z_index ASC'
  ).all(boardId);
  // Hydrate the JSON blob for the renderer; raw column stays as text.
  return rows.map((r) => ({
    ...r,
    data: r.data ? safeParseJSON(r.data) : {},
  }));
}

// Tiny preview slice for the sidebar's board hover fan — up to N
// image items with the corresponding save's file_path / thumb_path
// joined in. Avoids a round-trip per item from the renderer.
function getBoardPreviewSaves(boardId, limit = 4) {
  if (!boardId) return [];
  const rows = getDatabase().prepare(
    `SELECT data, z_index, created_at FROM board_items
       WHERE board_id = ? AND type = 'image'
       ORDER BY z_index ASC, created_at ASC`,
  ).all(boardId);
  const saveIds = [];
  for (const r of rows) {
    const data = r.data ? safeParseJSON(r.data) : {};
    if (data && typeof data.saveId === 'string') saveIds.push(data.saveId);
    if (saveIds.length >= limit) break;
  }
  if (saveIds.length === 0) return [];
  const placeholders = saveIds.map(() => '?').join(',');
  const saves = getDatabase().prepare(
    `SELECT id, file_path, thumb_path, title FROM saves
       WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
  ).all(...saveIds);
  // Preserve the order of saveIds (most-recent-first per board layer).
  const byId = new Map(saves.map((s) => [s.id, s]));
  return saveIds.map((id) => byId.get(id)).filter(Boolean);
}

// All save ids referenced by a board's image items. Used by the
// BoardLibraryDrawer to mark library cards that are already on the
// canvas with an "in this space" badge.
function getBoardSaveIds(boardId) {
  if (!boardId) return [];
  const rows = getDatabase().prepare(
    `SELECT json_extract(data, '$.saveId') AS save_id
       FROM board_items
      WHERE board_id = ? AND type = 'image'`,
  ).all(boardId);
  const ids = [];
  for (const r of rows) {
    if (typeof r.save_id === 'string' && r.save_id) ids.push(r.save_id);
  }
  return ids;
}

// Reverse lookup: every board that contains the given save as an
// image item, with the board's display name. Drives the Spaces row
// in the DetailPanel so users can jump from a save to any board it
// lives on.
function getBoardsForSave(saveId) {
  if (!saveId) return [];
  return getDatabase().prepare(
    `SELECT DISTINCT b.id, b.name, b.updated_at
       FROM board_items bi
       JOIN boards b ON b.id = bi.board_id
      WHERE bi.type = 'image'
        AND json_extract(bi.data, '$.saveId') = ?
      ORDER BY b.updated_at DESC`,
  ).all(saveId);
}

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function upsertBoardItem({ boardId, item } = {}) {
  if (!boardId || !item) return { ok: false };
  const now = Date.now();
  const id = item.id || crypto.randomUUID();
  const dataStr = JSON.stringify(item.data || {});
  const existing = getDatabase().prepare(
    'SELECT id FROM board_items WHERE id = ?'
  ).get(id);

  if (existing) {
    getDatabase().prepare(
      `UPDATE board_items SET
         type = ?, x = ?, y = ?, width = ?, height = ?, rotation = ?,
         z_index = ?, data = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      item.type, item.x, item.y, item.width ?? null, item.height ?? null,
      item.rotation ?? 0, item.z_index ?? 0, dataStr, now, id,
    );
  } else {
    getDatabase().prepare(
      `INSERT INTO board_items
         (id, board_id, type, x, y, width, height, rotation, z_index, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, boardId, item.type, item.x, item.y,
      item.width ?? null, item.height ?? null,
      item.rotation ?? 0, item.z_index ?? 0, dataStr,
      item.created_at || now, now,
    );
  }
  touchBoard(boardId);
  return { id, updated_at: now };
}

function bulkUpdateBoardItems({ boardId, items } = {}) {
  if (!boardId || !Array.isArray(items) || items.length === 0) return { ok: true };
  const db = getDatabase();
  const tx = db.transaction(() => {
    for (const it of items) {
      upsertBoardItem({ boardId, item: it });
    }
  });
  tx();
  return { ok: true };
}

function deleteBoardItem({ boardId, itemId } = {}) {
  getDatabase().prepare(
    'DELETE FROM board_items WHERE id = ? AND board_id = ?'
  ).run(itemId, boardId);
  touchBoard(boardId);
  return { ok: true };
}

function deleteBoardItems({ boardId, itemIds } = {}) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) return { ok: true };
  const placeholders = itemIds.map(() => '?').join(',');
  getDatabase().prepare(
    `DELETE FROM board_items WHERE board_id = ? AND id IN (${placeholders})`
  ).run(boardId, ...itemIds);
  touchBoard(boardId);
  return { ok: true };
}

module.exports = {
  initDatabase,
  markSaveViewed,
  getRecentlyViewed,
  getSaveEmbeddingsCached,
  invalidateEmbeddingCache,
  getDatabase,
  closeDatabase,
  reopenDatabase,
  getDatabasePath,
  insertSave,
  getReclaimableSaves,
  updateSaveStorage,
  // Source tombstones (X bookmark / IG saved-post dismiss/dedup)
  tweetKeyFromUrl,
  igKeyFromUrl,
  sourceKeyFromUrl,
  findActiveSaveBySourceKey,
  classifyXBookmarkUrls,
  isTweetDismissed,
  dismissTweet,
  undismissTweet,
  findSaveByHash,
  backfillContentHashes,
  findSimilarByPalette,
  getAllSaves,
  getSave,
  deleteSave,
  restoreSave,
  permanentlyDeleteSave,
  emptyTrash,
  purgeTrashBefore,
  wipeLibrary,
  updateSave,
  getSaveEmbeddings,
  getSmartViewCounts,
  getSavesByIds,
  getUnindexedSaves,
  getUnindexedCount,
  filterByColor,
  getAllCollections,
  getAllCollectionsWithThumbs,
  getCollectionsForSave,
  getCollectionsContainingAll,
  createCollection,
  renameCollection,
  setCollectionParent,
  deleteCollection,
  reorderCollections,
  reorderBoards,
  addSaveToCollection,
  removeSaveFromCollection,
  getAllTags,
  getTagsForSave,
  addTagToSave,
  removeTagFromSave,
  renameTag,
  deleteTag,
  deleteUnusedTags,
  getIntegrityResult,
  repairMissingXTweetCreatedAt,
  // Boards
  listBoards,
  listBoardsWithThumbs,
  getBoard,
  createBoard,
  renameBoard,
  deleteBoard,
  getBoardItems,
  getBoardPreviewSaves,
  getBoardSaveIds,
  getBoardsForSave,
  upsertBoardItem,
  bulkUpdateBoardItems,
  deleteBoardItem,
  deleteBoardItems,
};
