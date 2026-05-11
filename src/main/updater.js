// Auto-update via electron-updater pointed at GitHub Releases (the
// release channel is configured in electron-builder.yml). Skipped in
// dev because checkForUpdates won't find a manifest there anyway.
//
// Flow:
//   1. App launches → waits ~4s so we don't fight startup IO
//   2. autoUpdater.checkForUpdates() fires; if there's a newer
//      release tagged on GitHub it downloads in the background
//   3. On 'update-downloaded', we ping the renderer with
//      'update-ready' so the UI can surface a "Restart to update"
//      pill. The user clicks Restart → updater:install IPC →
//      autoUpdater.quitAndInstall().
//   4. autoInstallOnAppQuit is left on as a fallback so even if the
//      user ignores the pill, the next clean quit applies the update.
//
// Re-checks every 30 minutes for long-lived sessions.

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');
const settings = require('./settings');

let mainWin = null;

function send(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(channel, payload);
  }
}

// Re-read prefs and apply to the live autoUpdater instance. Called
// at boot and whenever the renderer changes updatesAuto /
// updatesChannel via settings:set-pref.
function applyPrefs() {
  if (!app.isPackaged) return;
  const prefs = settings.getPrefs();
  autoUpdater.autoDownload = prefs.updatesAuto !== false;
  autoUpdater.channel = prefs.updatesChannel || 'latest';
  console.log(
    `[updater] applied prefs: autoDownload=${autoUpdater.autoDownload}, channel=${autoUpdater.channel}`,
  );
}

// Manual check, used by the Updates settings page. Returns a coarse
// status: { upToDate } | { downloading } | { error }. Detailed
// progress + completion still flow through the existing event
// channels (update-ready, update-error).
async function checkNow() {
  if (!app.isPackaged) return { unsupported: true };
  try {
    const result = await autoUpdater.checkForUpdates();
    const current = app.getVersion();
    const available = result?.updateInfo?.version;
    if (!available || available === current) {
      return { upToDate: true, currentVersion: current };
    }
    return { downloading: true, version: available };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

function initUpdater(window) {
  mainWin = window;
  if (!app.isPackaged) return;

  // Pipe updater logs through console; helpful for the asar console
  // log without pulling in electron-log as a dependency.
  autoUpdater.logger = console;
  applyPrefs();
  autoUpdater.autoInstallOnAppQuit = true;

  // Diagnostic: print where the running .app actually lives. If this
  // is anywhere outside /Applications (e.g. a dev-built bundle in
  // ~/GatherOS/dist/build/...), electron-updater's atomic swap will
  // silently fail at install time on macOS.
  console.log(
    `[updater] running from: ${app.getAppPath()} | exec: ${app.getPath('exe')} | version: ${app.getVersion()}`,
  );

  autoUpdater.on('error', (err) => {
    const message = err?.message || String(err);
    console.error('[updater] error:', message);
    send('update-error', { message });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded', info.version);
    send('update-ready', {
      version: info.version,
      releaseDate: info.releaseDate || null,
    });
  });

  // First check 4s after window is up. setInterval handles ongoing
  // sessions — most users will quit and relaunch, but for long-
  // running ones we still want to surface new releases.
  const HALF_HOUR = 30 * 60 * 1000;
  const kick = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] check failed:', err?.message || err);
    });
  };
  setTimeout(kick, 4000);
  setInterval(kick, HALF_HOUR);
}

function quitAndInstall() {
  if (!app.isPackaged) return;
  console.log('[updater] quitAndInstall: starting install handoff');
  // (isSilent=false) so the user sees the brief installer dialog,
  // (isForceRunAfter=true) so the new version comes back up
  // immediately instead of leaving them on a dead Dock icon.
  try {
    autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    console.error('[updater] quitAndInstall threw:', err?.message || err);
    send('update-error', { message: err?.message || String(err) });
  }
}

module.exports = { initUpdater, quitAndInstall, applyPrefs, checkNow };
