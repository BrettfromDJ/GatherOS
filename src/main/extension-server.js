// Localhost HTTP server that lets the GatherOS browser extension
// push saves into the running app. Bound to 127.0.0.1 only and
// gated on a shared token the user copies from Settings → Capture
// into the extension's Options page. Lives on a fixed port so the
// extension doesn't have to discover it.
//
// One endpoint:
//   POST /save  { imageUrl?, videoUrl?, posterUrl?, pageUrl?, pageTitle?, notes?, tweetMeta?, tags? }  with header X-GatherOS-Token
//
// Plus an unauthenticated GET /ping for the extension's "Test
// connection" button.

const http = require('node:http');
const crypto = require('node:crypto');

const PORT = 53247;
const HOST = '127.0.0.1';
// Big enough for a base64 screen-capture data URL (the extension's
// "capture page / area"). The native-messaging bridge caps the source
// payload at ~1 MB, so 2 MB here is comfortable headroom; ordinary
// URL/title saves are still a few hundred bytes.
const MAX_BODY = 2 * 1024 * 1024;

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

  // Free tier: new saves require an upgrade. Surface the prompt in the
  // app window and tell the extension so it can show its own notice.
  // Fails OPEN — any error resolving entitlement allows the save.
  try {
    const { canCreateSave } = require('./entitlement');
    if (!canCreateSave()) {
      try { require('./notify').notifyNeedsUpgrade({ source: 'extension' }); } catch {}
      sendJson(res, 402, { ok: false, needsUpgrade: true, error: 'upgrade required' });
      return;
    }
  } catch { /* fail open */ }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid body' });
    return;
  }

  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const videoUrl = typeof body?.videoUrl === 'string' ? body.videoUrl.trim() : '';
  const posterUrl = typeof body?.posterUrl === 'string' ? body.posterUrl.trim() : '';
  const pageUrl = typeof body?.pageUrl === 'string' ? body.pageUrl.trim() : '';
  // X-bookmark structured payload. Stored as JSON in saves.tweet_meta so
  // DetailPanel can render the glass tweet card (author + handle + avatar
  // + caption + every image on the tweet). Also drives the text-only
  // tweet branch below, which renders the card itself to an image.
  const tweetMeta = (body && typeof body.tweetMeta === 'object' && body.tweetMeta !== null)
    ? body.tweetMeta
    : null;
  // Need at least one of: an image, a video, or a page URL. The X-
  // bookmark capture sends videoUrl for video-only tweets; right-click
  // sends an http(s) imageUrl; the extension's "capture page / area"
  // sends a data:image imageUrl; "save URL" sends only pageUrl, which
  // we screenshot into a kind='url' save below.
  if (!imageUrl && !videoUrl && !pageUrl) {
    sendJson(res, 400, { ok: false, error: 'imageUrl, videoUrl, or pageUrl required' });
    return;
  }
  // imageUrl may be http(s) (right-click / bookmark) or a data:image
  // URL (extension screen capture). Reject anything else.
  if (imageUrl && !/^https?:\/\//i.test(imageUrl) && !/^data:image\//i.test(imageUrl)) {
    sendJson(res, 400, { ok: false, error: 'imageUrl must be http(s) or a data:image URL' });
    return;
  }
  if (videoUrl && !/^https?:\/\//i.test(videoUrl)) {
    sendJson(res, 400, { ok: false, error: 'videoUrl must be http/https' });
    return;
  }

  try {
    const { saveImageFromUrl, saveVideoFromUrl } = require('./storage');
    const { insertSave, isTweetDismissed, tweetKeyFromUrl } = require('./db');
    const { notifySaved, notifyDuplicate, notifyBookmarkSaved } = require('./notify');

    // X bookmark syncs (tweetMeta present) get the quiet, batched
    // notifier so scrolling the list doesn't flood the grid. A bookmark
    // the user already removed from Gather is skipped entirely — the
    // tombstone makes deletions stick across re-scrolls.
    const isBookmark = !!tweetMeta;
    const tweetKey = tweetKeyFromUrl(pageUrl);
    // Explicit "Import bookmarks" backfill sends forceImport: the user is
    // deliberately pulling their X bookmarks, so honor it even for ones
    // they previously removed — lift the tombstone and save. Passive sync
    // (no flag) still respects deletions so re-scrolls don't resurrect
    // anything the user trashed.
    const forceImport = body?.forceImport === true;
    if (isBookmark && tweetKey && isTweetDismissed(tweetKey)) {
      if (forceImport) {
        const { undismissTweet } = require('./db');
        undismissTweet(tweetKey);
      } else {
        sendJson(res, 200, { ok: true, dismissed: true });
        return;
      }
    }
    const notifyNew = isBookmark ? notifyBookmarkSaved : notifySaved;

    // Optional tag list — currently used by the X-bookmark capture to
    // auto-tag every X save with 'x:bookmark' so the user can filter
    // their library to just bookmarks from X. Each entry routes through
    // addTagToSave which trims, lowercases, and dedupes.
    const attachTags = (saveId) => {
      if (!Array.isArray(body?.tags) || !body.tags.length) return;
      const { addTagToSave } = require('./db');
      for (const t of body.tags) {
        if (typeof t === 'string' && t.trim()) {
          try { addTagToSave({ saveId, name: t }); }
          catch (err) { console.warn('[ext-server] tag attach failed:', err?.message || err); }
        }
      }
    };

    // Text-only tweet (no media): render the tweet card itself to an
    // image so it lands in the library like any other save, with the
    // structured tweet_meta preserved for the X badge + detail card.
    // Must come before the URL-only branch below — a text tweet still
    // carries pageUrl (the tweet permalink), which we must NOT
    // screenshot; we render the card instead.
    if (!imageUrl && !videoUrl && tweetMeta && (
      (typeof tweetMeta.caption === 'string' && tweetMeta.caption.trim())
      || (typeof tweetMeta.authorName === 'string' && tweetMeta.authorName.trim())
    )) {
      const { captureTweetCard } = require('./tweetCardCapture');
      const captured = await captureTweetCard(tweetMeta);
      if (captured.duplicateOf) {
        notifyDuplicate(captured.existing);
        sendJson(res, 200, { ok: true, duplicate: true, id: captured.existing.id });
        return;
      }
      const tweetRecord = insertSave({
        ...captured,
        sourceUrl: pageUrl || null,
        title: null,
        tweetMeta,
        // kind='tweet' lets the renderer draw a live, theme-aware text
        // card from tweet_meta instead of showing the captured PNG. The
        // PNG still backs file_path/thumb_path so thumbnails, export,
        // dedupe and OCR-search keep working.
        kind: 'tweet',
      });
      attachTags(tweetRecord.id);
      notifyNew(tweetRecord);
      sendJson(res, 200, { ok: true, id: tweetRecord.id });
      return;
    }

    // URL-only save (extension "save URL"): no media to download —
    // screenshot the page via a hidden BrowserWindow and store it as
    // a kind='url' save, mirroring the drag-drop-a-URL path.
    if (!imageUrl && !videoUrl && pageUrl) {
      const { captureUrl } = require('./urlCapture');
      const captured = await captureUrl(pageUrl);
      if (captured.duplicateOf) {
        notifyDuplicate(captured.existing);
        sendJson(res, 200, { ok: true, duplicate: true, id: captured.existing.id });
        return;
      }
      const pageTitle = typeof body?.pageTitle === 'string' ? body.pageTitle.trim() : '';
      const urlRecord = insertSave({
        ...captured,
        sourceUrl: pageUrl,
        title: pageTitle || captured.title || null,
        kind: 'url',
      });
      notifySaved(urlRecord);
      sendJson(res, 200, { ok: true, id: urlRecord.id });
      return;
    }

    // Branch on whether the capture is a video or an image. Tweets
    // with both still images and a video bookmark as an image
    // (the still is what the user usually wants in a moodboard); we
    // only enter the video branch when there's no image at all.
    const mediaData = (videoUrl && !imageUrl)
      ? await saveVideoFromUrl(videoUrl, posterUrl || null)
      : await saveImageFromUrl(imageUrl);
    if (mediaData.duplicateOf) {
      notifyDuplicate(mediaData.existing);
      sendJson(res, 200, { ok: true, duplicate: true, id: mediaData.existing.id });
      return;
    }
    // pageUrl (parsed above) preserves the page the user was browsing
    // — that's the whole value of a browser save over drag-drop.
    // Optional title — both current extension flows leave it blank
    // so the existing autonamer takes over.
    const pageTitle = typeof body?.pageTitle === 'string' ? body.pageTitle.trim() : null;
    // Optional notes — same. Left blank by both current flows.
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : null;
    const record = insertSave({
      ...mediaData,
      sourceUrl: pageUrl || imageUrl || videoUrl,
      title: pageTitle || mediaData.title || null,
      notes: notes || null,
      tweetMeta,
    });
    attachTags(record.id);
    notifyNew(record);
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
