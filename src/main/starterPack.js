// Starter pack: a bundled zip of curated saves that ships with the
// app so first-launch users have something to look at while the
// walkthrough runs. The walkthrough's final step asks whether to
// keep these images or clear them out; choosing the latter calls
// removeStarterPack, which finds every save tagged with the
// internal STARTER_TAG and soft-deletes it.
//
// Restarting the walkthrough re-runs installStarterPack. Because
// ingestZip dedups on content_hash against live (non-deleted)
// saves, a "keep" user's library is unchanged on reinstall while a
// "fresh" user gets the pack back.
//
// The zip itself lives at src/main/starter-pack.zip — bundled with
// the app via electron-builder's src/**/* glob. If the file isn't
// present (e.g. in a dev checkout that hasn't built one yet) the
// installer no-ops cleanly so the walkthrough still runs.

const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');
const { app } = require('electron');
const { ingestZip } = require('./zipImport');
const {
  getDatabase, deleteSave, restoreSave,
  getAllCollections, createCollection, deleteCollection, addSaveToCollection,
  listBoards, createBoard, deleteBoard, upsertBoardItem,
} = require('./db');

const STARTER_TAG = '__starter__';
const STARTER_PACK_PATH = path.join(__dirname, 'starter-pack.zip');

// Snapshot file dropped to userData before Start fresh runs so the
// dev "Undo last Start fresh" button has something to restore from.
// Lives outside the asar / outside the library DB so a re-install or
// library switch doesn't wipe it.
function snapshotPath() {
  return path.join(app.getPath('userData'), 'walkthrough-snapshot.json');
}

// Reach into the DB directly for the starter tag — we need an
// upsert-and-attach in a single transaction so concurrent installs
// don't race on tag creation. The public addTagToSave wraps a
// similar flow but issues two statements; this is a single tx for
// throughput when tagging dozens of inserts in sequence.
function tagAsStarter(saveId) {
  if (!saveId) return;
  const db = getDatabase();
  const tx = db.transaction(() => {
    let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(STARTER_TAG);
    if (!tag) {
      const id = require('node:crypto').randomUUID();
      db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, STARTER_TAG);
      tag = { id };
    }
    db.prepare(
      'INSERT OR IGNORE INTO save_tags (save_id, tag_id) VALUES (?, ?)'
    ).run(saveId, tag.id);
  });
  tx();
}

// Pull just the manifest.json entry out of the zip without
// extracting anything else. Returns null if the zip has no
// manifest (pre-collections starter packs).
function readManifestFromZip(zipPath) {
  return new Promise((resolve) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return resolve(null);
      let found = null;
      zipfile.on('error', () => resolve(null));
      zipfile.on('end', () => resolve(found));
      zipfile.on('entry', (entry) => {
        if (entry.fileName !== 'manifest.json') {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (e, stream) => {
          if (e) { zipfile.readEntry(); return; }
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => {
            try { found = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch { /* malformed manifest — fall back to images-only install */ }
            zipfile.readEntry();
          });
          stream.on('error', () => zipfile.readEntry());
        });
      });
      zipfile.readEntry();
    });
  });
}

// Module-level mutex. React 18 StrictMode + the walkthrough's
// onEnter effect fire installStarterPack twice on mount, and the
// two calls would race — both snapshotting the empty collections
// table before either createCollection had landed, then both
// inserting "Branding" / "Typography". The await-then-set pattern
// here makes the second call wait for the first to fully finish
// before its own existing-name snapshot runs.
let installInFlight = null;

async function installStarterPack() {
  if (installInFlight) return installInFlight;
  installInFlight = doInstallStarterPack().finally(() => {
    installInFlight = null;
  });
  return installInFlight;
}

