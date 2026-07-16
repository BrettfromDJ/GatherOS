// Plain-JSON preferences store. AI key storage was retired when the
// app moved from BYOK to a server-proxied OpenAI integration; the
// licensing session token (handled in licensing.js) is the only
// credential the renderer cares about now.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const PREFS_FILE = 'prefs.json';

const DEFAULT_PREFS = {
  autoNameOnSave: true,
  semanticSearch: true,
  // Storage. When false (default) new images are optimized on import
  // (longest edge capped + re-encoded to WebP) to keep libraries small.
  // True stores the full-resolution original instead.
  keepOriginals: false,
  // Theme: 'light' | 'dark' | 'system'. 'system' tracks the OS
  // preference via the renderer's matchMedia hook.
  theme: 'system',

  // ── Default app behaviour ────────────────────────────────────
  defaultSort: 'recent',   // 'recent' | 'oldest' | 'name_asc' | 'name_desc'
  defaultColumns: 4,       // 2..8 — initial grid density
  defaultMode: 'library',  // 'library' | 'folders' | 'boards'

  // ── Capture / screenshot ─────────────────────────────────────
  captureShortcut: 'CommandOrControl+Shift+S',
  captureMode: 'region',   // 'fullscreen' | 'window' | 'region'
  captureDropFolder: null, // absolute path, null = save normally

  // ── Auto-update ──────────────────────────────────────────────
  updatesAuto: true,       // auto-download new versions
  updatesChannel: 'latest',// 'latest' (stable) | 'beta'

  // ── Trash retention ──────────────────────────────────────────
  trashAutoEmptyDays: 0,   // 0 = disabled; otherwise N days

  // ── Browser extension ────────────────────────────────────────
  // Lazily populated by extension-server.js on first launch.
  // The renderer reads this in Settings → Capture so the user can
  // copy it into the extension's Options page.
  extensionToken: null,

  // ── Social sync ──────────────────────────────────────────────
  // Master switches for the X-bookmark and Instagram-saved sync.
  // When off, the local /save endpoint drops those captures; manual
  // image/page saves from the extension are unaffected. Default on.
  syncXEnabled: true,
  syncInstagramEnabled: true,
  sortXBookmarksByTweetDate: false,

  // ── Trial / free tier ────────────────────────────────────────
  // Timestamp (ms) of when the local no-account trial started, set on
  // first launch. Drives the 14-day reverse trial: full app while the
  // clock runs, then a soft free tier (existing saves stay usable, new
  // saves + pro features prompt to upgrade). null until first launch.
  trialStartedAt: null,
};

function prefsFilePath() {
  return path.join(app.getPath('userData'), PREFS_FILE);
}

function getPrefs() {
  try {
    if (!fs.existsSync(prefsFilePath())) {
      // First launch — seed defaults and write to disk so the user's
      // initial state is concrete (their Desktop path is captured
      // here so subsequent clears can actually clear it).
      const seed = { ...DEFAULT_PREFS, ...resolveAutoDefaults() };
      try { fs.writeFileSync(prefsFilePath(), JSON.stringify(seed, null, 2)); } catch {}
      return seed;
    }
    const raw = fs.readFileSync(prefsFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    // If a key that has a resolved-at-runtime default (e.g.
    // captureDropFolder = ~/Desktop) wasn't in the stored prefs yet
    // — upgrading from an older build — fill it in once and persist
    // so future writes start from a concrete value the user can
    // explicitly clear.
    let migrated = false;
    for (const [key, value] of Object.entries(resolveAutoDefaults())) {
      if (!(key in parsed)) {
        parsed[key] = value;
        migrated = true;
      }
    }
    if (migrated) {
      try { fs.writeFileSync(prefsFilePath(), JSON.stringify(parsed, null, 2)); } catch {}
    }
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS, ...resolveAutoDefaults() };
  }
}

// Values that DEFAULT_PREFS can't carry because they depend on the
// running OS environment (paths, locale, etc.). Resolved lazily so
// requiring this module before app.ready() doesn't crash.
function resolveAutoDefaults() {
  const out = {};
  try {
    out.captureDropFolder = app.getPath('desktop');
  } catch {
    /* app not ready yet — caller will re-resolve on next get */
  }
  return out;
}

function getPref(name, fallback) {
  const prefs = getPrefs();
  return prefs[name] !== undefined ? prefs[name] : (fallback ?? DEFAULT_PREFS[name]);
}

function setPref(name, value) {
  const prefs = getPrefs();
  prefs[name] = value;
  try {
    fs.writeFileSync(prefsFilePath(), JSON.stringify(prefs, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  getPrefs,
  getPref,
  setPref,
};
