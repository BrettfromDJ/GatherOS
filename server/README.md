# gatheros-server

Cloudflare Workers + D1 backend that powers GatherOS sign-in,
licensing, and Lemon Squeezy webhook reconciliation. Lives in this
repo under `server/` so a solo dev can keep client + API in
lock-step.

See `../MONETIZATION.md` for the architectural decisions and rollout
plan. This README is just the operational runbook.

## What's in here

```
server/
├─ migrations/0001_initial.sql      D1 schema (users / magic_links / sessions / subscriptions)
├─ migrations/0002_lemonsqueezy.sql Provider rename: paddle_* columns → lemonsqueezy_*
├─ src/
│  ├─ index.ts                      Hono entry, mounts the three routers
│  ├─ auth.ts                       POST /auth/magic-link, /auth/exchange; GET /auth/verify
│  ├─ license.ts                    /verify, /customer-portal, /checkout
│  ├─ lemonsqueezy.ts               POST /webhooks/lemonsqueezy
│  ├─ email.ts                      Resend wrapper (stubs to console in dev)
│  └─ types.ts                      Env + row shapes
├─ wrangler.toml                    binding + non-secret vars
├─ tsconfig.json
├─ package.json
└─ .dev.vars.example                local-dev secrets template
```

## First-time setup

```bash
cd server
npm install
npx wrangler login                 # opens a browser, links to your CF account

# Create the D1 database. Wrangler prints the database_id —
# paste it into wrangler.toml under [[d1_databases]].
npm run db:create

# Apply the schema locally and remotely.
npm run db:migrate:local
npm run db:migrate:remote

# Set production secrets (one prompt each).
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET
npx wrangler secret put LEMONSQUEEZY_API_KEY

# Deploy.
npm run deploy
```

After deploy, point a custom domain at the Worker (e.g.
`api.gatheros.co`) via the Cloudflare dashboard, then update
`APP_BASE_URL` in any client code that points at the API.

## Local dev

```bash
cp .dev.vars.example .dev.vars     # leave the "stub" values to skip real email
npm run dev                         # http://localhost:8787
```

In stub mode, magic-link emails print to the wrangler console — copy
the URL out of there to test the auth flow without configuring Resend.

## Smoke-test the API

```bash
# Request a magic link.
curl -X POST http://localhost:8787/auth/magic-link \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'

# Copy the magic-link URL printed by `wrangler dev`, extract the
# `?token=…` query param, and exchange it for a session.
curl -X POST http://localhost:8787/auth/exchange \
  -H "Content-Type: application/json" \
  -d '{"token":"<paste-token-here>","deviceLabel":"laptop"}'
# → { ok: true, sessionToken: "…", user: {…} }

# Verify the license with that session.
curl http://localhost:8787/license/verify \
  -H "Authorization: Bearer <sessionToken>"
# → { ok: true, entitled: true, reason: "trial", trial_ends_at: …, subscription: null }
```

## D1 console

Quick adhoc queries:

```bash
npm run db:console:local -- "SELECT email, trial_ends_at FROM users"
npm run db:console:remote -- "SELECT id, status, plan FROM subscriptions"
```

## What's still TODO

Tracked in `../MONETIZATION.md` under the "Roadmap" section. Headline
items remaining before launch:

- Verify a real LS account (test mode wires up the integration without
  approval; live charges need verification first)
- Flip `LEMONSQUEEZY_TEST_MODE` to `"false"` in `wrangler.toml` and
  recreate the products + variants in live mode
- Package + sign + notarize the Mac app for distribution
