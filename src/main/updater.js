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

let mainWin = null;

function send(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(channel, payload);
  }
}

function initUpdater(window) {
  mainWin = window;
  if (!app.isPackaged) return;

  // Pipe updater logs through console; helpful for the asar console
  // log without pulling in electron-log as a dependency.
  autoUpdater.logger = console;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err?.message || err);
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
  // (isSilent=false) so the user sees the brief installer dialog,
  // (isForceRunAfter=true) so the new version comes back up
  // immediately instead of leaving them on a dead Dock icon.
  autoUpdater.quitAndInstall(false, true);
}

module.exports = { initUpdater, quitAndInstall };
