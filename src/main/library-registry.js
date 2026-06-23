// Multi-library registry. Each library is a folder under
// userData/libraries/<id>/ containing its own SQLite DB and image
// storage. A small JSON file at userData/libraries.json tracks the
// list and the currently-active id.
//
// Bootstrap on app start migrates legacy single-library installs:
// the existing moodmark.db, images/, and thumbs/ at the userData
// root get moved into a "Library" default library folder so nothing
// is lost. The migration is idempotent — re-running on an already-
// migrated install is a no-op.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

const REGISTRY_FILENAME = 'libraries.json';
const LIBRARIES_DIRNAME = 'libraries';
const DEFAULT_LIBRARY_ID = 'library_default';
const DEFAULT_LIBRARY_NAME = 'Library';
const REGISTRY_VERSION = 1;

function registryPath() {
  return path.join(app.getPath('userData'), REGISTRY_FILENAME);
}

function librariesRoot() {
  return path.join(app.getPath('userData'), LIBRARIES_DIRNAME);
}

function libraryRoot(id) {
  return path.join(librariesRoot(), id);
}

function readRegistry() {
  try {
    const raw = fs.readFileSync(registryPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.libraries) || parsed.libraries.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeRegistry(reg) {
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2));
}

// One-time-per-install migration. Detects pre-multi-library data at
// the userData root and moves it into a default library folder.
function migrateLegacyData() {
  const userData = app.getPath('userData');
  const legacyDb = path.join(userData, 'moodmark.db');
  if (!fs.existsSync(legacyDb)) return;

  const target = libraryRoot(DEFAULT_LIBRARY_ID);
  fs.mkdirSync(target, { recursive: true });

  const dbFiles = ['moodmark.db', 'moodmark.db-shm', 'moodmark.db-wal'];
  for (const f of dbFiles) {
    const from = path.join(userData, f);
    const to = path.join(target, f);
    try {
      if (fs.existsSync(from)) fs.renameSync(from, to);
    } catch (err) {
      console.error('[library-registry] migrate', f, 'failed:', err.message);
    }
  }

  // Migration backups (.bak files written by db.js when a schema
  // version change runs).
  try {
    for (const entry of fs.readdirSync(userData)) {
      if (entry.startsWith('moodmark.db.pre-v') || entry.endsWith('.bak')) {
        try {
          fs.renameSync(path.join(userData, entry), path.join(target, entry));
        } catch {}
      }
    }
  } catch {}

  // Image storage dirs.
  for (const dir of ['images', 'thumbs']) {
    const from = path.join(userData, dir);
    const to = path.join(target, dir);
    try {
      if (fs.existsSync(from)) fs.renameSync(from, to);
    } catch (err) {
      console.error('[library-registry] migrate dir', dir, 'failed:', err.message);
    }
  }

  // Existing saves point at absolute paths under the old userData/
  // root. Now that the files live one level deeper inside
  // libraries/<id>/, every file_path / thumb_path needs rewriting
  // or the grid will look at empty disk.
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(target, 'moodmark.db');
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath);
      try {
        const oldImagesPrefix = path.join(userData, 'images');
        const newImagesPrefix = path.join(target, 'images');
        const oldThumbsPrefix = path.join(userData, 'thumbs');
        const newThumbsPrefix = path.join(target, 'thumbs');
        db.prepare(
          'UPDATE saves SET file_path = REPLACE(file_path, ?, ?) WHERE file_path LIKE ?'
        ).run(oldImagesPrefix, newImagesPrefix, `${oldImagesPrefix}%`);
        db.prepare(
          'UPDATE saves SET thumb_path = REPLACE(thumb_path, ?, ?) WHERE thumb_path LIKE ?'
        ).run(oldThumbsPrefix, newThumbsPrefix, `${oldThumbsPrefix}%`);
      } finally {
        db.close();
      }
    }
  } catch (err) {
    console.error('[library-registry] rewrite paths failed:', err.message);
  }
}

