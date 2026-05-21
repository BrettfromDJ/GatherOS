// Native messaging host — relays messages from the Chrome
// extension to the running desktop app's local HTTP server.
//
// Chrome spawns this script via the launcher that the desktop app
// installs into ~/Library/Application Support/GatherOS/native-host.
// In dev the launcher invokes us with `node`; in packaged builds it
// invokes the Electron binary with --native-host (we'll swap that
// for a tiny standalone binary before shipping).
//
// Single-purpose stdin/stdout relay:
//
//   1. Read a length-prefixed JSON message from stdin
//   2. If the main app isn't running, launch it and wait for the
//      local server to come up (GATHEROS_BINARY env var, set by
//      the launcher, tells us what to spawn)
//   3. POST the save to http://127.0.0.1:53247/save with the
//      user's extension token (read from prefs.json on disk)
//   4. Write the response back to stdout
//   5. When stdin closes (extension disconnected), exit
//
// Native messaging framing: each message is uint32 little-endian
// length followed by that many bytes of UTF-8 JSON. See
// https://developer.chrome.com/docs/apps/nativeMessaging/#native-messaging-host-protocol
//
// MUST NOT require electron — Chrome launches the host fresh per
// session, and pulling in the GUI shell would flash a Dock icon.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 53247;
const MAX_MSG = 1024 * 1024;
const LAUNCH_TIMEOUT_MS = 20_000;
const LAUNCH_POLL_MS = 300;

// File-backed debug log. Chrome captures the host's stderr but it's
// invisible unless you know how to inspect the extension's service-
// worker output. A tail-able file in the user's support dir is much
// easier to read when a save mysteriously fails.
function appSupportDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'GatherOS');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'GatherOS');
  }
  return path.join(os.homedir(), '.config', 'GatherOS');
}

function debug(...parts) {
  try {
    const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
    fs.appendFileSync(path.join(appSupportDir(), 'native-host.log'), line);
  } catch {
    // Best-effort — never let logging break the relay.
  }
}

function prefsFilePath() {
  return path.join(appSupportDir(), 'prefs.json');
}

