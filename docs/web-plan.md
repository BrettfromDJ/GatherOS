# GatherOS on the web — plan

## The decision

GatherOS is going cloud. We're dropping local-first as the organizing
principle. The reasons are concrete and came straight from using it:

1. **Other people can't see my saves.** There's no link to send.
2. **I can't share a collection.** A board lives on one machine.
3. **I can't get to my library from another device.** No phone, no
   second laptop, no browser.

So the new north star for this work: **your library lives in the cloud,
reachable from any device and shareable by link.** The desktop app and
the extension become *clients* of that library, not the library itself.

This supersedes the "Local-first and private — your collection is yours,
on your machine" line in `vision.md`. We keep *private by default* (a
save is yours until you choose to share it), but the bytes live on our
infrastructure, not only on the user's disk.

## What we already have

The backend is further along than it looks. `server/` is a Cloudflare
Worker (Hono + D1) already deployed at `api.gatheros.co` doing:

- **Magic-link auth** with opaque per-device session tokens
  (`sessions` table) — exactly the primitive multi-device needs.
- **Users + billing** (`users`, `subscriptions`, LemonSqueezy webhooks).
- **An OpenAI proxy** (`/ai/*`) the desktop app already calls with its
  session token.

What's missing is the part that matters: **the library itself never
leaves the device.** Saves are rows in a local SQLite file
(`src/main/db.js`) and bytes in a local images dir, served to the
renderer over the `moodmark-file://` protocol. The Worker has never seen
a single save.

So this isn't a rewrite. It's: **mirror the local data model into the
cloud, put the media in object storage, and teach the existing clients
to talk to it.**

## The shape of the work

### 1. Cloud data model (D1)

Port the local schema (`saves`, `collections`, `collection_items`,
`tags`, `save_tags`, `boards`, `board_items`, `dismissed_tweets`) into
D1 migrations under `server/migrations/`, with one change running
through every table: **a `user_id` column** (FK → `users.id`) so the
store is multi-tenant. Everything the desktop already writes —
`kind`, `source`, `tweet_meta` (JSON), `content_hash`, `palette` /
`palette_lab`, `ai_description`, `embedding`, `ocr_text`, `meta`,
`notes`, `deleted_at` — comes along unchanged. The JSON/text columns
port verbatim; `embedding` (BLOB) can live in D1 for now or move to a
vector store later.

Dedup (`content_hash`) and tombstones (`dismissed_tweets`) become
*per-user* — they already behave that way, they just gain a tenant key.

### 2. Object storage (R2) + media serving

Local files and `moodmark-file://` get replaced by **Cloudflare R2**:

- On save, the client (extension or desktop) uploads the original +
  thumbnail to R2 under a per-user key (`u/{userId}/{saveId}/orig`,
  `…/thumb`).
- The Worker serves them back through a `/media/*` route (or signed R2
  URLs), so the same `tweetMedia` / `ImageCard` code just points at
  `https://api.gatheros.co/media/…` instead of `moodmark-file://`.
- **This kills the expired-CDN-link problem the right way:** instead of
  every client re-downloading IG/X media to its own disk
  (`localizeInstagramMedia`, `saveAuxMedia`), the *server* fetches once
  into R2 and everyone reads from there.

