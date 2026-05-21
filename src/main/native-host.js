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
const LAUNCH_TIMEOUT_MS = 15_000;
const LAUNCH_POLL_MS = 300;

function prefsFilePath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'GatherOS', 'prefs.json');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'GatherOS', 'prefs.json');
  }
  return path.join(os.homedir(), '.config', 'GatherOS', 'prefs.json');
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

// Launch the main GatherOS app and wait until the local server is
// responding to /ping. The launcher passes the right binary in
// GATHEROS_BINARY and (in dev) the project root in GATHEROS_APP_PATH.
async function ensureAppRunning() {
  if (await ping()) return true;

  const bin = process.env.GATHEROS_BINARY;
  if (!bin) return false;

  const appPath = process.env.GATHEROS_APP_PATH;
  const args = appPath ? [appPath] : [];
  try {
    spawn(bin, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    return false;
  }

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, LAUNCH_POLL_MS));
    if (await ping()) return true;
  }
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
    writeMessage(result.body);
    return;
  }
  writeMessage({ ok: false, error: `unknown message type: ${msg.type}` });
}

function run() {
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