// Sweeps every library's DB and rewrites saves rows whose file_path /
// thumb_path are still under the legacy userData/images or
// userData/thumbs roots — the case where a prior multi-library
// upgrade moved the files but not the rows. Idempotent: rows whose
// paths are already correct don't match the LIKE filter and aren't
// touched. Cheap to run on every boot.
function healLegacyPaths(reg) {
  if (!reg || !Array.isArray(reg.libraries)) return;
  const userData = app.getPath('userData');
  const oldImagesPrefix = path.join(userData, 'images');
  const oldThumbsPrefix = path.join(userData, 'thumbs');
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    return;
  }
  for (const lib of reg.libraries) {
    const dbPath = path.join(libraryRoot(lib.id), 'moodmark.db');
    if (!fs.existsSync(dbPath)) continue;
    const newImagesPrefix = path.join(libraryRoot(lib.id), 'images');
    const newThumbsPrefix = path.join(libraryRoot(lib.id), 'thumbs');
    try {
      const db = new Database(dbPath);
      try {
        db.prepare(
          'UPDATE saves SET file_path = REPLACE(file_path, ?, ?) WHERE file_path LIKE ?'
        ).run(oldImagesPrefix, newImagesPrefix, `${oldImagesPrefix}%`);
        db.prepare(
          'UPDATE saves SET thumb_path = REPLACE(thumb_path, ?, ?) WHERE thumb_path LIKE ?'
        ).run(oldThumbsPrefix, newThumbsPrefix, `${oldThumbsPrefix}%`);
      } finally {
        db.close();
      }
    } catch (err) {
      console.error('[library-registry] heal paths in', lib.id, 'failed:', err.message);
    }
  }
}

// Idempotent. Call once at app start before opening the database.
function bootstrap() {
  const existing = readRegistry();
  if (existing) {
    // Re-create any missing library folders. Defensive — a manual
    // delete shouldn't crash the app on next launch.
    for (const lib of existing.libraries) {
      fs.mkdirSync(libraryRoot(lib.id), { recursive: true });
    }
    healLegacyPaths(existing);
    return existing;
  }

  // No registry yet. If legacy data exists, hoist it into the
  // default library; otherwise just create an empty default.
  fs.mkdirSync(librariesRoot(), { recursive: true });
  fs.mkdirSync(libraryRoot(DEFAULT_LIBRARY_ID), { recursive: true });
  migrateLegacyData();

  const reg = {
    version: REGISTRY_VERSION,
    active: DEFAULT_LIBRARY_ID,
    libraries: [
      {
        id: DEFAULT_LIBRARY_ID,
        name: DEFAULT_LIBRARY_NAME,
        createdAt: Date.now(),
      },
    ],
  };
  writeRegistry(reg);
  healLegacyPaths(reg);
  return reg;
}

function getActiveLibrary() {
  const reg = readRegistry() || bootstrap();
  return reg.libraries.find((l) => l.id === reg.active) || reg.libraries[0];
}

function getActiveLibraryRoot() {
  return libraryRoot(getActiveLibrary().id);
}

function listLibraries() {
  const reg = readRegistry() || bootstrap();
  return {
    activeId: reg.active,
    libraries: reg.libraries
      .map((l) => ({
        id: l.id,
        name: l.name,
        createdAt: l.createdAt,
        save_count: countSavesInLibrary(l.id),
        // A few recent thumbnails for the switcher's cover preview. Pull
        // extra rows and keep only the ones whose file is actually on
        // disk, so a missing thumb / stale path never renders as a dead
        // broken image in the fanned cards.
        covers: getLibraryPreviews(l.id, 8)
          .map(coverPathFor)
          .filter(Boolean)
          .slice(0, 4),
      }))
      .sort((a, b) => a.createdAt - b.createdAt),
  };
}

// Cheap COUNT(*) from each library's DB so the switcher dropdown +
// Libraries settings page can render a save count next to each
// row. Opens a transient readonly handle so we don't fight the
// active library's writer, and gracefully returns 0 for any
// library whose DB file doesn't exist yet or fails to query.
function countSavesInLibrary(id) {
  try {
    const dbPath = path.join(libraryRoot(id), 'moodmark.db');
    if (!fs.existsSync(dbPath)) return 0;
    const Database = require('better-sqlite3');
    const handle = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = handle
        .prepare('SELECT COUNT(*) AS n FROM saves WHERE deleted_at IS NULL')
        .get();
      return row?.n || 0;
    } finally {
      handle.close();
    }
  } catch (err) {
    console.warn('[library-registry] count failed for', id, err.message);
    return 0;
  }
}