Thumbnail/palette generation (today `sharp` in the main process) stays
**client-side** (Brett's call): whoever saves — desktop or extension —
generates the thumbnail + reads the palette at capture time and uploads
both alongside the original, and the Worker just stores what it's
handed. No image-processing dependency in the Worker. (A server-side
image service stays a future option if keeping every client in sync
gets annoying.)

### 3. Saves API

New Hono sub-router (`server/src/saves.ts`), all gated by the existing
session token:

```
GET    /saves?source=&cursor=        list (paginated, the grid feed)
POST   /saves                        create (extension + desktop write here)
PATCH  /saves/:id                    edit (tags, notes, collections, soft-delete)
DELETE /saves/:id                    delete + R2 cleanup
GET    /collections                  list
POST   /collections                  create
…boards, tags likewise
POST   /upload                       presign / accept R2 upload
```

This is the single endpoint the extension and both app clients converge
on. It mirrors the read/write surface in `src/main/ipc.js` one-for-one,
so the renderer's call sites barely change.

### 4. The platform adapter (the key abstraction)

The renderer talks to storage through `window.moodmark.*` IPC today.
Introduce a thin **data client** the React app imports instead:

- **Desktop build** → adapter backed by IPC (current behavior, no
  regression).
- **Web build** → adapter backed by `fetch` against the Saves API.

Same React components, two transports. This is what lets the *existing
renderer* become the web app instead of rebuilding the UI. First pass
can be read-mostly on web (list/view/share) with writes still flowing
from desktop + extension; writes-from-web come once the adapter's
mutation methods are wired.

The adapter is **permanent, not transitional** — the web platform and
the Mac app coexist long term (Brett's call). The desktop stays a
first-class client for offline use, speed, and native capture; both
clients sync against the cloud as the shared source of truth.

### 5. Repoint the extension

Today the extension posts captures to a localhost native-messaging
bridge (`extension-server.js`, port 53247) that only exists while the
desktop app runs — which is exactly why mobile/desktop-absent capture
has been a fight. New path: **the extension POSTs captures straight to
`api.gatheros.co/saves`** with the user's session token (obtained via
the same magic-link flow, stored in extension storage). The native
bridge stays as an optional fast-path / offline buffer, but the cloud
becomes the source of truth. This also makes the X/IG background polls
write to the cloud directly — no running app required.

### 6. Web frontend hosting

Build the renderer as a static SPA (it's already Vite + React) and host
on **Cloudflare Pages** at `app.gatheros.co`, same-origin-ish with the
Worker. Magic-link auth already supports the browser leg (`/auth/verify`
has a browser bridge today for the desktop deep-link — extend it to set
a web session cookie/token).

### 7. Sharing — the actual ask

The payoff feature. Two pieces:

- **Public collection / board links.** A `share` flag (+ random slug)
  on `collections` / `boards`. An *unauthenticated* Worker route
  `GET /s/:slug` returns the collection's saves (read-only, no tenant
  token), rendered by a lightweight public page (or the SPA in a
  read-only mode). Media already served from R2, so a shared link Just
  Works for anyone.
- **Per-save share** later — same mechanism, single item.

This is the milestone that directly answers "I want people to see and
share my saves," and it's buildable the moment saves + R2 + a public
route exist — it does *not* require the full web app first.

## Phasing

Ordered so each phase ships something usable and de-risks the next.
**Brett's call (locked):** the first visible milestone is the
**read-only web app** — get the library reachable from any device/
browser before adding sharing.

- **Phase 0 — Cloud store stands up.** D1 saves/collections/etc.
  migrations + R2 bucket + Saves API + upload path. No UI yet; verify
  with curl. *Outcome: the cloud can hold a library.*

- **Phase 1 — Desktop syncs up.** Desktop writes go to the cloud (via
  the adapter) in addition to / instead of local SQLite; backfill the
  existing local library into the cloud once. *Outcome: your real
  library is in the cloud, multi-device-ready.*

- **Phase 2 — Read-only web app.** Host the SPA on Cloudflare Pages with
  the web adapter; sign in, browse, view your full library from any
  device. Writes still come from desktop + extension. *Outcome: the
  headline — your library on your phone / any browser.*

- **Phase 3 — Share a collection by link.** `share` flag + `/s/:slug`
  public page (reuses the web app in a read-only public mode). *Outcome:
  send someone a link to your saves.*

- **Phase 4 — Extension writes to cloud directly.** Repoint capture +
  background polls at the Saves API; native bridge becomes optional.
  *Outcome: capture works with no desktop app running, anywhere.*

- **Phase 5 — Full web parity.** Wire the adapter's mutations so the web
  app can tag, collect, board, and delete — true multi-device editing.

## What gets harder on the web

- **URL screenshotting** (`urlCapture.js`, hidden BrowserWindow) has no
  browser equivalent — needs a server-side headless browser (Browser
  Rendering / a screenshot service). Web "save a URL" falls back to the
  OG-tag preview (`urlPreview.js`, already portable) until that exists.
- **`sharp`** image processing doesn't run in a Worker — thumbnails/
  palette move client-side or to a dedicated service (see §2).
- **`better-sqlite3`** is desktop-only; the cloud store is D1, the
  adapter hides the difference.
- **Embeddings / "find similar"** at scale wants a real vector index
  (Vectorize) rather than scanning BLOBs in D1 — fine to defer.
- **Offline.** Local-first gave offline for free; the web app won't have
  it initially. The desktop app can keep a local cache for offline +
  speed, syncing to the cloud — but that's a later nicety, not Phase 0.

## Economics & risks

### Does this double the dev work? No.

The platform adapter (§4) is exactly what prevents building the app
twice. The React renderer is **one codebase** running on both desktop
(IPC) and web (HTTP); a new card, filter, or view is written **once**
and both platforms get it. The only genuinely platform-specific code is
thin: the two transport adapters (a one-time build) and native-only
capabilities (URL-screenshotting, local file access) that simply don't
exist on web. Marginal feature work is ~1.2–1.3×, not 2×. The real cost
is the **one-time** backend + adapter build in Phase 0, plus an ongoing
"more moving parts to keep in sync" tax: a cloud backend that didn't
exist before, two DB schemas (local SQLite + D1) that must not drift,
and a second auth surface.

### Hosting hi-res images + video: cheaper than it sounds

The decisive fact is **R2 has zero egress fees** — serving media to
viewers, including every public share page, costs nothing in bandwidth.
Egress is what makes media hosting expensive on S3; R2 removes it.

- **Storage** ≈ $0.015/GB/month. **Ops** are pennies per million; with
  Cloudflare's CDN in front, most thumbnail loads are cache hits (free).
- A heavy power user — ~50k saves at ~3 MB ≈ 150 GB — is **~$2–5/month**
  of storage, served for free.
- **The one thing to watch is video**, because storage is *cumulative*
  (only shrinks on delete) and X/IG videos are large and compound over
  years. Mitigation when it matters: store a compressed playback version
  rather than full-res originals, or a fair-use ceiling for the top tier.
  Not a Phase-0 problem.

### Is $4.99/mo viable for power users? For the core, yes.

After payment/LemonSqueezy fees (~$4.40 net), a power user's infra
(storage + Workers + D1 + R2 ops) lands around **$3–5/month even at the
heavy end** — thin but positive. **The thing that breaks $4.99 is AI,
not storage.** Embeddings and vision descriptions are cheap; **image
*generation* is real money per call** and scales with usage, so a power
user generating all day can exceed $4.99 alone.

> **Pricing call:** keep the flat $4.99 for the library / sync / share
> **core** (infra fits comfortably), but **meter or cap AI generation**
> — credits, a fair-use limit, or a higher AI tier — rather than
> promising unlimited generation at the flat price. That single decision
> is what keeps the pricing safe against power users.

### New risk classes (private local app → multi-tenant public web)

Roughly in priority. **(1) must be designed into the first Saves API
query; (2)–(4) need a plan before Phase 3 (public sharing) ships.**

1. **Multi-tenant security.** Every query scoped by `user_id`; one
   missed filter leaks one user's library into another's. Public share
   routes must **never** accept a logged-in token — they read only rows
   explicitly marked shared.
2. **Copyright / content liability.** We'll be hosting and re-publishing
   others' images (X, IG, the open web) on public pages — a different
   legal posture than a private cache. Need a DMCA/takedown process and
   terms that put responsibility on the sharer.
3. **Abuse / moderation.** Public pages can host anything (NSFW,
   illegal, spam). Need a report/takedown path and to meet
   content-scanning obligations (e.g. CSAM) that come with public media.
4. **Privacy-promise change.** We told users local-first + private;
   moving their bytes to our servers is material. Needs a clear heads-up,
   an updated privacy policy, and ideally consent on migration.
5. **We now own durability.** A bug that deletes saves affects everyone;
   R2 + D1 backups and disaster recovery are on us.
6. **Sync conflicts.** Same library edited on desktop + web + extension
   needs a conflict story (last-write-wins to start; tombstones help).
7. **Web auth surface.** Tokens in a browser bring XSS/CSRF/cookie
   concerns; the extension's session token is a credential to protect.
8. **Account deletion / data export** (GDPR-style) becomes an obligation
   once we hold people's data.

## Open questions (for Brett)

1. ~~**Headline first?**~~ *Resolved: read-only web app first (Phase 2),
   then share-by-link (Phase 3). Multi-device browsing before
   shareability.*
2. ~~**Thumbnails/palette:**~~ *Resolved: generate client-side and
   upload alongside the original — no Worker image dependency. A
   server-side image service stays a future option.*
3. ~~**Desktop after cloud:**~~ *Resolved: the web platform and the Mac
   app coexist long term. The desktop app is a permanent first-class
   client (offline + speed + native capture), not a transitional shim —
   so the platform adapter (§4) is a permanent abstraction, and the
   cloud is the shared source of truth both clients sync against.*
