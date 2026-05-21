// Writes the Chrome native messaging host manifest + a launcher
// shell script into every Chromium-family browser's user dir on
// macOS, so installing the GatherOS extension from any of them
// Just Works without the user touching the filesystem.
//
// We need a launcher because Chrome invokes the host binary with
//   <binary> chrome-extension://<id>/ [--parent-window=...]
// — there's no manifest field for extra args, so we can't pass
// --native-host through the manifest alone. The launcher is a
// 5-line shell script under ~/Library/Application Support/GatherOS/
// that exec's the Electron binary with the right flags, then forwards
// the rest of argv. In dev it also passes the project root so
// Electron knows which app to load.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app } = require('electron');

const HOST_NAME = 'co.gatheros.host';
const LAUNCHER_FILENAME = 'native-host';

// Extension IDs allowed to invoke the host. The dev ID is fixed by
// the public key in extension/manifest.json — same value whether
// loaded unpacked on this machine or any other. When we publish to
// the Chrome Web Store the store will assign a separate production
// ID; add it to this list and ship a new desktop release.
const ALLOWED_EXTENSION_IDS = [
  'dopoibgdcokjffklnmechmboglnfihlc', // dev (key in extension/manifest.json)
  // 'PROD_WEB_STORE_ID_HERE',
];

// macOS Chromium-family browsers. Each ships its own NativeMessagingHosts
// directory under ~/Library/Application Support/. Best-effort: missing
// parent directories mean the browser isn't installed, which we silently
// skip — no point seeding NativeMessagingHosts under a phantom browser.
function macTargets() {
  const home = os.homedir();
  const base = (subdir) => path.join(home, 'Library', 'Application Support', subdir, 'NativeMessagingHosts');
  return [
    base('Google/Chrome'),
    base('Google/Chrome Beta'),
    base('Google/Chrome Canary'),
    base('Google/Chrome Dev'),
    base('Chromium'),
    base('Microsoft Edge'),
    base('BraveSoftware/Brave-Browser'),
    base('BraveSoftware/Brave-Browser-Beta'),
    base('Vivaldi'),
    base('Arc/User Data'),
  ];
}

function launcherPath() {
  // Live next to prefs.json under the app's userData dir so the
  // path is stable across launches and the dir always exists.
  return path.join(app.getPath('userData'), LAUNCHER_FILENAME);
}

function launcherScript() {
  const electron = process.execPath;
  if (app.isPackaged) {
    // Packaged build: process.execPath is the .app's own binary,
    // which auto-loads the bundled Resources/app code. Just pass
    // the flag and forward Chrome's args (the extension origin +
    // any platform-specific bits like --parent-window).
    return [
      '#!/bin/bash',
      `exec ${JSON.stringify(electron)} --native-host "$@"`,
      '',
    ].join('\n');
  }
  // Dev: process.execPath is node_modules/electron/.../Electron.
  // Electron treats argv[1] as the app to load, so we pass the
  // project root before --native-host (which we read from argv
  // anyway via includes() in index.js).
  const appRoot = app.getAppPath();
  return [
    '#!/bin/bash',
    `exec ${JSON.stringify(electron)} ${JSON.stringify(appRoot)} --native-host "$@"`,
    '',
  ].join('\n');
}

function writeLauncherIfChanged() {
  const dest = launcherPath();
  const next = launcherScript();
  let existing = null;
  try { existing = fs.readFileSync(dest, 'utf8'); } catch {}
  if (existing !== next) {
    fs.writeFileSync(dest, next, { mode: 0o755 });
  } else {
    // chmod separately in case the file existed but wasn't executable.
    try { fs.chmodSync(dest, 0o755); } catch {}
  }
  return dest;
}

function manifestPayload(launcher) {
  return {
    name: HOST_NAME,
    description: 'GatherOS native messaging host',
    path: launcher,
    type: 'stdio',
    allowed_origins: ALLOWED_EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
  };
}

function install() {
  if (process.platform !== 'darwin') {
    // Windows/Linux installers can land in a follow-up — paths
    // and registry handling are different on those platforms.
    return;
  }

  let launcher;
  try {
    launcher = writeLauncherIfChanged();
  } catch (err) {
    console.warn('[native-host] launcher write failed:', err?.message || err);
    return;
  }

  const payload = JSON.stringify(manifestPayload(launcher), null, 2);
  const filename = `${HOST_NAME}.json`;

  for (const dir of macTargets()) {
    try {
      const parent = path.dirname(dir);
      if (!fs.existsSync(parent)) continue;
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, filename);
      let existing = null;
      try { existing = fs.readFileSync(dest, 'utf8'); } catch {}
      if (existing !== payload) {
        fs.writeFileSync(dest, payload);
        console.log('[native-host] installed manifest:', dest);
      }
    } catch (err) {
      console.warn('[native-host] manifest install failed for', dir, '—', err?.message || err);
    }
  }
}

module.exports = { install, HOST_NAME, ALLOWED_EXTENSION_IDS };
