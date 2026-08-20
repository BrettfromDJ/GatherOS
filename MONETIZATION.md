# GatherOS Monetization Plan

Living document. Captures the decisions made when we kicked off the
subscription rollout so the rationale survives the next refactor.

## Decisions

| Decision               | Choice                                          |
| ---------------------- | ----------------------------------------------- |
| Gate model             | **Whole-app paywall + trial**                   |
| Trial length           | **30 days**                                     |
| Pricing                | **$5 / month**, **$49 / year** (~18% off)       |
| Payments               | **Lemon Squeezy** (merchant of record — handles tax/VAT) |
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
   │                                       ▼  (/webhooks/lemonsqueezy,
   │                              ┌────────────────────┐   HMAC-SHA256 verified)
   │                              │   Lemon Squeezy    │
   │                              │  (checkout, MoR)   │
   └──────── Resend (email) ◄─────┴────────────────────┘
```

The desktop app is local-first; the backend exists only to (a) verify
identity, (b) verify entitlement, (c) sync subscription state from Lemon
Squeezy, and (d) meter AI usage. The user's library, boards, and saves
never touch the server (until the optional cloud add-on below).

## License model

Today, a single entitlement bit per user:

```
entitled = (now < user.trial_ends_at)
        OR ANY sub WHERE sub.status IN ('active', 'past_due', 'trialing')
        OR ANY sub WHERE sub.current_period_end > now
```

- Trial begins when the user signs up (first magic-link verify).
  `trial_ends_at = now + 30d`.
- Once trial ends, the user must subscribe to keep using the app.
- `past_due` keeps the user entitled for a grace window so a failed
  card doesn't lock them out instantly. LS dunning eventually flips
  them to `cancelled` if they don't update payment.
- **Cancelling never revokes time already paid for.** That second
  clause is load-bearing, not a nicety. Lemon Squeezy sets a
  subscription's status to `cancelled` the moment the customer clicks
  cancel, and puts the end of the period they paid for in `ends_at`. A
  yearly subscriber who cancels in week one is `cancelled` with ~51
  weeks left. Deciding entitlement on status alone downgraded them on
  the spot, which is why entitlement is a function of
  `current_period_end`, not of the status string. See `rowEntitles` in
  `server/src/rules.ts` and its truth table in `license.test.ts`.
- Entitlement is `ANY subscription row entitles`, never "the newest
  row". A user can accumulate rows (re-subscribe, plan switch, a
  trailing webhook on a dead subscription), and trusting only the
  most-recently-updated one has dropped a paying user to free before.
- The desktop app caches the verify response in the OS keychain
  (`electron-store`) with a **7-day offline grace window** so flaky
  wifi or laptop-on-a-plane never paywalls a paying user.
- Hard piracy protection isn't worth chasing. We accept some leakage.

### Evolving to entitlement + limits

The single bit is growing into a small **plan + limits object**, carried
in the *same* license-verify response the desktop already fetches and
caches. This is what lets metered, variable-COGS features (AI, cloud)
layer onto the flat base sub:

```jsonc
{
  "entitled": true,
  "plan": "monthly",                 // from the active LS variant
  "cloud": { "enabled": true, "quotaGb": 50, "usedGb": 8.2, "status": "active" },
  "ai":    { "autoTagQuota": 500, "searchQuota": 200 }   // metered in ai_usage_monthly
}
```

AI usage is **already** metered server-side (`ai_usage_monthly`,
`0003_ai_usage.sql` / `0004_ai_image_usage.sql`); the cloud add-on slots
into the same response and the same webhook→D1 plumbing.

## Cloud storage add-on (planned)

Optional cloud library / "optimize Mac storage": originals live in object
storage, the Mac keeps thumbnails + previews, originals fetch on demand.
See `ARCHITECTURE.md` for the web-forward seams this rides on.

**Not a separate product or checkout.** Cloud is an add-on on the user's
existing subscription, enabled in-app without re-collecting payment.

**LS billing primitive — variant swap, not line items.** Unlike Paddle/
Stripe, a Lemon Squeezy subscription is **one variant** — you can't stack
add-on line items. So cloud is baked into the plan variants and enabled
via a subscription **variant change** (LS "Update Subscription", with
proration):

- `GatherOS` — **$5/mo · $49/yr** (base, no cloud)
- `GatherOS + 50 GB` — **$9/mo · $89/yr**
- `GatherOS + 200 GB` — **$13/mo · $129/yr**
- `GatherOS + 1 TB` — on request (thin margin on R2 at full fill; defer)

Each variant is the **all-in price with the $5 base baked in** — one
charge, one LS fee, not a base charge plus a cloud charge. Launch with
50 GB and 200 GB; 1 TB stays on request until usage justifies it. Since
the base is a single plan, that's a handful of variants — manageable.

**Margins** (cloud storage COGS at R2 $0.018/GB effective incl. ~20%
ops/CDN buffer; LS fee = 5% + $0.50 on the single combined charge; AI is
billed separately and excluded here):

| Variant   | Total $/mo | Cloud COGS @ full fill | LS fee | Net @ full fill | Net @ ~30% used |
| --------- | ---------- | ---------------------- | ------ | --------------- | --------------- |
| + 50 GB   | $9         | $0.90                  | $0.95  | **~$7.15**      | ~$7.80          |
| + 200 GB  | $13        | $3.60                  | $1.15  | **~$8.25**      | ~$10.80         |

Profitable on **every** user even at full fill — the tier caps storage,
so it caps your liability. Annual is the same math with the flat $0.50
amortized across the year, so **push annual**.

**In-app upgrade UX:**

> Settings → Storage → toggle "Cloud library" → confirm modal
> ("Add 50 GB — your plan becomes $9/mo, prorated today") → backend swaps
> the LS variant → entitlement refreshes → background upload begins.

One subscription, one invoice, card already on file, no checkout overlay.
The webhook reads the **active variant** to populate `cloud.enabled` +
`quotaGb`. Storage-tier up/downgrades reuse the same variant-swap call.

**Pricing shape:** fixed storage tiers (buckets), not per-GB metering —
predictable for the user, and it dodges overage-bill surprises. LS
usage-based billing stays in reserve only for "overage beyond top tier."

**Infra / COGS:** serve from a **zero-egress** provider (Cloudflare R2)
behind a CDN; browse from thumbs/previews, originals on demand + cached.
At 10 GB/user that's ~$0.15/user/mo of storage — fat margin on any paid
tier. Never offer unlimited cloud free; gate behind the add-on (or a
storage cap on the base plan).

**Billing lifecycle edges:**
- **Over quota** → block new uploads, upsell next tier (same swap flow).
- **Disable cloud / downgrade** → variant swaps back, then a data-eviction
  grace window ("You have 8 GB in the cloud — download it back to this
  Mac, or it's removed in 30 days").
- **Base subscription cancels while cloud is on** → cloud cascades via the
  existing `past_due`/grace logic, then download-or-delete.
- **Never evict a local original until its cloud copy is confirmed.**

New pieces to build: LS cloud variant IDs, the `cloud` fields in the
verify response, and the data-eviction-on-downgrade flow. Everything else
(auth, webhook→D1 sync, offline grace) is reused.

## Roadmap

- [x] **Phase 1 — Backend foundation**
  - Cloudflare Workers + D1 scaffold
  - Schema: users / magic_links / sessions / subscriptions
  - Endpoints: magic-link request + verify, license verify,
    Lemon Squeezy webhook handler
- [x] **Phase 2 — Lemon Squeezy integration**
  - Monthly + annual variants
  - Webhook signature verify (HMAC-SHA256) + status mapping
  - Hosted checkout via `/v1/checkouts`
  - Customer portal link for billing/payment management
- [ ] **Phase 3 — App-side enforcement**
  - Sign-in screen on first launch (magic-link request)
  - Deep-link handler (`gatheros://auth/verify?token=…`)
  - License client with offline grace cache
  - Paywall modal that blocks the app post-trial
  - Settings → Account pane (LS customer portal link)
