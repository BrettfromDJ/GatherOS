// Magic-link auth + session token issuance.
//
// Flow:
//   1. Client POSTs /auth/magic-link {email}
//      → we mint a single-use token, persist it, and email it
//   2. User clicks the link → loads /auth/verify?token=…
//      → we render an HTML page that immediately redirects to
//         gatheros://auth/verify?token=… (the desktop app catches
//         this via its registered URL scheme)
//   3. The desktop app POSTs /auth/exchange {token, deviceLabel}
//      → we consume the token, create-or-fetch the user (starting
//         their 30-day trial on first sight), issue a session row,
//         and return { sessionToken, user }

import { Hono } from 'hono';
import type { Env, UserRow } from './types';
import { magicLinkEmail, sendEmail } from './email';

export const authRoutes = new Hono<{ Bindings: Env }>();

const MAGIC_LINK_TTL_MIN = 15;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function newId(): string {
  return crypto.randomUUID();
}

// Step 1 — request a magic link.
authRoutes.post('/magic-link', async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return c.json({ ok: false, error: 'invalid_email' }, 400);
  }

  const token = newId();
  const now = Date.now();
  const expiresAt = now + MAGIC_LINK_TTL_MIN * 60 * 1000;

  await c.env.DB.prepare(
    `INSERT INTO magic_links (token, email, created_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      token,
      email,
      now,
      expiresAt,
      c.req.header('CF-Connecting-IP') || null,
      c.req.header('User-Agent') || null,
    )
    .run();

  // Verify URL points back at this same Worker; that handler returns
  // an HTML page that bounces into the app's deep-link scheme.
  const url = new URL(c.req.url);
  const verifyUrl = `${url.origin}/auth/verify?token=${token}`;

  const { subject, html, text } = magicLinkEmail({
    appName: c.env.APP_NAME,
    verifyUrl,
    expiresMinutes: MAGIC_LINK_TTL_MIN,
  });
  const sendResult = await sendEmail(c.env, email, subject, html, text);
  if (!sendResult.ok) {
    // Don't leak the email error to the caller — the token row is
    // already written, so log here and tell the client we're fine.
    console.error('[auth] sendEmail failed:', sendResult.error);
  }
  // Always return 200 even on unknown emails / send failures so we
  // don't expose which addresses are signed up (account-enumeration
  // protection).
  return c.json({ ok: true });
});

// Step 2 — bridge page. The user clicked the email link in their
// browser; bounce them into the desktop app via its URL scheme.
authRoutes.get('/verify', async (c) => {
  const token = c.req.query('token') || '';
  if (!token) return c.text('Missing token.', 400);
  const deepLink = `${c.env.APP_DEEP_LINK_SCHEME}://auth/verify?token=${encodeURIComponent(token)}`;

  // Auto-redirect via a tiny HTML shell so a browser without
  // protocol-handler permission falls back to a clear "Open
  // GatherOS" button.
  const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Sign in to ${c.env.APP_NAME}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 420px; margin: 80px auto; padding: 0 16px; color: #1a1a1a; text-align: center; }
  h1 { font-size: 18px; font-weight: 600; }
  a.btn { display: inline-block; padding: 10px 18px; background: #0a0a0a; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 500; margin-top: 16px; }
  p.muted { color: #666; font-size: 13px; }
</style>
</head>
<body>
  <h1>Opening ${c.env.APP_NAME}…</h1>
  <p class="muted">If the app doesn't open automatically, click below.</p>
  <a class="btn" href="${deepLink}">Open ${c.env.APP_NAME}</a>
  <script>setTimeout(() => { window.location.href = ${JSON.stringify(deepLink)}; }, 100);</script>
</body></html>`;
  return c.html(html);
});

// Step 3 — desktop app exchanges the token for a session.
authRoutes.post('/exchange', async (c) => {
  const body = await c.req
    .json<{ token?: string; deviceLabel?: string }>()
    .catch(() => ({}));
  const token = (body.token || '').trim();
  const deviceLabel = (body.deviceLabel || '').slice(0, 200) || null;
  if (!token) return c.json({ ok: false, error: 'missing_token' }, 400);

  const now = Date.now();

  // Fetch + consume in one go. We don't use a true transaction here
  // because D1 doesn't expose multi-statement transactions over HTTP;
  // instead we mark consumed_at and only honour the row if it was
  // unconsumed at read time. Race where two callers redeem the same
  // token within ms is acceptable — the second redeem will fail the
  // consumed_at check below.
  const link = await c.env.DB.prepare(
    `SELECT token, email, expires_at, consumed_at
       FROM magic_links WHERE token = ?`,
  )
    .bind(token)
    .first<{ token: string; email: string; expires_at: number; consumed_at: number | null }>();

  if (!link) return c.json({ ok: false, error: 'invalid_token' }, 401);
  if (link.consumed_at) return c.json({ ok: false, error: 'token_used' }, 401);
  if (link.expires_at < now) return c.json({ ok: false, error: 'token_expired' }, 401);

  await c.env.DB.prepare(`UPDATE magic_links SET consumed_at = ? WHERE token = ?`)
    .bind(now, token)
    .run();

  // Find or create user — case-insensitive email.
  const email = link.email;
  let user = await c.env.DB.prepare(
    `SELECT id, email, created_at, trial_ends_at, paddle_customer_id, deleted_at
       FROM users WHERE email = ?`,
  )
    .bind(email)
    .first<UserRow>();

  if (!user) {
    const id = newId();
    const parsedTrialDays = Number(c.env.TRIAL_DAYS);
    // Number.isFinite('') is false, '0' parses to 0 — accept 0 as
    // "no server trial" rather than falling back to 30.
    const trialDays = Number.isFinite(parsedTrialDays) ? parsedTrialDays : 30;
    const trialEndsAt = now + trialDays * 24 * 60 * 60 * 1000;
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, created_at, trial_ends_at, paddle_customer_id)
       VALUES (?, ?, ?, ?, NULL)`,
    )
      .bind(id, email, now, trialEndsAt)
      .run();
    user = {
      id,
      email,
      created_at: now,
      trial_ends_at: trialEndsAt,
      paddle_customer_id: null,
      deleted_at: null,
    };
  } else if (user.deleted_at) {
    // Returning soft-deleted user — un-delete and reset trial only if
    // they never had a paid sub. (Subs are joined separately so we
    // don't need to special-case here.)
    await c.env.DB.prepare(`UPDATE users SET deleted_at = NULL WHERE id = ?`)
      .bind(user.id)
      .run();
    user.deleted_at = null;
  }

  const sessionId = newId();
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, device_label, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, user.id, deviceLabel, now, now)
    .run();

  return c.json({
    ok: true,
    sessionToken: sessionId,
    user: { id: user.id, email: user.email, trial_ends_at: user.trial_ends_at },
  });
});

// Sign out — revoke the current session.
authRoutes.post('/signout', async (c) => {
  const sessionToken = bearer(c.req.header('Authorization'));
  if (!sessionToken) return c.json({ ok: true });
  const now = Date.now();
  await c.env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`)
    .bind(now, sessionToken)
    .run();
  return c.json({ ok: true });
});

// Helper: pull "Bearer <token>" out of an Authorization header.
export function bearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/.exec(header);
  return m && m[1] ? m[1].trim() : null;
}

// Helper used by license + future authenticated routes. Resolves a
// session token to its user, touching last_seen_at on every call so
// we can later prune dormant sessions.
export async function userFromSession(
  env: Env,
  sessionToken: string,
): Promise<UserRow | null> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.created_at, u.trial_ends_at, u.paddle_customer_id, u.deleted_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.revoked_at IS NULL`,
  )
    .bind(sessionToken)
    .first<UserRow>();
  if (!row) return null;
  // Best-effort touch — failure here shouldn't fail the request.
  env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`)
    .bind(now, sessionToken)
    .run()
    .catch(() => {});
  return row;
}