function readToken() {
  try {
    const raw = fs.readFileSync(prefsFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.extensionToken || null;
  } catch {
    return null;
  }
}

function writeMessage(payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

function ping() {
  return new Promise((resolve) => {
    const req = http.request(
      { host: SERVER_HOST, port: SERVER_PORT, path: '/ping', method: 'GET', timeout: 1000 },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

// Walk up from the Electron binary at .app/Contents/MacOS/<name> to
// the .app bundle itself, so we can hand it to `/usr/bin/open`.
function appBundleFor(binaryPath) {
  if (!binaryPath) return null;
  // .../Foo.app/Contents/MacOS/Foo → .../Foo.app
  const m = binaryPath.match(/^(.+\.app)\/Contents\/MacOS\//);
  return m ? m[1] : null;
}

// Launch the main GatherOS app via macOS's `open` command and wait
// until the local server responds to /ping. We can't just spawn the
// binary directly: a detached child from this stdin-driven helper
// doesn't get LaunchServices activation, so the new process runs
// like a background daemon — no Dock icon, no window, no localhost
// server bound. `open -a` goes through LaunchServices, which is the
// supported path for launching a GUI app programmatically.
async function ensureAppRunning() {
  if (await ping()) {
    debug('ensureAppRunning: ping ok, app already running');
    return true;
  }

  const bin = process.env.GATHEROS_BINARY;
  if (!bin) {
    debug('ensureAppRunning: GATHEROS_BINARY not set, giving up');
    return false;
  }

  const bundle = appBundleFor(bin);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  try {
    if (bundle) {
      // In dev the bundle is Electron.app and we need to pass the
      // project root via --args so Electron knows which app to load.
      // In a packaged build the bundle is the app's own .app and
      // --args is just unused (harmless).
      const args = ['-a', bundle];
      const appPath = process.env.GATHEROS_APP_PATH;
      if (appPath) args.push('--args', appPath);
      debug('ensureAppRunning: open', args.join(' '));
      spawn('/usr/bin/open', args, { detached: true, stdio: 'ignore', env }).unref();
    } else {
      // Fallback: direct spawn. Should never trigger in practice
      // since the installer always derives the binary from an .app.
      const appPath = process.env.GATHEROS_APP_PATH;
      const args = appPath ? [appPath] : [];
      debug('ensureAppRunning: fallback spawn', bin, args.join(' '));
      spawn(bin, args, { detached: true, stdio: 'ignore', env }).unref();
    }
  } catch (err) {
    debug('ensureAppRunning: spawn threw', err?.message || err);
    return false;
  }

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, LAUNCH_POLL_MS));
    if (await ping()) {
      debug('ensureAppRunning: ping ok after', Math.round((Date.now() - (deadline - LAUNCH_TIMEOUT_MS)) / 1000), 's');
      return true;
    }
  }
  debug('ensureAppRunning: timed out waiting for /ping');
  return false;
}

function postToApp(body, token) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        host: SERVER_HOST,
        port: SERVER_PORT,
        path: '/save',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          'X-GatherOS-Token': token,
          // Spoof a chrome-extension origin so the server's
          // defense-in-depth origin check passes — this process IS
          // the extension's local agent.
          Origin: 'chrome-extension://gatheros-native-host',
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve({ ok: res.statusCode === 200, status: res.statusCode, body: parsed });
          } catch {
            resolve({ ok: false, status: res.statusCode || 0, body: { error: 'malformed response' } });
          }
        });
      },
    );
    req.on('error', (err) => {
      resolve({ ok: false, status: 0, body: { error: err.code === 'ECONNREFUSED' ? 'app not running' : err.message } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(payload);
    req.end();
  });
}

async function handleMessage(msg) {
  debug('handleMessage:', JSON.stringify(msg).slice(0, 200));
  if (!msg || typeof msg !== 'object') {
    writeMessage({ ok: false, error: 'invalid message' });
    return;
  }
  if (msg.type === 'ping') {
    writeMessage({ ok: true, app: 'GatherOS', appRunning: await ping() });
    return;
  }
  if (msg.type === 'save') {
    const ready = await ensureAppRunning();
    if (!ready) {
      writeMessage({ ok: false, error: 'Could not launch GatherOS. Try opening it manually.' });
      return;
    }
    const token = readToken();
    if (!token) {
      debug('handleMessage: no token in prefs.json');
      writeMessage({ ok: false, error: 'GatherOS is not installed or has never been launched.' });
      return;
    }
    const result = await postToApp(
      {
        imageUrl: msg.imageUrl,
        pageUrl: msg.pageUrl || null,
        pageTitle: msg.pageTitle || null,
      },
      token,
    );
    debug('handleMessage: save result', JSON.stringify(result.body).slice(0, 200));
    writeMessage(result.body);
    return;
  }
  writeMessage({ ok: false, error: `unknown message type: ${msg.type}` });
}

function run() {
  debug('run: native-host started, pid', process.pid, 'GATHEROS_BINARY', process.env.GATHEROS_BINARY || '(unset)');
  let buffer = Buffer.alloc(0);

  process.stdin.on('data', async (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const len = buffer.readUInt32LE(0);
      if (len > MAX_MSG) {
        writeMessage({ ok: false, error: 'message too large' });
        process.exit(1);
      }
      if (buffer.length < 4 + len) break;
      const body = buffer.slice(4, 4 + len).toString('utf8');
      buffer = buffer.slice(4 + len);
      try {
        const msg = JSON.parse(body);
        await handleMessage(msg);
      } catch {
        writeMessage({ ok: false, error: 'invalid JSON' });
      }
    }
  });

  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
}

// Allow the script to run as a standalone node process (the dev
// launcher's path) AND be loaded as a module (the packaged-build
// path via index.js's --native-host short-circuit).
if (require.main === module) {
  run();
}

module.exports = { run };
