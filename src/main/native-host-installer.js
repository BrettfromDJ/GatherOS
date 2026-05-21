// Writes the Chrome native messaging host manifest into every
// Chromium-family browser's user dir on macOS, so installing the
// GatherOS extension from any of them Just Works without the user
// touching the filesystem.
//
// The manifest tells Chrome which binary to launch when the
// extension calls chrome.runtime.sendNativeMessage('co.gatheros.host', …)
// and which extension IDs are allowed to use it. We point at the
// running app's own executable plus the --native-host flag, so the
// same binary handles both modes (see index.js's top-of-file
// short-circuit).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app } = require('electron');

const HOST_NAME = 'co.gatheros.host';

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
// directories mean the browser isn't installed, which we silently skip.
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

function manifestPayload() {
  // In dev, process.execPath is electron itself, which DOES accept
  // CLI flags. In a packaged build, process.execPath is the app's
  // .app/Contents/MacOS/<AppName> binary, which is the same Electron
  // shell — also accepts --native-host. Either way, pointing at
  // process.execPath is correct.
  return {
    name: HOST_NAME,
    description: 'GatherOS native messaging host',
    path: process.execPath,
    type: 'stdio',
    allowed_origins: ALLOWED_EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
  };
}

// Electron's process.execPath in dev is the developer's local
// Electron binary, which won't include our index.js short-circuit
// without --inspect-style arg passing — but `npm run dev` invokes
// `electron .` so the entry point IS our index.js, and Chrome will
// pass --native-host as an arg to argv[2] which we already check.
// In packaged builds the binary is .app/Contents/MacOS/<name> which
// runs index.js directly. Both paths work without modification.

function install() {
  if (process.platform !== 'darwin') {
    // Windows/Linux installers can land in a follow-up — paths
    // and registry handling are different on those platforms.
    return;
  }

  const payload = JSON.stringify(manifestPayload(), null, 2);
  const filename = `${HOST_NAME}.json`;

  for (const dir of macTargets()) {
    try {
      // Only write if the parent (the browser's Application Support
      // dir) already exists — that tells us the browser is at least
      // installed, even if it's never been launched. Creating
      // NativeMessagingHosts beneath an absent parent would scatter
      // empty dirs for browsers the user doesn't have.
      const parent = path.dirname(dir);
      if (!fs.existsSync(parent)) continue;
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, filename);
      // Idempotent: only write when the content actually changed,
      // so we're not bumping mtimes on every launch.
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
