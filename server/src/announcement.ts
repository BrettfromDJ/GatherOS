// In-app announcements.
//
//   GET  /announcement          public — the desktop app polls this and
//                               renders the current notice (or nothing).
//   POST /announcement          admin  — publish / take down. Gated by the
//                               ADMIN_TOKEN secret (same one /license uses).
//   GET  /announcement/admin    a tiny password-protected web form for
//                               authoring updates from any device.
//
// Each publish inserts a NEW row with a fresh id, so a new message
// re-surfaces even for users who dismissed the previous one. The app
// reads the single most recent row and shows it only while it's active
// and unexpired — so "take it down" is just publishing active = false.

import { Hono } from 'hono';
import type { Env } from './types';
import { bearer } from './auth';

export const announcementRoutes = new Hono<{ Bindings: Env }>();

interface AnnouncementRow {
  id: string;
  title: string | null;
  body: string;
  level: string;
  cta_label: string | null;
  cta_url: string | null;
  active: number;
  created_at: number;
  expires_at: number | null;
}

const LEVELS = new Set(['info', 'warning', 'incident']);

// ── Public read ────────────────────────────────────────────────────
// Returns { ok, announcement: {...} | null }. The most recent row wins;
// if it's inactive or expired the app shows nothing.
announcementRoutes.get('/', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM announcements ORDER BY created_at DESC LIMIT 1`,
  ).first<AnnouncementRow>();

  const now = Date.now();
  const live =
    row &&
    row.active === 1 &&
    (row.expires_at == null || row.expires_at > now);

  // Short client-side cache; the app polls infrequently anyway.
  c.header('Cache-Control', 'public, max-age=60');

  if (!live) return c.json({ ok: true, announcement: null });
  return c.json({
    ok: true,
    announcement: {
      id: row!.id,
      title: row!.title || '',
      body: row!.body,
      level: row!.level,
      ctaLabel: row!.cta_label || '',
      ctaUrl: row!.cta_url || '',
      expiresAt: row!.expires_at,
    },
  });
});

// ── Admin write ────────────────────────────────────────────────────
// Body: { title?, body, level?, ctaLabel?, ctaUrl?, active?, expiresAt? }
// active:false (or empty body) takes the current notice down.
announcementRoutes.post('/', async (c) => {
  const provided = bearer(c.req.header('Authorization'));
  if (!provided || !c.env.ADMIN_TOKEN || provided !== c.env.ADMIN_TOKEN) {
    return c.json({ ok: false, error: 'unauthenticated' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'bad_json' }, 400);
  }

  const active = payload.active === false ? 0 : 1;
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  // Publishing live requires body text; a take-down (active:0) doesn't.
  if (active === 1 && !body) {
    return c.json({ ok: false, error: 'missing_body' }, 400);
  }

  const level =
    typeof payload.level === 'string' && LEVELS.has(payload.level)
      ? payload.level
      : 'info';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const ctaLabel =
    typeof payload.ctaLabel === 'string' ? payload.ctaLabel.trim() : '';
  const ctaUrl =
    typeof payload.ctaUrl === 'string' ? payload.ctaUrl.trim() : '';
  const expiresAt =
    typeof payload.expiresAt === 'number' && Number.isFinite(payload.expiresAt)
      ? payload.expiresAt
      : null;
  // A past expiry would publish-then-immediately-vanish. Reject it with a
  // clear error rather than silently serving nothing.
  if (active === 1 && expiresAt != null && expiresAt <= Date.now()) {
    return c.json({ ok: false, error: 'expiry_in_past' }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO announcements
       (id, title, body, level, cta_label, cta_url, active, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      title || null,
      body || (active === 1 ? '' : '(taken down)'),
      level,
      ctaLabel || null,
      ctaUrl || null,
      active,
      Date.now(),
      expiresAt,
    )
    .run();

  return c.json({ ok: true, id, active: active === 1 });
});

// ── Admin web form ─────────────────────────────────────────────────
// A self-contained page (no build step). It stores the admin token in
// localStorage so you only paste it once, previews the live notice, and
// posts to the routes above. Open https://api.gatheros.co/announcement/admin
announcementRoutes.get('/admin', (c) => {
  c.header('Content-Type', 'text/html; charset=utf-8');
  // Disallow indexing/framing of the admin page.
  c.header('X-Robots-Tag', 'noindex');
  return c.body(ADMIN_HTML);
});

const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>GatherOS — announcements</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    margin: 0; padding: 32px 18px; background: #0e0e10; color: #eee;
    display: flex; justify-content: center;
  }
  .wrap { width: 100%; max-width: 560px; }
  h1 { font-size: 20px; letter-spacing: -0.02em; margin: 0 0 4px; }
  .sub { color: #999; font-size: 13px; margin: 0 0 24px; }
  label { display: block; font-size: 12px; font-weight: 600; color: #aaa;
          letter-spacing: 0.01em; margin: 16px 0 6px; text-transform: uppercase; }
  input, textarea, select {
    width: 100%; padding: 10px 12px; border-radius: 9px; border: 1px solid #2c2c30;
    background: #18181b; color: #eee; font: inherit; outline: none;
  }
  input:focus, textarea:focus, select:focus { border-color: #5b8cff; }
  textarea { min-height: 130px; resize: vertical; }
  .row { display: flex; gap: 10px; }
  .row > div { flex: 1; }
  .actions { display: flex; gap: 10px; margin-top: 22px; }
  button {
    flex: 1; padding: 12px; border-radius: 10px; border: none; font: inherit;
    font-weight: 600; cursor: pointer;
  }
  .publish { background: #5b8cff; color: #fff; }
  .takedown { background: transparent; color: #ff7676; border: 1px solid #3a2424; }
  button:disabled { opacity: 0.5; cursor: default; }
  .msg { margin-top: 16px; font-size: 13px; min-height: 18px; }
  .ok { color: #5fd08a; } .err { color: #ff7676; }
  .live { margin-top: 28px; padding: 14px; border: 1px solid #2c2c30; border-radius: 12px;
          background: #141416; }
  .live h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
             color: #888; margin: 0 0 8px; }
  .live .none { color: #777; font-size: 13px; }
  .live .t { font-weight: 700; }
  .live .b { white-space: pre-wrap; color: #ccc; margin-top: 4px; font-size: 14px; }
  .pill { display: inline-block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
          padding: 2px 7px; border-radius: 99px; background: #2a2a30; color: #bbb; margin-left: 6px; }
  .hint { color: #777; font-size: 12px; margin-top: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Announcements</h1>
  <p class="sub">Push a notice to every running copy of GatherOS — no release needed. Heading optional; body supports longform (line breaks are preserved).</p>

  <label>Password</label>
  <input id="token" type="password" placeholder="Your publish password" autocomplete="off" />

  <label>Heading <span style="text-transform:none;font-weight:400;color:#777">(optional)</span></label>
  <input id="title" type="text" placeholder="e.g. Instagram sync is delayed" />

  <label>Body</label>
  <textarea id="body" placeholder="Write the announcement. Blank lines become paragraphs."></textarea>

  <div class="row">
    <div>
      <label>Level</label>
      <select id="level">
        <option value="info">Info</option>
        <option value="warning">Warning</option>
        <option value="incident">Incident</option>
      </select>
    </div>
    <div>
      <label>Auto-expire <span style="text-transform:none;font-weight:400;color:#777">(optional)</span></label>
      <input id="expires" type="datetime-local" />
      <div class="hint">Leave blank to stay up until you take it down.</div>
    </div>
  </div>

  <div class="row">
    <div>
      <label>Button label <span style="text-transform:none;font-weight:400;color:#777">(optional)</span></label>
      <input id="ctaLabel" type="text" placeholder="e.g. Status page" />
    </div>
    <div>
      <label>Button link</label>
      <input id="ctaUrl" type="text" placeholder="https://…" />
    </div>
  </div>

  <div class="actions">
    <button class="publish" id="publish">Publish</button>
    <button class="takedown" id="takedown">Take down current</button>
  </div>
  <div class="msg" id="msg"></div>

  <div class="live">
    <h2>Currently live</h2>
    <div id="liveBox" class="none">Loading…</div>
  </div>
</div>

<script>
  var $ = function (id) { return document.getElementById(id); };
  var TOKEN_KEY = 'gatherosAnnounceToken';
  $('token').value = localStorage.getItem(TOKEN_KEY) || '';
  $('token').addEventListener('change', function () {
    localStorage.setItem(TOKEN_KEY, $('token').value.trim());
  });

  function setMsg(text, ok) {
    var el = $('msg'); el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'err');
  }

  function refreshLive() {
    fetch('/announcement', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) {
        var box = $('liveBox');
        if (!d.announcement) { box.className = 'none'; box.textContent = 'Nothing live right now.'; return; }
        var a = d.announcement;
        box.className = '';
        box.innerHTML = '';
        var t = document.createElement('div'); t.className = 't';
        t.textContent = a.title || '(no heading)';
        var pill = document.createElement('span'); pill.className = 'pill'; pill.textContent = a.level;
        t.appendChild(pill);
        var b = document.createElement('div'); b.className = 'b'; b.textContent = a.body;
        box.appendChild(t); box.appendChild(b);
      })
      .catch(function () {});
  }

  function post(active) {
    var token = $('token').value.trim();
    if (!token) { setMsg('Enter your password first.', false); return; }
    var expires = $('expires').value ? new Date($('expires').value).getTime() : null;
    if (active && expires && expires <= Date.now()) {
      setMsg('Auto-expire is in the past — leave it blank or pick a future time.', false);
      return;
    }
    var payload = {
      active: active,
      title: $('title').value,
      body: $('body').value,
      level: $('level').value,
      ctaLabel: $('ctaLabel').value,
      ctaUrl: $('ctaUrl').value,
      expiresAt: expires,
    };
    $('publish').disabled = true; $('takedown').disabled = true;
    fetch('/announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (res) {
        if (res.status === 401) { setMsg('Wrong password.', false); }
        else if (res.d.error === 'expiry_in_past') { setMsg('Auto-expire is in the past — leave it blank or pick a future time.', false); }
        else if (res.d.error === 'missing_body') { setMsg('Add some body text before publishing.', false); }
        else if (!res.d.ok) { setMsg('Failed: ' + (res.d.error || 'unknown'), false); }
        else if (active) { setMsg('Published. It is now live.', true); }
        else { setMsg('Taken down.', true); }
        refreshLive();
      })
      .catch(function (e) { setMsg('Network error: ' + e.message, false); })
      .finally(function () { $('publish').disabled = false; $('takedown').disabled = false; });
  }

  $('publish').addEventListener('click', function () { post(true); });
  $('takedown').addEventListener('click', function () { post(false); });
  refreshLive();
</script>
</body>
</html>`;
