#!/usr/bin/env node
// Build the bundled starter pack from your live library.
//
// Picks every save in a collection named "starter pack" (case
// insensitive — call it "Starter Pack" or "starter pack", whatever
// reads best in the UI), copies their image files into a temp dir,
// and writes them into src/main/starter-pack.zip so the next time
// the app boots, installStarterPack() can ingest them.
//
// Run from the repo root:
//   node scripts/build-starter-pack.js
//
// Env overrides:
//   LIBRARY=/path/to/library         skip auto-detect, use this root
//   COLLECTION="Starter Pack"        use a differently-named collection
//   OUT=path/to/output.zip           write somewhere other than the
//                                    default src/main/starter-pack.zip
//
// Requires the system `zip` command (default on macOS + Linux). No
// new npm deps — we read the SQLite DB with the better-sqlite3
// already in the project's devDependencies and shell out for the
// archive itself.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(REPO_ROOT, 'src', 'main', 'starter-pack.zip');
const DEFAULT_COLLECTION = (process.env.COLLECTION || 'starter pack').toLowerCase();
const OUT = path.resolve(process.env.OUT || DEFAULT_OUT);

function fail(msg) {
  console.error(`\n[starter-pack] ${msg}\n`);
  process.exit(1);
}

// Mirror Electron's app.getPath('userData') resolution for the
// product name 'GatherOS'. Brett runs macOS; covering linux as a
// nice-to-have. Windows users can pass LIBRARY=... explicitly.
function defaultUserDataDir() {
  const productName = 'GatherOS';
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', productName);
  }
  if (process.platform === 'linux') {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(xdg, productName);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', productName);
  }
  return null;
}

function resolveLibraryRoot() {
  if (process.env.LIBRARY) return path.resolve(process.env.LIBRARY);
  const userData = defaultUserDataDir();
  if (!userData) fail('Unsupported platform — pass LIBRARY=/path/to/library explicitly.');
  const registryPath = path.join(userData, 'libraries.json');
  if (!fs.existsSync(registryPath)) {
    fail(`No registry at ${registryPath}. Open the app once to initialize it, or pass LIBRARY=... explicitly.`);
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  // On disk the key is `active`; the IPC layer translates that to
  // `activeId` for the renderer. We're reading the raw file so use
  // the on-disk shape.
  const activeId = registry.active
    || (Array.isArray(registry.libraries) && registry.libraries[0]?.id);
  if (!activeId) fail(`Couldn't determine active library from ${registryPath}.`);
  return path.join(userData, 'libraries', activeId);
}

function loadSaves(libraryRoot) {
  const dbPath = path.join(libraryRoot, 'moodmark.db');
  if (!fs.existsSync(dbPath)) fail(`No moodmark.db at ${dbPath}.`);
  // better-sqlite3 is a native module — it was compiled for
  // Electron during install. Loading it here uses the Node ABI it
  // was built against; if that ever drifts, run `npm rebuild
  // better-sqlite3 --runtime=node` once before retrying.
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    // better-sqlite3 is rebuilt against Electron's Node ABI by
    // electron-builder install-app-deps (runs as a postrelease /
    // post-install step in this repo). Running this script with
    // the system `node` binary fails to load it. The npm script
    // launches us via `ELECTRON_RUN_AS_NODE=1 electron ...` for
    // exactly this reason — invoke `npm run pack:starter` instead
    // of `node scripts/build-starter-pack.js`.
    fail(`Couldn't load better-sqlite3 (${e.message}).
Run 'npm run pack:starter' (which launches under Electron's Node) instead of running this script with plain 'node'.`);
  }
  const db = new Database(dbPath, { readonly: true });
  // Match the requested collection name case-insensitively so
  // "Starter Pack" / "starter pack" / "STARTER PACK" all work.
  const collection = db.prepare(`
    SELECT id, name FROM collections
    WHERE LOWER(name) = ?
    LIMIT 1
  `).get(DEFAULT_COLLECTION);
  if (!collection) {
    fail(`No collection named "${DEFAULT_COLLECTION}" in ${dbPath}.
Create one in the app, drag the saves you want into it, then rerun.
Override the name with COLLECTION="..." if you'd rather call it something else.`);
  }
  const rows = db.prepare(`
    SELECT s.id, s.file_path, s.title
    FROM saves s
    JOIN collection_items ci ON ci.save_id = s.id
    WHERE ci.collection_id = ?
      AND s.deleted_at IS NULL
    ORDER BY ci.added_at ASC
  `).all(collection.id);
  db.close();
  return { collection, rows };
}

function buildZip(rows) {
  if (!rows.length) {
    fail('Collection is empty — add some saves to it first.');
  }
  // Stage the files into a temp dir so the zip uses clean
  // basenames and so we can rename them to match each save's
  // title (the installer uses the filename stem as the import
  // title, which is what the walkthrough's data-save-title
  // selector keys off of).
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'gatheros-starter-'));
  const staged = [];
  const seen = new Set();
  for (const row of rows) {
    if (!fs.existsSync(row.file_path)) {
      console.warn(`[starter-pack] skipping missing file: ${row.file_path}`);
      continue;
    }
    const ext = path.extname(row.file_path).toLowerCase() || '.png';
    const baseTitle = (row.title || path.basename(row.file_path, ext)).trim() || row.id;
    // Make the staged filename unique + filesystem-safe. Spaces
    // are fine in zip entries (titleFromEntry preserves them).
    let name = baseTitle.replace(/[\/\\:*?"<>|\n\r\t]+/g, ' ').trim();
    let candidate = `${name}${ext}`;
    let i = 2;
    while (seen.has(candidate.toLowerCase())) {
      candidate = `${name} (${i})${ext}`;
      i += 1;
    }
    seen.add(candidate.toLowerCase());
    const dest = path.join(stage, candidate);
    fs.copyFileSync(row.file_path, dest);
    staged.push(candidate);
  }
  if (!staged.length) fail('All collection files were missing on disk.');

  // Clear any existing zip — `zip` appends by default, which would
  // accumulate stale entries across runs.
  if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  try {
    execFileSync('zip', ['-q', '-j', OUT, ...staged.map((f) => path.join(stage, f))], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (e) {
    fail(`'zip' failed (${e.message}). On macOS/Linux it's a system command; on Windows pass through WSL or install info-zip.`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }

  return staged;
}

(function main() {
  const libraryRoot = resolveLibraryRoot();
  console.log(`[starter-pack] library: ${libraryRoot}`);
  const { collection, rows } = loadSaves(libraryRoot);
  console.log(`[starter-pack] collection: "${collection.name}" (${rows.length} saves)`);
  const staged = buildZip(rows);
  console.log(`[starter-pack] wrote ${staged.length} entries → ${path.relative(REPO_ROOT, OUT)}`);
  console.log('[starter-pack] done.');
})();
