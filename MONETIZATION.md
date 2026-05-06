# GatherOS Monetization Plan

Living document. Captures the decisions made when we kicked off the
subscription rollout so the rationale survives the next refactor.

## Decisions

| Decision               | Choice                                          |
| ---------------------- | ----------------------------------------------- |
| Gate model             | **Whole-app paywall + trial**                   |
| Trial length           | **30 days**                                     |
| Pricing                | **$5 / month**, **$49 / year** (~18% off)       |
| Payments               | **Paddle** (merchant of record, handles tax)    |
| Backend                | **Cloudflare Workers + D1** (Hono framework)    |
| Email (transactional)  | **Resend**                                      |
| Auth                   | **Magic-link email** (no passwords)             |
| Distribution (macOS)   | Apple Dev Program + notarization (already set)  |
| Distribution (Windows) | Not yet — defer until first paying user asks    |
| Auto-update            | electron-updater (already set)                  |

## Architecture

```
┌──────────────────────┐         ┌────────────────────────┐
│  GatherOS desktop    │  HTTPS  │  api.gatheros (Workers)│
│  (Electron renderer) │ ──────► │  Hono + D1             │
└──────────────────────┘         └─────────┬──────────────┘
   ▲                                       │
   │ deep-link (gatheros://auth/verify)    │ webhooks
   │                                       ▼
   │                              ┌────────────────────┐
   │                              │       Paddle       │
   │                              │  (checkout, MoR)   │
   └──────── Resend (email) ◄─────┴────────────────────┘
```

The desktop app is local-first; the backend exists only to (a) verify
identity, (b) verify entitlement, and (c) sync subscription state from
Paddle. The user's library, boards, and saves never touch the server.

## License model

Single entitlement bit per user:

```
entitled = (now < user.trial_ends_at) OR sub.status IN ('active', 'past_due')
```

- Trial begins when the user signs up (first magic-link verify).
  `trial_ends_at = now + 30d`.
- Once trial ends, the user must subscribe to keep using the app.
- `past_due` keeps the user entitled for a grace window so a failed
  card doesn't lock them out instantly. Paddle's dunning eventually
  flips them to `canceled` if they don't update payment.
- The desktop app caches the verify response in the OS keychain
  (`electron-store`) with a **7-day offline grace window** so flaky
  wifi or laptop-on-a-plane never paywalls a paying user.
- Hard piracy protection isn't worth chasing. We accept some leakage.

## Roadmap

- [x] **Phase 1 — Backend foundation** (this commit)
  - Cloudflare Workers + D1 scaffold
  - Schema: users / magic_links / sessions / subscriptions
  - Endpoints: magic-link request + verify, license verify,
    Paddle webhook stub
- [ ] **Phase 2 — Paddle integration**
  - Create monthly + annual prices in Paddle dashboard
  - Implement webhook signature verify + status mapping
  - Wire Paddle.js checkout overlay from Electron renderer
  - Test full lifecycle in sandbox
- [ ] **Phase 3 — App-side enforcement**
  - Sign-in screen on first launch (magic-link request)
  - Deep-link handler (`gatheros://auth/verify?token=…`)
  - License client with offline grace cache
  - Paywall modal that blocks the app post-trial
  - Settings → Account pane (Paddle customer portal link)
- [ ] **Phase 4 — UX polish + ops**
  - Trial countdown banner (last 7 days)
  - Payment-failed banner + "update payment method" CTA
  - Sign out, account deletion request
  - Static pages: Terms / Privacy / Refund
  - Support email + inbox
- [ ] **Phase 5 — Pre-launch**
  - End-to-end test: signup → trial → checkout → paid → cancel
  - Offline grace test
  - Beta with 5–10 friendly users
  - Public launch

## Open questions / TODOs

- Domain name for the API (`api.gatheros.app`?)
- Sender domain for Resend (`mail.gatheros.app`?)
- Multi-machine policy: cap at 3 active machines per account, with a
  self-serve deactivation flow? Or unlimited and accept some sharing?
- AI cost recovery: $5/mo barely covers a heavy auto-tag user. Need
  per-user monthly call quotas — probably 500 auto-tag ops + 200
  semantic-search queries / month, with a "buy more" upsell later.
- Refund policy: standard 14-day no-questions-asked is the kindest
  starting point.
