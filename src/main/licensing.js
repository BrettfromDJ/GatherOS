// Main-process licensing client.
//
// Owns the session token (encrypted at rest with safeStorage) and
// the cached /license/verify response (plain JSON — not sensitive,
// and it gets force-refreshed before being trusted past the offline
// grace window).
//
// Renderer talks to this via IPC. Three flows:
//   1. requestMagicLink(email)
//        → POST /auth/magic-link
//   2. exchangeMagicToken(token)              ← invoked by the deep-link handler
//        → POST /auth/exchange, persist sessionToken
//   3. verifyLicense({ force })
//        → GET /license/verify; on net failure, fall back to cached
//          response if it's within OFFLINE_GRACE_MS

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, safeStorage } = require('electron');

const {
  API_BASE_URL,
  OFFLINE_GRACE_MS,
} = require('../shared/licensing-config');

const SESSION_FILE = 'license-session.bin';
const CACHE_FILE = 'license-cache.json';

function sessionFilePath() {
  return path.join(app.getPath('userData'), SESSION_FILE);
}

function cacheFilePath() {
  return path.join(app.getPath('userData'), CACHE_FILE);
}

// ─────────────────────────────────────────────────────────────────
// Session token (encrypted via safeStorage; falls back to plaintext
// only if the OS keychain isn't available, with a console warning)
// ─────────────────────────────────────────────────────────────────

function getSessionToken() {
  const file = sessionFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    const buf = fs.readFileSync(file);
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    // safeStorage unavailable: we wrote plaintext last time too.
    return buf.toString('utf8');
  } catch (err) {
    console.error('[licensing] failed to read session:', err);
    return null;
  }
}

function setSessionToken(token) {
  const file = sessionFilePath();
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(token);
      fs.writeFileSync(file, enc, { mode: 0o600 });
    } else {
      console.warn('[licensing] safeStorage unavailable; session stored in plaintext');
      fs.writeFileSync(file, token, { mode: 0o600 });
    }
  } catch (err) {
    console.error('[licensing] failed to persist session:', err);
  }
}

function clearSessionToken() {
  try {
    fs.rmSync(sessionFilePath(), { force: true });
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────
// License verify cache (plain JSON; the entitled bit is not secret)
// ─────────────────────────────────────────────────────────────────

function readCache() {
  try {
    const buf = fs.readFileSync(cacheFilePath(), 'utf8');
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    fs.writeFileSync(
      cacheFilePath(),
      JSON.stringify({ ...payload, cached_at: Date.now() }, null, 2),
    );
  } catch (err) {
    console.error('[licensing] failed to write cache:', err);
  }
}

function clearCache() {
  try {
    fs.rmSync(cacheFilePath(), { force: true });
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────
// Network calls
// ─────────────────────────────────────────────────────────────────

async function requestMagicLink(email) {
  if (!email) return { ok: false, error: 'missing_email' };
  try {
    const res = await fetch(`${API_BASE_URL}/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error || `http_${res.status}` };
    return { ok: true };
  } catch (err) {
    console.error('[licensing] requestMagicLink failed:', err);
    return { ok: false, error: 'network' };
  }
}

async function exchangeMagicToken(token) {
  if (!token) return { ok: false, error: 'missing_token' };
  try {
    const res = await fetch(`${API_BASE_URL}/auth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        deviceLabel: `${os.hostname()} (${process.platform})`,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.sessionToken) {
      return { ok: false, error: body?.error || `http_${res.status}` };
    }
    setSessionToken(body.sessionToken);
    // Drop any stale cache so the next verify always hits the wire.
    clearCache();
    return { ok: true, user: body.user };
  } catch (err) {
    console.error('[licensing] exchangeMagicToken failed:', err);
    return { ok: false, error: 'network' };
  }
}

// Returns { state, ... }.
//
//   state: 'entitled'   → app unlocks (trial OR paid)
//   state: 'expired'    → trial done, no paid sub → paywall
//   state: 'unauth'     → no session token; show signin
//   state: 'offline'    → network failed AND no usable cache; we're
//                         being lenient and treating as entitled, but
//                         the renderer should surface a banner so
//                         the user knows they're flying blind
//   state: 'error'      → unrecoverable (bad sessionToken, etc.) →
//                         clear local state and show signin
async function verifyLicense({ force = false } = {}) {
  const sessionToken = getSessionToken();
  if (!sessionToken) return { state: 'unauth' };

  // Cache is fresh enough — short-circuit and avoid an HTTP call on
  // every focus / window-show.
  if (!force) {
    const cached = readCache();
    if (cached && Date.now() - (cached.cached_at || 0) < 60 * 60 * 1000) {
      return cachedToState(cached);
    }
  }

  try {
    const res = await fetch(`${API_BASE_URL}/license/verify`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (res.status === 401) {
      // Session was revoked (signout from another machine, etc.) or
      // the token has rotted. Clear everything and bounce to signin.
      clearSessionToken();
      clearCache();
      return { state: 'unauth' };
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.ok) {
      return fallbackOrError();
    }
    writeCache(body);
    return cachedToState(body);
  } catch (err) {
    console.error('[licensing] verifyLicense network error:', err);
    return fallbackOrError();
  }
}

function cachedToState(payload) {
  if (payload.entitled) {
    return {
      state: 'entitled',
      reason: payload.reason,
      trial_ends_at: payload.trial_ends_at,
      subscription: payload.subscription,
      user: payload.user,
    };
  }
  return {
    state: 'expired',
    trial_ends_at: payload.trial_ends_at,
    subscription: payload.subscription,
    user: payload.user,
  };
}

function fallbackOrError() {
  const cached = readCache();
  if (!cached) return { state: 'error' };
  const age = Date.now() - (cached.cached_at || 0);
  if (age < OFFLINE_GRACE_MS && cached.entitled) {
    return {
      state: 'offline',
      reason: cached.reason,
      trial_ends_at: cached.trial_ends_at,
      subscription: cached.subscription,
      user: cached.user,
    };
  }
  // Cache expired or wasn't entitled to begin with — be strict.
  return cached.entitled
    ? { state: 'error' }
    : cachedToState(cached);
}

async function signOut() {
  const sessionToken = getSessionToken();
  if (sessionToken) {
    try {
      await fetch(`${API_BASE_URL}/auth/signout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
    } catch (err) {
      // Best-effort — clear local even if the network call fails.
      console.error('[licensing] signOut network error:', err);
    }
  }
  clearSessionToken();
  clearCache();
  return { ok: true };
}

module.exports = {
  // Auth
  requestMagicLink,
  exchangeMagicToken,
  signOut,
  // Verify
  verifyLicense,
  // Inspection (used by IPC + tests)
  getSessionToken,
  hasSession: () => !!getSessionToken(),
};