async function doInstallStarterPack() {
  if (!fs.existsSync(STARTER_PACK_PATH)) {
    console.log(`[starter-pack] no zip at ${STARTER_PACK_PATH} — skipping install. Run 'npm run pack:starter' to build one.`);
    return { ok: true, present: false, inserted: 0, duplicates: 0 };
  }
  try {
    const manifest = await readManifestFromZip(STARTER_PACK_PATH);

    // filename → saveId map, populated as ingestZip processes each
    // image. Lets us wire collections + board items back up to the
    // newly-inserted save rows after ingest finishes.
    const filenameToSaveId = new Map();
    const counts = await ingestZip(STARTER_PACK_PATH, {
      onInserted: (record, fileName) => {
        tagAsStarter(record.id);
        if (fileName) filenameToSaveId.set(fileName, record.id);
      },
      // Tag pre-existing matches too — the user might already have
      // the same image in their library (content_hash match). If we
      // skipped tagging those, "Start fresh" would silently leave
      // them behind.
      onDuplicate: (existing, fileName) => {
        tagAsStarter(existing.id);
        if (fileName) filenameToSaveId.set(fileName, existing.id);
      },
    });

    let collectionsCreated = 0;
    let boardsCreated = 0;
    if (manifest) {
      // Snapshot the existing rows once so we can dedupe by name
      // without round-tripping the DB on every iteration. createCollection
      // / createBoard don't check uniqueness, so without this guard the
      // installer would pile up a fresh "Branding" / "Untitled board"
      // every time it runs (and the renderer's StrictMode-doubled effect
      // in dev would compound the duplication).
      const existingCollectionsByName = new Map();
      for (const c of (getAllCollections() || [])) {
        if (c?.name) existingCollectionsByName.set(c.name.toLowerCase(), c.id);
      }
      const existingBoardNames = new Set(
        (listBoards() || [])
          .map((b) => (b?.name || '').toLowerCase())
          .filter(Boolean),
      );

      // Recreate each collection and attach the mapped saves. If a
      // collection with the same name already exists (case-insensitive),
      // reuse it instead of inserting a duplicate row; addSaveToCollection
      // is itself an INSERT OR IGNORE so re-attaching the same saves is
      // a no-op.
      for (const col of (manifest.collections || [])) {
        if (!col?.name) continue;
        const key = col.name.toLowerCase();
        let collectionId = existingCollectionsByName.get(key);
        if (!collectionId) {
          const created = createCollection({ name: col.name, color: col.color });
          collectionId = created?.id || created?.collection?.id;
          if (!collectionId) continue;
          existingCollectionsByName.set(key, collectionId);
          collectionsCreated += 1;
        }
        for (const itemName of (col.items || [])) {
          const saveId = filenameToSaveId.get(itemName);
          if (saveId) addSaveToCollection({ collectionId, saveId });
        }
      }
      // Recreate each board (Space) and its items. Boards with items
      // can't be cleanly merged (re-upserting would clone every canvas
      // element), so if a board with this name already exists we skip
      // it entirely — the user's existing board is the source of truth.
      for (const board of (manifest.boards || [])) {
        if (!board?.name) continue;
        if (existingBoardNames.has(board.name.toLowerCase())) continue;
        const createdBoard = createBoard({ name: board.name });
        const boardId = createdBoard?.id || createdBoard?.board?.id;
        if (!boardId) continue;
        existingBoardNames.add(board.name.toLowerCase());
        boardsCreated += 1;
        for (const it of (board.items || [])) {
          let data = it.data || {};
          if (it.type === 'image' && data.saveId) {
            const mapped = filenameToSaveId.get(data.saveId);
            // Drop image items that point at saves we couldn't ingest
            // — otherwise the board renders a broken tile.
            if (!mapped) continue;
            data = { ...data, saveId: mapped };
          }
          upsertBoardItem({
            boardId,
            item: {
              type: it.type,
              x: it.x,
              y: it.y,
              width: it.width,
              height: it.height,
              rotation: it.rotation,
              z_index: it.z_index,
              data,
            },
          });
        }
      }
    }

    console.log(`[starter-pack] installed: ${counts.inserted} new + ${counts.duplicates} tagged existing, ${collectionsCreated} collection(s), ${boardsCreated} board(s) (${counts.skipped} skipped, ${counts.errors} errors)`);
    return { ok: true, present: true, ...counts, collectionsCreated, boardsCreated };
  } catch (err) {
    console.error('[starter-pack] install failed:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Dump every row from the given table to plain objects. better-
// sqlite3's .all() already returns column-keyed objects so this is
// just a thin wrapper that copes with arbitrary schema drift —
// addColumnIfMissing migrations land new columns over time, but
// SELECT * always returns whatever's actually on the row.
function dumpTable(table) {
  return getDatabase().prepare(`SELECT * FROM ${table}`).all();
}

// Re-insert a dumped row. Builds the column list from the row's
// keys so this works regardless of schema additions since the
// snapshot was taken. OR REPLACE so re-running restore over an
// already-restored DB is idempotent.
function insertRow(table, row) {
  const cols = Object.keys(row);
  if (!cols.length) return;
  const placeholders = cols.map(() => '?').join(', ');
  getDatabase().prepare(
    `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
  ).run(...cols.map((c) => row[c]));
}

// "Start fresh" — four actions in one call:
//   1. Snapshot collections + boards + the starter save ids to a
//      JSON file in userData so the dev undo button can rebuild
//      them.
//   2. Soft-delete every save that carries the starter tag. The
//      tag row stays so a future install rebinds to it cleanly.
//   3. Hard-delete every collection. The walkthrough seeds the
//      idea of collections; clearing them lets the user start
//      organizing from scratch.
//   4. Hard-delete every board (Space). Same rationale.
// Collections and boards aren't soft-deletable in the schema, so
// the undo path replays from the snapshot.
function removeStarterPack() {
  const db = getDatabase();
  const ids = db.prepare(`
    SELECT s.id
    FROM saves s
    JOIN save_tags st ON st.save_id = s.id
    JOIN tags t ON t.id = st.tag_id
    WHERE t.name = ?
      AND s.deleted_at IS NULL
  `).all(STARTER_TAG).map((r) => r.id);

  // (1) Snapshot before destroying anything. Includes the affected
  // save ids + every collection / board row in full.
  try {
    const snapshot = {
      savedAt: Date.now(),
      starterSaveIds: ids,
      collections: dumpTable('collections'),
      collectionItems: dumpTable('collection_items'),
      boards: dumpTable('boards'),
      boardItems: dumpTable('board_items'),
    };
    fs.writeFileSync(snapshotPath(), JSON.stringify(snapshot, null, 2));
    console.log(`[starter-pack] snapshot written → ${snapshotPath()}`);
  } catch (e) {
    console.warn('[starter-pack] failed to write snapshot — undo will not be available:', e?.message || e);
  }

  let removed = 0;
  for (const id of ids) {
    const r = deleteSave(id);
    if (r?.ok) removed += 1;
  }

  const collections = getAllCollections();
  for (const c of collections) deleteCollection(c.id);
  const boards = listBoards();
  for (const b of boards) deleteBoard(b.id);

  console.log(`[starter-pack] start fresh — removed ${removed}/${ids.length} tagged saves, ${collections.length} collections, ${boards.length} boards`);
  return {
    ok: true,
    removed,
    collectionsRemoved: collections.length,
    boardsRemoved: boards.length,
  };
}

// Dev-only — replay the pre-Start-fresh snapshot. Restores soft-
// deleted starter saves, re-inserts every collection + board row
// (with their items) verbatim. Idempotent on re-runs thanks to
// INSERT OR REPLACE. Caller should clear the snapshot file
// afterward if they don't want to replay it again.
function restoreSnapshot() {
  const file = snapshotPath();
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'no-snapshot', path: file };
  }
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, reason: 'parse-error', error: e?.message || String(e) };
  }

  let restoredSaves = 0;
  for (const id of (snapshot.starterSaveIds || [])) {
    try {
      restoreSave(id);
      restoredSaves += 1;
    } catch { /* skip missing rows */ }
  }

  // Restore in a single transaction so a mid-restore failure
  // doesn't leave the DB half-populated.
  const db = getDatabase();
  const tx = db.transaction(() => {
    for (const row of (snapshot.collections || [])) insertRow('collections', row);
    for (const row of (snapshot.collectionItems || [])) insertRow('collection_items', row);
    for (const row of (snapshot.boards || [])) insertRow('boards', row);
    for (const row of (snapshot.boardItems || [])) insertRow('board_items', row);
  });
  tx();

  console.log(`[starter-pack] restored snapshot — ${restoredSaves} saves, ${snapshot.collections?.length || 0} collections, ${snapshot.boards?.length || 0} boards`);
  return {
    ok: true,
    restoredSaves,
    restoredCollections: snapshot.collections?.length || 0,
    restoredBoards: snapshot.boards?.length || 0,
  };
}

module.exports = {
  STARTER_TAG,
  STARTER_PACK_PATH,
  installStarterPack,
  removeStarterPack,
  restoreSnapshot,
};
