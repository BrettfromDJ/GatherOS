const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app } = require('electron');
const Database = require('better-sqlite3');

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
    const rows = database.prepare('PRAGMA integrity_check').all();
    const errors = rows
      .map((r) => r.integrity_check)
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
];

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
  title,
  palette,
  contentHash,
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
    source_url: sourceUrl || null,
    width: width || null,
    height: height || null,
    file_size: fileSize || null,
    palette: paletteArr ? JSON.stringify(paletteArr) : null,
    palette_lab: paletteLabArr && paletteLabArr.length
      ? JSON.stringify(paletteLabArr)
      : null,
    content_hash: contentHash || null,
    created_at: Date.now(),
  };
  db.prepare(`
    INSERT INTO saves
      (id, file_path, thumb_path, title, source_url, width, height, file_size, palette, palette_lab, content_hash, created_at)
    VALUES
      (@id, @file_path, @thumb_path, @title, @source_url, @width, @height, @file_size, @palette, @palette_lab, @content_hash, @created_at)
  `).run(record);
  return record;
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

function getAllSaves({ search = '', sort = 'newest', collectionId = null, colorHex = null, view = 'all' } = {}) {
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
    conditions.push(`id IN (SELECT save_id FROM collection_items WHERE collection_id = ?)`);
    params.push(collectionId);
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
    conditions.push(`id IN (
      SELECT save_id FROM collection_items
      WHERE collection_id IN (SELECT id FROM collections WHERE LOWER(name) = ?)
    )`);
    params.push(name);
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
    // Substring match against title, tags, and OCR text. ai_description
    // is intentionally excluded — descriptions enumerate every visible
    // object so substring-matching them turns "sky" into a 50% hit
    // rate. ocr_text is the actual text inside the image (UI labels,
    // signage, body copy) so a literal match there is high-signal.
    conditions.push(`(title LIKE ? OR ocr_text LIKE ? OR id IN (
      SELECT save_id FROM save_tags
      JOIN tags ON save_tags.tag_id = tags.id
      WHERE tags.name LIKE ?
    ))`);
    params.push(`%${text}%`, `%${text}%`, `%${text}%`);
  }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const order = sort === 'oldest' ? ' ORDER BY created_at ASC' : ' ORDER BY created_at DESC';
  const rows = db.prepare(`SELECT * FROM saves${where}${order}`).all(...params);
  // Color filter: requested hex matched against each save's stored
  // palette in LAB space. Done in JS because SQLite doesn't have the
  // math we need; tractable up to a few thousand saves.
  return effectiveColorHex ? filterByColor(rows, effectiveColorHex) : rows;
}

function getSave(id) {
  return getDatabase().prepare('SELECT * FROM saves WHERE id = ?').get(id);
}

// Soft delete: marks the row as trashed and severs every bucket
// membership in the same transaction. The image and thumbnail files
// stay on disk until the user permanently deletes from Trash (or
// empties Trash). Restoring from trash brings the save back as a
// bucket-less item — by design, deleting is treated as "this is no
// longer part of any collection," not just "hide it temporarily."
function deleteSave(id) {
  const db = getDatabase();
  const save = db.prepare('SELECT id FROM saves WHERE id = ?').get(id);
  if (!save) return { ok: false };
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
  db.prepare('UPDATE saves SET deleted_at = NULL WHERE id = ?').run(id);
  return { ok: true };
}

// Hard delete: removes the DB row and returns the file paths so the
// caller (ipc.js) can unlink the underlying files.
function permanentlyDeleteSave(id) {
  const db = getDatabase();
  const save = db.prepare('SELECT file_path, thumb_path FROM saves WHERE id = ?').get(id);
  if (!save) return { ok: false };
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
  if (embedding !== undefined) { fields.push('embedding = ?'); params.push(embedding); }
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
    onThisDay: onThisDay?.n ?? 0,
  };
}

