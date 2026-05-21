// Native messaging host — relays messages from the Chrome
// extension to the running desktop app's local HTTP server.
//
// Chrome spawns the GatherOS binary with `--native-host` whenever
// the extension calls chrome.runtime.sendNativeMessage(). index.js
// detects that flag at startup and hands control here BEFORE the
// rest of the app (single-instance lock, db init, window creation)
// runs. The host process is single-purpose and stdin-driven:
//
//   1. Read a length-prefixed JSON message from stdin
//   2. POST it to http://127.0.0.1:53247/save with the user's
//      extension token (read from prefs.json on disk)
//   3. Write the response back to stdout in the same format
//   4. When stdin closes (extension disconnected), exit
//
// Native messaging framing: each message is uint32 little-endian
// length followed by that many bytes of UTF-8 JSON. See
// https://developer.chrome.com/docs/apps/nativeMessaging/#native-messaging-host-protocol
//
// This file MUST NOT require electron's app/BrowserWindow/etc.
// Chrome launches the host fresh per session, so loading the full
// app would be both wrong (extra processes, port collisions with
// the running app) and slow.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 53247;
const MAX_MSG = 1024 * 1024; // 1 MB — Chrome's per-message cap is 64MB but we don't need bulk

function prefsFilePath() {
  // Mirror app.getPath('userData') without requiring electron.
  // macOS-only for now — matches the desktop app's distribution.
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
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
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
    writeMessage({ ok: true, app: 'GatherOS', appRunning: !!readToken() });
    return;
  }
  if (msg.type === 'save') {
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
  // Length-prefixed JSON read loop on stdin. Chrome sends one
  // message per connection in most cases but the protocol allows
  // multiple, so we keep reading until stdin closes.
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

module.exports = { run };
