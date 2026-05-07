// GatherOS API — Cloudflare Worker entry.
//
// Mounts three sub-routers:
//   /auth/*       magic-link request, browser bridge, token exchange, signout
//   /license/*    /verify endpoint the desktop app polls on launch
//   /webhooks/*   Lemon Squeezy subscription events
//
// Everything is local-first on the desktop side; this Worker exists
// only to gate the app via license verification and to mirror LS
// subscription state into D1.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { authRoutes } from './auth';
import { licenseRoutes } from './license';
import { webhookRoutes } from './lemonsqueezy';

const app = new Hono<{ Bindings: Env }>();

// The desktop app calls these endpoints from an Electron renderer,
// which presents a `file://` or `app://` origin. CORS is wide-open
// for now; revisit if we ever expose the API to a browser frontend.
app.use('*', cors({ origin: '*' }));

app.get('/', (c) =>
  c.json({
    ok: true,
    name: c.env.APP_NAME,
    docs: 'https://github.com/brettfromdj/gatheros (server/README.md)',
  }),
);

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));

app.route('/auth', authRoutes);
app.route('/license', licenseRoutes);
app.route('/webhooks', webhookRoutes);

// 404 fallback — keep it tight, no body leak.
app.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404));

app.onError((err, c) => {
  console.error('[unhandled]', err);
  return c.json({ ok: false, error: 'server_error' }, 500);
});

export default app;