- [ ] **Phase 4 — UX polish + ops**
  - Trial countdown banner (last 7 days)
  - Payment-failed banner + "update payment method" CTA
  - Sign out, account deletion request
  - Static pages: Terms / Privacy / Refund
  - Support email + inbox
- [ ] **Phase 5 — Cloud add-on** (after optimized-import lands)
  - R2 bucket + signed-URL serving behind CDN
  - Cloud plan variants in LS + variant-swap upgrade endpoint
  - `cloud` block in the verify response + quota enforcement
  - Background upload + on-demand fetch + local eviction
  - Data-eviction grace flow on downgrade / cancel

## Open questions / TODOs

- Domain name for the API (`api.gatheros.co`?)
- Sender domain for Resend (`mail.gatheros.co`?)
- Multi-machine policy: cap at 3 active machines per account, with a
  self-serve deactivation flow? Or unlimited and accept some sharing?
- AI cost recovery: $5/mo barely covers a heavy auto-tag user. Usage is
  metered in `ai_usage_monthly`; still need to set + enforce the monthly
  quotas (e.g. 500 auto-tag ops + 200 semantic-search queries) and a
  "buy more" upsell.
- Cloud tiers set: **+50 GB → $9/mo all-in**, **+200 GB → $13/mo all-in**
  (annual $89 / $129); 1 TB deferred to on-request. Revisit if we ever
  leave R2 — the margins assume zero egress.
- Cloud data retention on cancel: grace length before eviction.
- Refund policy: standard 14-day no-questions-asked is the kindest
  starting point.
- Code cleanup: a couple of stale "Paddle" comments linger (e.g.
  `server/migrations/0001_initial.sql` "Status values mirror what Paddle
  Billing emits") — reword to Lemon Squeezy.
