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
const { ingestZip } = require('./zipImport');
const {
  getDatabase, deleteSave,
  getAllCollections, deleteCollection,
  listBoards, deleteBoard,
} = require('./db');

const STARTER_TAG = '__starter__';
const STARTER_PACK_PATH = path.join(__dirname, 'starter-pack.zip');

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

async function installStarterPack() {
  if (!fs.existsSync(STARTER_PACK_PATH)) {
    console.log(`[starter-pack] no zip at ${STARTER_PACK_PATH} — skipping install. Run 'npm run pack:starter' to build one.`);
    return { ok: true, present: false, inserted: 0, duplicates: 0 };
  }
  try {
    const counts = await ingestZip(STARTER_PACK_PATH, {
      onInserted: (record) => tagAsStarter(record.id),
      // Tag pre-existing matches too — the user might already have
      // the same image in their library (content_hash match). If we
      // skipped tagging those, "Start fresh" would silently leave
      // them behind.
      onDuplicate: (existing) => tagAsStarter(existing.id),
    });
    console.log(`[starter-pack] installed: ${counts.inserted} new + ${counts.duplicates} tagged existing (${counts.skipped} skipped, ${counts.errors} errors)`);
    return { ok: true, present: true, ...counts };
  } catch (err) {
    console.error('[starter-pack] install failed:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// "Start fresh" — three actions in one call:
//   1. Soft-delete every save that carries the starter tag. The
//      tag row stays so a future install rebinds to it cleanly.
//   2. Hard-delete every collection. The walkthrough seeds the
//      idea of collections; clearing them lets the user start
//      organizing from scratch.
//   3. Hard-delete every board (Space). Same rationale.
// Collections and boards aren't soft-deletable in the schema, so
// these are permanent — saves themselves stay restorable from
// Trash.
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
  let removed = 0;
  for (const id of ids) {
    const r = deleteSave(id);
    if (r?.ok) removed += 1;
  }

  // Clear collections + boards. We pull the lists first so we
  // know how many to log.
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

module.exports = {
  STARTER_TAG,
  STARTER_PACK_PATH,
  installStarterPack,
  removeStarterPack,
};
