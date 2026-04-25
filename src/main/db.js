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
  created_at  INTEGER NOT NULL,
  favorited   INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_saves_created_at ON saves (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saves_favorited  ON saves (favorited);

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
  return db;
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
    favorited: 0,
  };
  db.prepare(`
    INSERT INTO saves
      (id, file_path, thumb_path, title, source_url, width, height, file_size, palette, created_at, favorited)
    VALUES
      (@id, @file_path, @thumb_path, @title, @source_url, @width, @height, @file_size, @palette, @created_at, @favorited)
  `).run(record);
  return record;
}

function getAllSaves({ search = '', filter = 'all', sort = 'newest' } = {}) {
  const db = getDatabase();
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push(`(title LIKE ? OR id IN (
      SELECT save_id FROM save_tags
      JOIN tags ON save_tags.tag_id = tags.id
      WHERE tags.name LIKE ?
    ))`);
    params.push(`%${search}%`, `%${search}%`);
  }
  if (filter === 'favorites') conditions.push('favorited = 1');
  if (filter === 'recent') {
    conditions.push('created_at > ?');
    params.push(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const order = sort === 'oldest' ? ' ORDER BY created_at ASC' : ' ORDER BY created_at DESC';
  return db.prepare(`SELECT * FROM saves${where}${order}`).all(...params);
}

function getSave(id) {
  return getDatabase().prepare('SELECT * FROM saves WHERE id = ?').get(id);
}

function deleteSave(id) {
  const db = getDatabase();
  const save = db.prepare('SELECT file_path, thumb_path FROM saves WHERE id = ?').get(id);
  if (!save) return { ok: false };
  db.prepare('DELETE FROM saves WHERE id = ?').run(id);
  return { ok: true, filePath: save.file_path, thumbPath: save.thumb_path };
}

function updateSave({ id, title, favorited } = {}) {
  const db = getDatabase();
  const fields = [];
  const params = [];
  if (title !== undefined) { fields.push('title = ?'); params.push(title); }
  if (favorited !== undefined) { fields.push('favorited = ?'); params.push(favorited ? 1 : 0); }
  if (!fields.length) return { ok: true };
  params.push(id);
  db.prepare(`UPDATE saves SET ${fields.join(', ')} WHERE id = ?`).run(...params);
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
  updateSave,
};
