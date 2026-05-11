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
  semanticSearch: false,
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
};

function prefsFilePath() {
  return path.join(app.getPath('userData'), PREFS_FILE);
}

function getPrefs() {
  try {
    if (!fs.existsSync(prefsFilePath())) return { ...DEFAULT_PREFS };
    const raw = fs.readFileSync(prefsFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
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
