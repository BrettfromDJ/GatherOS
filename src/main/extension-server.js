// Localhost HTTP server that lets the GatherOS browser extension
// push saves into the running app. Bound to 127.0.0.1 only and
// gated on a shared token the user copies from Settings → Capture
// into the extension's Options page. Lives on a fixed port so the
// extension doesn't have to discover it.
//
// One endpoint:
//   POST /save  { imageUrl, pageUrl?, pageTitle? }  with header X-GatherOS-Token
//
// Plus an unauthenticated GET /ping for the extension's "Test
// connection" button.

const http = require('node:http');
const crypto = require('node:crypto');

const PORT = 53247;
const HOST = '127.0.0.1';
const MAX_BODY = 8 * 1024; // 8 kB JSON cap — URLs + titles, nothing bulky

let server = null;
let cachedToken = null;

// Lazily generate + persist a 32-byte base64url token the first time
// it's needed. Re-reading the pref later returns the same value, so
// the extension can keep using a token it pasted previously.
function getOrCreateToken() {
  if (cachedToken) return cachedToken;
  const settings = require('./settings');
  let token = settings.getPref('extensionToken', null);
  if (!token || typeof token !== 'string' || token.length < 32) {
    token = crypto.randomBytes(32).toString('base64url');
    settings.setPref('extensionToken', token);
  }
  cachedToken = token;
  return token;
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    // The MV3 service worker with host_permissions usually skips
    // CORS entirely, but adding the headers means a regular fetch
    // from an Options page also works without surprises.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-GatherOS-Token',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function handleSave(req, res) {
  // Defense in depth: the token is the real check, but rejecting
  // anything that isn't a browser-extension origin keeps stray
  // web-page fetches from even reaching the auth path.
  const origin = req.headers.origin || '';
  if (origin && !origin.startsWith('chrome-extension://') && !origin.startsWith('moz-extension://')) {
    sendJson(res, 403, { ok: false, error: 'forbidden origin' });
    return;
  }

  const token = req.headers['x-gatheros-token'];
  if (!token || token !== getOrCreateToken()) {
    sendJson(res, 401, { ok: false, error: 'invalid token' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid body' });
    return;
  }

  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    sendJson(res, 400, { ok: false, error: 'imageUrl required (http/https)' });
    return;
  }

  try {
    const { saveImageFromUrl } = require('./storage');
    const { insertSave } = require('./db');
    const { notifySaved, notifyDuplicate } = require('./notify');

    const imgData = await saveImageFromUrl(imageUrl);
    if (imgData.duplicateOf) {
      notifyDuplicate(imgData.existing);
      sendJson(res, 200, { ok: true, duplicate: true, id: imgData.existing.id });
      return;
    }
    // Preserve the page the user was browsing — that's the whole
    // value of a browser save over drag-drop.
    const pageUrl = typeof body?.pageUrl === 'string' ? body.pageUrl : null;
    const record = insertSave({ ...imgData, sourceUrl: pageUrl || imageUrl });
    notifySaved(record);
    sendJson(res, 200, { ok: true, id: record.id });
  } catch (err) {
    console.error('[ext-server] /save failed:', err?.message || err);
    sendJson(res, 500, { ok: false, error: err?.message || 'save failed' });
  }
}

function start() {
  if (server) return;
  // Trigger the token init now so the renderer's first prefs read
  // already sees it.
  getOrCreateToken();

  server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }
    if (req.method === 'GET' && req.url === '/ping') {
      sendJson(res, 200, { ok: true, app: 'GatherOS' });
      return;
    }
    if (req.method === 'POST' && req.url === '/save') {
      handleSave(req, res);
      return;
    }
    sendJson(res, 404, { ok: false, error: 'not found' });
  });

  server.on('error', (err) => {
    console.error('[ext-server] listen error:', err?.message || err);
  });

  server.listen(PORT, HOST, () => {
    console.log(`[ext-server] listening on http://${HOST}:${PORT}`);
  });
}

function stop() {
  if (!server) return;
  server.close();
  server = null;
}

module.exports = { start, stop, getOrCreateToken, PORT };
