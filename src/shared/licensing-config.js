// Single source of truth for licensing config. Both main and
// renderer import this — keep it CommonJS so it works in either.
//
// All values default to dev / sandbox. Override at build time via
// env vars (or by editing this file before packaging) for staging
// and production builds.

const env = (typeof process !== 'undefined' && process.env) || {};

// Where the licensing Worker lives. wrangler dev defaults to
// http://localhost:8787; the production deploy will live at
// (e.g.) https://api.gatheros.app.
const API_BASE_URL =
  env.GATHEROS_API_BASE_URL ||
  (env.NODE_ENV === 'production'
    ? 'https://api.gatheros.app'
    : 'http://localhost:8787');

// Custom URL scheme registered by the desktop app — magic-link
// emails redirect into `gatheros://auth/verify?token=…` and the
// main process catches it via app.on('open-url') (macOS) or via
// the second-instance argv (Windows / Linux).
const URL_SCHEME = 'gatheros';

// Paddle integration. Sandbox values are safe to ship in a dev
// build; switch to the live values for production via env vars.
//
// Get these from your Paddle dashboard:
//   - clientToken: Developer Tools → Authentication → Client-side tokens
//   - priceIds:    Catalog → Prices → (your monthly + annual prices)
const PADDLE = {
  // 'sandbox' | 'production'
  environment: env.GATHEROS_PADDLE_ENV || 'sandbox',
  clientToken: env.GATHEROS_PADDLE_CLIENT_TOKEN || 'TODO_PADDLE_CLIENT_TOKEN',
  priceIds: {
    monthly: env.GATHEROS_PADDLE_PRICE_MONTHLY || 'TODO_PRICE_ID_MONTHLY',
    yearly: env.GATHEROS_PADDLE_PRICE_YEARLY || 'TODO_PRICE_ID_YEARLY',
  },
};

// How stale the cached /license/verify response can get before we
// stop trusting it. Within this window an offline launch is fine;
// past it we force a fresh verify and paywall on failure.
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// How often the renderer re-verifies in the background while the
// app is open. 6 hours keeps Paddle status drift small without
// hammering the API.
const REVERIFY_INTERVAL_MS = 6 * 60 * 60 * 1000;

module.exports = {
  API_BASE_URL,
  URL_SCHEME,
  PADDLE,
  OFFLINE_GRACE_MS,
  REVERIFY_INTERVAL_MS,
};
