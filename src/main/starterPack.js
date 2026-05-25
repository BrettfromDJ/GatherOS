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
const { getDatabase, deleteSave } = require('./db');

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
    return { ok: true, present: false, inserted: 0, duplicates: 0 };
  }
  try {
    const counts = await ingestZip(STARTER_PACK_PATH, {
      onInserted: (record) => tagAsStarter(record.id),
    });
    return { ok: true, present: true, ...counts };
  } catch (err) {
    console.error('[starter-pack] install failed:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Soft-delete every save that carries the starter tag. We don't
// touch the tag row itself — keeping it around means a subsequent
// install can rebind to the same tag id rather than creating a
// duplicate entry.
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
  return { ok: true, removed };
}

module.exports = {
  STARTER_TAG,
  STARTER_PACK_PATH,
  installStarterPack,
  removeStarterPack,
};