function getSaveEmbeddings() {
  return getDatabase()
    .prepare('SELECT id, embedding FROM saves WHERE embedding IS NOT NULL')
    .all();
}

function getSavesByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return getDatabase()
    .prepare(`SELECT * FROM saves WHERE id IN (${placeholders})`)
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
  return getDatabase().prepare(`
    SELECT c.id, c.name, c.color, c.created_at, c.order_index, c.parent_id,
           COUNT(ci.save_id) AS save_count
    FROM collections c
    LEFT JOIN collection_items ci ON ci.collection_id = c.id
    GROUP BY c.id
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
    WITH ranked AS (
      -- thumb_or_file mirrors the FeaturedBuckets fallback so legacy
      -- saves with empty thumb_path still feed the fanned tile.
      SELECT ci.collection_id,
             COALESCE(NULLIF(s.thumb_path, ''), s.file_path) AS thumb_or_file,
             s.created_at,
             ROW_NUMBER() OVER (
               PARTITION BY ci.collection_id
               ORDER BY s.created_at DESC
             ) AS rn
      FROM collection_items ci
      JOIN saves s ON s.id = ci.save_id
      WHERE s.deleted_at IS NULL
    ),
    top_thumbs AS (
      SELECT collection_id,
             group_concat(thumb_or_file, x'01') AS thumbs
      FROM ranked
      WHERE rn <= 4
      GROUP BY collection_id
    )
    SELECT c.id, c.name, c.color, c.created_at, c.order_index, c.parent_id,
           COUNT(ci.save_id) AS save_count,
           tt.thumbs AS thumbs_blob
    FROM collections c
    LEFT JOIN collection_items ci ON ci.collection_id = c.id
    LEFT JOIN top_thumbs tt ON tt.collection_id = c.id
    GROUP BY c.id
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

function getAllTags() {
  return getDatabase().prepare(`
    SELECT t.*, COUNT(st.save_id) AS save_count
    FROM tags t
    LEFT JOIN save_tags st ON st.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.name ASC
  `).all();
}

function getTagsForSave(saveId) {
  return getDatabase().prepare(`
    SELECT t.* FROM tags t
    JOIN save_tags st ON st.tag_id = t.id
    WHERE st.save_id = ?
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
    WITH ranked AS (
      SELECT bi.board_id,
             json_extract(bi.data, '$.saveId') AS save_id,
             bi.z_index,
             bi.created_at,
             ROW_NUMBER() OVER (
               PARTITION BY bi.board_id
               ORDER BY bi.z_index ASC, bi.created_at ASC
             ) AS rn
        FROM board_items bi
       WHERE bi.type = 'image'
         AND json_extract(bi.data, '$.saveId') IS NOT NULL
    ),
    top_thumbs AS (
      -- Fall back to file_path when thumb_path is empty so the tile
      -- mosaic mirrors what the FeaturedBuckets row already does
      -- (s.thumb_path || s.file_path). Without the fallback, saves
      -- imported before the thumbnail pipeline existed render the
      -- board tile blank even though the canvas shows them fine.
      SELECT r.board_id,
             group_concat(COALESCE(NULLIF(s.thumb_path, ''), s.file_path), x'01') AS thumbs
        FROM ranked r
        JOIN saves s ON s.id = r.save_id
       WHERE r.rn <= 4 AND s.deleted_at IS NULL
       GROUP BY r.board_id
    )
    SELECT b.id, b.name, b.thumb_path, b.created_at, b.updated_at, b.order_index,
           tt.thumbs AS thumbs_blob
      FROM boards b
      LEFT JOIN top_thumbs tt ON tt.board_id = b.id
     ORDER BY b.order_index ASC, b.created_at ASC
  `).all();
  return rows.map((row) => {
    const { thumbs_blob, ...rest } = row;
    return { ...rest, thumbs: thumbs_blob ? thumbs_blob.split('\x01') : [] };
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
  getDatabase,
  closeDatabase,
  reopenDatabase,
  getDatabasePath,
  insertSave,
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
