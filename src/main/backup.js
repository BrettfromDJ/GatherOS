// Daily SQLite snapshots of the active library's database. Images
// are append-only (content-hashed paths, never overwritten), so the
// only thing that meaningfully changes between sessions is the DB —
// snapshotting just the SQLite file gives us point-in-time recovery
// without ballooning disk usage.
//
// Snapshots live alongside the DB in <library>/snapshots/. We keep
// the last N (currently 7) and rotate older ones out. VACUUM INTO is
// used over fs.copyFileSync because it handles the WAL/SHM sidecar
// files correctly and produces a self-contained replacement file.
//
// Restore is a closeDatabase → fs.copyFile → initDatabase swap with
// a notify-renderer hook so the UI can repaint against the rolled
// back state.

const fs = require('node:fs');
const path = require('node:path');

const SNAPSHOT_DIR_NAME = 'snapshots';
const SNAPSHOT_PREFIX = 'library_';
const SNAPSHOT_EXT = '.db';
const MAX_SNAPSHOTS = 7;
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

function getSnapshotDir() {
  const { getActiveLibraryRoot } = require('./library-registry');
  const root = getActiveLibraryRoot();
  if (!root) return null;
  const dir = path.join(root, SNAPSHOT_DIR_NAME);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error('[backup] mkdir snapshots failed:', err);
    return null;
  }
  return dir;
}

function parseTimestamp(name) {
  if (!name.startsWith(SNAPSHOT_PREFIX) || !name.endsWith(SNAPSHOT_EXT)) {
    return null;
  }
  const stripped = name.slice(SNAPSHOT_PREFIX.length, -SNAPSHOT_EXT.length);
  const ts = parseInt(stripped, 10);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

// Pre-migration backups are dropped by db.js as siblings of the live
// SQLite file, named `<dbname>.pre-v<N>.<iso-stamp>.bak`. They're our
// safety-net if a migration corrupts the active DB, so we surface
// them alongside the daily snapshots in the Backups list — restoring
// either uses the same byte-for-byte copy path.
function listMigrationBackups() {
  const { getDatabasePath } = require('./db');
  let dbPath;
  try { dbPath = getDatabasePath(); }
  catch { return []; }
  if (!dbPath) return [];
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.pre-v(\\d+)\\.(.+)\\.bak$`);
  let names;
  try { names = fs.readdirSync(dir); }
  catch { return []; }
  const out = [];
  for (const name of names) {
    const m = name.match(re);
    if (!m) continue;
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      // mtime is the cleanest cross-platform timestamp for a backup
      // file; the embedded ISO stamp in the filename uses '-' for both
      // date and time separators and is awkward to re-parse.
      out.push({
        path: full,
        timestamp: stat.mtimeMs,
        size: stat.size,
        kind: 'migration',
        migrationToVersion: Number(m[1]),
      });
    } catch {}
  }
  return out;
}

function listSnapshots() {
  const out = [];
  const dir = getSnapshotDir();
  if (dir) {
    let names;
    try { names = fs.readdirSync(dir); }
    catch { names = []; }
    for (const name of names) {
      const ts = parseTimestamp(name);
      if (!ts) continue;
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        out.push({ path: full, timestamp: ts, size: stat.size, kind: 'snapshot' });
      } catch {}
    }
  }
  out.push(...listMigrationBackups());
  out.sort((a, b) => b.timestamp - a.timestamp);
  return out;
}

function getLatestSnapshot() {
  // Filter to daily snapshots only — a recent migration backup
  // shouldn't satisfy the 24h "skip snapshot on launch" gate, or
  // we'd miss the next daily snapshot after every schema upgrade.
  return listSnapshots().find((s) => s.kind === 'snapshot') || null;
}

function pruneSnapshots() {
  // Only prune daily snapshots — never touch migration backups, which
  // are our last-resort recovery if a schema migration goes wrong and
  // there's no guarantee the user will notice within the 7-snapshot
  // window.
  const all = listSnapshots().filter((s) => s.kind === 'snapshot');
  for (let i = MAX_SNAPSHOTS; i < all.length; i++) {
    try { fs.unlinkSync(all[i].path); } catch (err) {
      console.warn('[backup] prune failed for', all[i].path, err.message);
    }
  }
}

// VACUUM INTO copies the open DB to a new file atomically. Safer than
// fs.copyFile because it handles the WAL/SHM sidecars and ensures
// the snapshot is self-contained.
function snapshotLibraryDb() {
  const dir = getSnapshotDir();
  if (!dir) return { ok: false, reason: 'no-active-library' };
  const { getDatabase } = require('./db');
  const ts = Date.now();
  const target = path.join(dir, `${SNAPSHOT_PREFIX}${ts}${SNAPSHOT_EXT}`);
  try {
    const db = getDatabase();
    // Single-quote escape for the path literal — SQLite's VACUUM INTO
    // doesn't accept parameters.
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    pruneSnapshots();
    return { ok: true, path: target, timestamp: ts };
  } catch (err) {
    console.error('[backup] snapshot failed:', err);
    return { ok: false, reason: err?.message || String(err) };
  }
}

function maybeSnapshotOnLaunch() {
  try {
    const latest = getLatestSnapshot();
    if (latest && Date.now() - latest.timestamp < MIN_INTERVAL_MS) {
      return { ok: false, reason: 'too-recent', latest };
    }
    return snapshotLibraryDb();
  } catch (err) {
    console.error('[backup] maybeSnapshotOnLaunch failed:', err);
    return { ok: false, reason: err?.message || String(err) };
  }
}

function restoreFromSnapshot(snapshotPath) {
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    return { ok: false, reason: 'snapshot-missing' };
  }
  const { closeDatabase, initDatabase, getDatabasePath } = require('./db');
  const dbPath = getDatabasePath();
  if (!dbPath) return { ok: false, reason: 'no-db-path' };

  // Take a fresh "pre-restore" snapshot so the user has a one-step
  // undo if they restored to the wrong point. Best-effort.
  try { snapshotLibraryDb(); } catch {}

  try {
    closeDatabase();
    fs.copyFileSync(snapshotPath, dbPath);
    // Drop WAL/SHM sidecars so SQLite re-initializes them against
    // the new file content.
    for (const ext of ['-wal', '-shm']) {
      const sidecar = dbPath + ext;
      if (fs.existsSync(sidecar)) {
        try { fs.unlinkSync(sidecar); } catch {}
      }
    }
    initDatabase();
    return { ok: true };
  } catch (err) {
    console.error('[backup] restore failed:', err);
    // Best-effort recovery — try to reinit whatever's there.
    try { initDatabase(); } catch {}
    return { ok: false, reason: err?.message || String(err) };
  }
}

module.exports = {
  snapshotLibraryDb,
  listSnapshots,
  getLatestSnapshot,
  maybeSnapshotOnLaunch,
  restoreFromSnapshot,
  MAX_SNAPSHOTS,
};