function createLibrary(name) {
  const reg = readRegistry() || bootstrap();
  const trimmed = (name || '').trim() || 'Untitled Library';
  const id = `library_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  // Create the root AND the images/thumbs subdirs the save path writes
  // into — without these, the first upload to a fresh library fails with
  // ENOENT because nothing else ever creates them.
  fs.mkdirSync(libraryRoot(id), { recursive: true });
  for (const dir of ['images', 'thumbs']) {
    fs.mkdirSync(path.join(libraryRoot(id), dir), { recursive: true });
  }
  const lib = { id, name: trimmed, createdAt: Date.now() };
  reg.libraries.push(lib);
  writeRegistry(reg);
  return { ok: true, library: lib };
}

function renameLibrary(id, newName) {
  const reg = readRegistry() || bootstrap();
  const lib = reg.libraries.find((l) => l.id === id);
  if (!lib) return { ok: false, reason: 'not-found' };
  const trimmed = (newName || '').trim();
  if (!trimmed) return { ok: false, reason: 'empty-name' };
  lib.name = trimmed;
  writeRegistry(reg);
  return { ok: true };
}

function deleteLibrary(id) {
  const reg = readRegistry() || bootstrap();
  if (reg.libraries.length <= 1) return { ok: false, reason: 'last-library' };
  const idx = reg.libraries.findIndex((l) => l.id === id);
  if (idx < 0) return { ok: false, reason: 'not-found' };

  // If the library being deleted is also the active one, transfer
  // active to the next remaining library *before* removing the row,
  // so callers can hand off the open DB handle cleanly.
  const wasActive = reg.active === id;
  if (wasActive) {
    const next = reg.libraries.find((l) => l.id !== id);
    reg.active = next.id;
  }
  reg.libraries.splice(idx, 1);
  writeRegistry(reg);

  try {
    fs.rmSync(libraryRoot(id), { recursive: true, force: true });
  } catch (err) {
    console.error('[library-registry] remove dir failed:', err.message);
  }
  return { ok: true, wasActive, newActiveId: reg.active };
}

function setActiveLibrary(id) {
  const reg = readRegistry() || bootstrap();
  const exists = reg.libraries.some((l) => l.id === id);
  if (!exists) return { ok: false, reason: 'not-found' };
  if (reg.active === id) return { ok: true, alreadyActive: true };
  reg.active = id;
  writeRegistry(reg);
  return { ok: true };
}

// Pick the first cover path that actually exists on disk — prefer the
// thumbnail, fall back to the full image. Returns null when neither file
// is present (a missing/ungenerated thumb, a manually-removed file, an
// un-healed legacy path), so the switcher skips it instead of rendering a
// dead/broken image.
function coverPathFor(row) {
  for (const p of [row && row.thumb_path, row && row.file_path]) {
    try { if (p && fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

// Read-only peek at a (possibly inactive) library's most recent
// saves, used to render thumbnail previews in the switcher dropdown.
// Opens a fresh read-only DB handle so it never collides with the
// active library's writeable connection.
function getLibraryPreviews(id, limit = 4) {
  const dbPath = path.join(libraryRoot(id), 'moodmark.db');
  if (!fs.existsSync(dbPath)) return [];
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    return [];
  }
  let db;
  try {
    db = new Database(dbPath, { readonly: true });
    // The deleted_at column was added in a later migration. On
    // first run it might not exist yet — handle either case.
    const cols = db.prepare("PRAGMA table_info(saves)").all();
    const hasDeletedAt = cols.some((c) => c.name === 'deleted_at');
    const where = hasDeletedAt ? 'WHERE deleted_at IS NULL' : '';
    return db.prepare(
      `SELECT id, file_path, thumb_path FROM saves ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(Math.max(1, Math.min(limit, 12)));
  } catch (err) {
    console.error('[library-registry] previews failed for', id, ':', err.message);
    return [];
  } finally {
    if (db) {
      try { db.close(); } catch {}
    }
  }
}

module.exports = {
  bootstrap,
  getActiveLibrary,
  getActiveLibraryRoot,
  listLibraries,
  createLibrary,
  renameLibrary,
  deleteLibrary,
  setActiveLibrary,
  getLibraryPreviews,
};
