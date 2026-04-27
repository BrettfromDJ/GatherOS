const path = require('node:path');
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

`;

let db = null;

function getDatabasePath() {
  return path.join(app.getPath('userData'), 'moodmark.db');
}

function initDatabase() {
  if (db) return db;
  const file = getDatabasePath();
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate();
  return db;
}

function migrate() {
  const cols = db.prepare("PRAGMA table_info(collections)").all();
  if (!cols.find((c) => c.name === 'order_index')) {
    db.exec('ALTER TABLE collections ADD COLUMN order_index INTEGER DEFAULT 0');
    // Seed existing rows in created_at order so they keep their visual order.
    const rows = db.prepare('SELECT id FROM collections ORDER BY created_at ASC').all();
    const stmt = db.prepare('UPDATE collections SET order_index = ? WHERE id = ?');
    rows.forEach((r, i) => stmt.run(i, r.id));
  }

  const saveCols = db.prepare("PRAGMA table_info(saves)").all();
  if (!saveCols.find((c) => c.name === 'ai_description')) {
    db.exec('ALTER TABLE saves ADD COLUMN ai_description TEXT');
  }
  if (!saveCols.find((c) => c.name === 'embedding')) {
    db.exec('ALTER TABLE saves ADD COLUMN embedding BLOB');
  }
  if (!saveCols.find((c) => c.name === 'ocr_text')) {
    db.exec('ALTER TABLE saves ADD COLUMN ocr_text TEXT');
  }
  if (!saveCols.find((c) => c.name === 'ai_prompt')) {
    db.exec('ALTER TABLE saves ADD COLUMN ai_prompt TEXT');
  }
  if (!saveCols.find((c) => c.name === 'deleted_at')) {
    db.exec('ALTER TABLE saves ADD COLUMN deleted_at INTEGER');
  }
  // Generic per-save metadata as JSON. Used today for tag-specific
  // extras (e.g. the "font" tag stores name/designer/buy_url here).
  // Stored as TEXT — caller is responsible for stringify/parse.
  if (!saveCols.find((c) => c.name === 'meta')) {
    db.exec('ALTER TABLE saves ADD COLUMN meta TEXT');
  }
  if (!saveCols.find((c) => c.name === 'notes')) {
    db.exec('ALTER TABLE saves ADD COLUMN notes TEXT');
  }

  // One level of bucket nesting. Top-level buckets have parent_id NULL;
  // a child's parent_id points at a top-level bucket's id. Plain TEXT
  // (no REFERENCES) because SQLite's ALTER TABLE ADD COLUMN restricts
  // foreign-key clauses; cascade-on-delete is handled in deleteCollection.
  // The 2-level cap is enforced in the application layer.
  const collectionCols = db.prepare("PRAGMA table_info(collections)").all();
  if (!collectionCols.find((c) => c.name === 'parent_id')) {
    db.exec('ALTER TABLE collections ADD COLUMN parent_id TEXT');
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
} = {}) {
  const db = getDatabase();
  const record = {
    id: id || crypto.randomUUID(),
    file_path: filePath,
    thumb_path: thumbPath,
    title: title || null,
    source_url: sourceUrl || null,
    width: width || null,
    height: height || null,
    file_size: fileSize || null,
    palette: Array.isArray(palette) && palette.length ? JSON.stringify(palette) : null,
    created_at: Date.now(),
  };
  db.prepare(`
    INSERT INTO saves
      (id, file_path, thumb_path, title, source_url, width, height, file_size, palette, created_at)
    VALUES
      (@id, @file_path, @thumb_path, @title, @source_url, @width, @height, @file_size, @palette, @created_at)
  `).run(record);
  return record;
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
    if (!s.palette) return false;
    let palette;
    try { palette = JSON.parse(s.palette); } catch { return false; }
    if (!Array.isArray(palette)) return false;
    const swatches = paletteLimit ? palette.slice(0, paletteLimit) : palette;
    return swatches.some((c) => {
      const lab = hexToLab(c);
      return lab && deltaE76(target, lab) <= threshold;
    });
  });
}

// view: 'all' (default — excludes trashed), 'unsorted' (no bucket
// membership, excludes trashed), or 'trash' (only trashed).
function getAllSaves({ search = '', sort = 'newest', collectionId = null, colorHex = null, view = 'all' } = {}) {
  const db = getDatabase();
  const conditions = [];
  const params = [];

  if (view === 'trash') {
    conditions.push('deleted_at IS NOT NULL');
  } else {
    conditions.push('deleted_at IS NULL');
    if (view === 'unsorted') {
      conditions.push('id NOT IN (SELECT save_id FROM collection_items)');
    }
  }

  if (collectionId) {
    conditions.push(`id IN (SELECT save_id FROM collection_items WHERE collection_id = ?)`);
    params.push(collectionId);
  }
  if (search) {
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
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const order = sort === 'oldest' ? ' ORDER BY created_at ASC' : ' ORDER BY created_at DESC';
  const rows = db.prepare(`SELECT * FROM saves${where}${order}`).all(...params);
  // Color filter: requested hex matched against each save's stored
  // palette in LAB space. Done in JS because SQLite doesn't have the
  // math we need; tractable up to a few thousand saves.
  return colorHex ? filterByColor(rows, colorHex) : rows;
}

function getSave(id) {
  return getDatabase().prepare('SELECT * FROM saves WHERE id = ?').get(id);
}

// Soft delete: marks the row as trashed. The image and thumbnail
// files stay on disk until the user permanently deletes from Trash
// (or empties Trash).
function deleteSave(id) {
  const db = getDatabase();
  const save = db.prepare('SELECT id FROM saves WHERE id = ?').get(id);
  if (!save) return { ok: false };
  db.prepare('UPDATE saves SET deleted_at = ? WHERE id = ?').run(Date.now(), id);
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
  db.prepare('DELETE FROM saves WHERE id = ?').run(id);
  return { ok: true, filePath: save.file_path, thumbPath: save.thumb_path };
}

function emptyTrash() {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT id, file_path, thumb_path FROM saves WHERE deleted_at IS NOT NULL')
    .all();
  if (rows.length === 0) return { ok: true, files: [] };
  db.prepare('DELETE FROM saves WHERE deleted_at IS NOT NULL').run();
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
  return {
    all: all?.n ?? 0,
    unsorted: unsorted?.n ?? 0,
    trash: trash?.n ?? 0,
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

function getCollectionsForSave(saveId) {
  return getDatabase().prepare(`
    SELECT c.* FROM collections c
    JOIN collection_items ci ON ci.collection_id = c.id
    WHERE ci.save_id = ?
    ORDER BY c.order_index ASC, c.created_at ASC
  `).all(saveId);
}

function createCollection({ name, color } = {}) {
  const db = getDatabase();
  const next = db.prepare(
    'SELECT COALESCE(MAX(order_index), -1) + 1 AS n FROM collections'
  ).get();
  const record = {
    id: crypto.randomUUID(),
    name: name || 'Untitled',
    color: color || '#007aff',
    created_at: Date.now(),
    order_index: next.n,
  };
  db.prepare(
    'INSERT INTO collections (id, name, color, created_at, order_index) VALUES (@id, @name, @color, @created_at, @order_index)'
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

function deleteCollection(id) {
  getDatabase().prepare('DELETE FROM collections WHERE id = ?').run(id);
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

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase,
  getDatabasePath,
  insertSave,
  getAllSaves,
  getSave,
  deleteSave,
  restoreSave,
  permanentlyDeleteSave,
  emptyTrash,
  updateSave,
  getSaveEmbeddings,
  getSmartViewCounts,
  getSavesByIds,
  getUnindexedSaves,
  getUnindexedCount,
  filterByColor,
  getAllCollections,
  getCollectionsForSave,
  createCollection,
  renameCollection,
  deleteCollection,
  reorderCollections,
  addSaveToCollection,
  removeSaveFromCollection,
  getAllTags,
  getTagsForSave,
  addTagToSave,
  removeTagFromSave,
};
