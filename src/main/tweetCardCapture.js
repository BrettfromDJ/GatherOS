// Render a text-only tweet into an image for the library. Mirrors
// urlCapture.js: spawn a hidden BrowserWindow, load a self-contained
// tweet-card HTML built from the captured tweet_meta (author, handle,
// avatar, caption — no engagement counts or timestamp, which we don't
// capture), measure the card's height, resize to fit, and capturePage
// to a PNG. The PNG then runs through the same saveImageFromBuffer
// pipeline real image saves use (dedupe via content hash, palette,
// thumbnail), so a saved text tweet behaves exactly like any other
// image save — the grid X badge and DetailPanel caption card key off
// the tweet_meta we persist alongside it.
//
// Returns the saveImageFromBuffer shape:
//   { filePath, thumbPath, width, height, fileSize, palette,
//     contentHash, duplicateOf?, existing? }

const { BrowserWindow } = require('electron');
const { saveImageFromBuffer } = require('./storage');

// Card width in CSS px. The capture happens at the display's scale
// factor, so text stays crisp on retina. Edge-to-edge — the grid's
// own frame rounds the corners.
const CARD_WIDTH = 480;
// Brief settle so the remote avatar image decodes before we snap.
const SETTLE_MS = 350;
const LOAD_TIMEOUT_MS = 9000;
// Hard ceiling so a pathologically long tweet can't produce a giant
// bitmap. The offscreen window is created this tall up front so the
// whole card is laid out and capturable in one rect snap — no resize
// round-trip (whose repaint timing is fragile for capturePage).
const MAX_HEIGHT = 2200;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function initialsOf(meta) {
  const src = (meta.authorName || meta.authorHandle || '?').replace(/^@/, '').trim();
  return (src.slice(0, 1) || '?').toUpperCase();
}

function buildHtml(meta) {
  const name = escapeHtml(meta.authorName || meta.authorHandle || 'Unknown');
  const handleRaw = (meta.authorHandle || '').trim();
  const handle = handleRaw
    ? escapeHtml(handleRaw.startsWith('@') ? handleRaw : `@${handleRaw}`)
    : '';
  const caption = escapeHtml(meta.caption || '').replace(/\n/g, '<br>');
  const avatarUrl = (typeof meta.authorAvatarUrl === 'string' && /^https?:\/\//i.test(meta.authorAvatarUrl))
    ? escapeHtml(meta.authorAvatarUrl)
    : '';
  const initials = escapeHtml(initialsOf(meta));
  // Thread: render each self-reply as a hairline-separated block.
  const thread = Array.isArray(meta.thread) && meta.thread.length > 1 ? meta.thread : null;
  const bodyHtml = thread
    ? `<div class="thread">${thread
        .filter((p) => p && (p.text || '').trim())
        .map((p) => `<div class="part">${escapeHtml(p.text).replace(/\n/g, '<br>')}</div>`)
        .join('')}</div>`
    : (caption ? `<div class="text">${caption}</div>` : '');
  // Official X logomark, inked dark to sit on the white card.
  const xLogo = '<svg viewBox="0 0 24 24" width="21" height="21"><path fill="#0f1419" d="M17.53 3h2.97l-6.49 7.41L21.75 21h-5.97l-4.68-6.12L5.74 21H2.77l6.94-7.93L2.25 3h6.12l4.23 5.59L17.53 3Zm-1.04 16.2h1.64L7.6 4.71H5.83L16.49 19.2Z"/></svg>';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{background:#ffffff}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
    .card{width:${CARD_WIDTH}px;background:#ffffff;padding:22px 24px 24px;color:#0f1419}
    .head{display:flex;align-items:center;gap:12px}
    .avatar{position:relative;width:44px;height:44px;flex:none;border-radius:50%;overflow:hidden;
      background:linear-gradient(140deg,#5b6b86,#33405a);display:flex;align-items:center;justify-content:center}
    .avatar .ini{color:#fff;font-weight:700;font-size:18px;letter-spacing:-.02em}
    .avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
    .id{min-width:0;line-height:1.25}
    .name{font-weight:700;font-size:16px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .handle{color:#536471;font-size:15px}
    .x{margin-left:auto;flex:none;display:flex}
    .text{font-size:19px;line-height:1.42;letter-spacing:-.003em;margin-top:14px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word}
    .thread{margin-top:14px}
    .part{font-size:18px;line-height:1.42;letter-spacing:-.003em;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word}
    .part + .part{margin-top:11px;padding-top:11px;border-top:1px solid rgba(0,0,0,0.1)}
  </style></head><body>
    <div class="card" id="card">
      <div class="head">
        <span class="avatar"><span class="ini">${initials}</span>${avatarUrl ? `<img src="${avatarUrl}" onerror="this.remove()" />` : ''}</span>
        <span class="id"><div class="name">${name}</div>${handle ? `<div class="handle">${handle}</div>` : ''}</span>
        <span class="x">${xLogo}</span>
      </div>
      ${bodyHtml}
    </div>
  </body></html>`;
}

async function captureTweetCard(meta) {
  const html = buildHtml(meta || {});
  const win = new BrowserWindow({
    show: false,
    width: CARD_WIDTH,
    // Tall enough that any reasonable tweet lays out fully; we snap an
    // exact rect of the measured card height below.
    height: MAX_HEIGHT,
    webPreferences: {
      preload: undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Reuse the URL-capture partition — fresh-ish session, no bleed
      // into the app's own storage.
      partition: 'persist:url-capture',
    },
  });

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      win.webContents.once('did-finish-load', () => {
        if (settled) return;
        settled = true;
        setTimeout(resolve, SETTLE_MS);
      });
      win.webContents.once('did-fail-load', (_e, code, desc) => {
        if (settled) return;
        settled = true;
        reject(new Error(`tweet card load failed: ${desc} (${code})`));
      });
      setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('tweet card load timed out'));
      }, LOAD_TIMEOUT_MS);
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(reject);
    });

    // Measure the rendered card so the capture is sized exactly to it
    // (no trailing whitespace, no clipping of a tall tweet).
    let height = 360;
    try {
      const measured = await win.webContents.executeJavaScript(
        'Math.ceil((document.getElementById("card") || document.body).getBoundingClientRect().height)',
        true,
      );
      if (Number.isFinite(measured) && measured > 0) height = measured;
    } catch { /* keep the default height */ }
    height = Math.max(80, Math.min(MAX_HEIGHT, Math.round(height)));

    // Snap exactly the card's rect from the (taller) viewport — no
    // trailing whitespace, no clipping.
    const image = await win.webContents.capturePage({
      x: 0, y: 0, width: CARD_WIDTH, height,
    });
    const buffer = image.toPNG();
    return await saveImageFromBuffer(buffer, 'png');
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { captureTweetCard };
