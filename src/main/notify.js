// Tiny shared module so capture.js and ipc.js don't have to import the
// main BrowserWindow setup just to fire a "save:created" + toast.

let savedNotifier = () => {};
let duplicateNotifier = () => {};
let needsUpgradeNotifier = () => {};
let bookmarkNotifier = () => {};
let bookmarkFailedNotifier = () => {};
let errorNotifier = () => {};

function setSaveNotifier(fn) {
  savedNotifier = typeof fn === 'function' ? fn : () => {};
}

// Quiet, batched save path for X bookmark syncs — no per-item toast,
// sound or grid land-animation; the index.js handler collects them and
// emits a single "Synced N bookmarks" summary.
function setBookmarkNotifier(fn) {
  bookmarkNotifier = typeof fn === 'function' ? fn : () => {};
}

function notifyBookmarkSaved(record) {
  bookmarkNotifier(record);
}

// A bookmark that arrived from the extension but failed to persist.
// Counted into the same batch so the summary toast can say
// "· N failed" instead of silently under-reporting.
function setBookmarkFailedNotifier(fn) {
  bookmarkFailedNotifier = typeof fn === 'function' ? fn : () => {};
}

function notifyBookmarkFailed() {
  bookmarkFailedNotifier();
}

// Generic user-facing error line for fire-and-forget main-process
// paths (dock drops, background saves) that previously only logged.
// Renders as a plain action toast in the window.
function setErrorNotifier(fn) {
  errorNotifier = typeof fn === 'function' ? fn : () => {};
}

function notifyError(message) {
  try { errorNotifier(message); } catch { /* toast is best-effort */ }
}

function setDuplicateNotifier(fn) {
  duplicateNotifier = typeof fn === 'function' ? fn : () => {};
}

// Fired when a fire-and-forget save path (global-hotkey screenshots) is
// blocked by the free tier — there's no IPC return value to carry the
// needsUpgrade flag, so we surface the upgrade prompt in the window.
function setNeedsUpgradeNotifier(fn) {
  needsUpgradeNotifier = typeof fn === 'function' ? fn : () => {};
}

function notifySaved(record) {
  savedNotifier(record);
}

// Opens a save inside Gather (focuses the main window + opens the
// focused view on it). Wired to index.js's openSaveFromTray so the
// save toast can reuse the exact same "bring the app forward and show
// this asset" flow as the tray's recent-saves menu.
let saveOpener = () => {};

function setSaveOpener(fn) {
  saveOpener = typeof fn === 'function' ? fn : () => {};
}

function openSaveInApp(saveId) {
  try { saveOpener(saveId); } catch (err) {
    console.error('[gatheros] openSaveInApp failed:', err);
  }
}

function notifyDuplicate(existing) {
  duplicateNotifier(existing);
}

function notifyNeedsUpgrade(context) {
  needsUpgradeNotifier(context);
}

// Tray menu shows the latest saves; mutations elsewhere need to ping
// the menu builder to refresh. Wired via setTrayRefresher in index.js.
let trayRefresher = () => {};

function setTrayRefresher(fn) {
  trayRefresher = typeof fn === 'function' ? fn : () => {};
}

function refreshTray() {
  try { trayRefresher(); } catch (err) {
    console.error('[gatheros] refreshTray failed:', err);
  }
}

module.exports = {
  setSaveNotifier,
  setDuplicateNotifier,
  setNeedsUpgradeNotifier,
  setBookmarkNotifier,
  setBookmarkFailedNotifier,
  setErrorNotifier,
  setTrayRefresher,
  setSaveOpener,
  openSaveInApp,
  notifySaved,
  notifyDuplicate,
  notifyNeedsUpgrade,
  notifyBookmarkSaved,
  notifyBookmarkFailed,
  notifyError,
  refreshTray,
};
