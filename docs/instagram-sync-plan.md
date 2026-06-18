# Instagram saved-posts sync — build plan

Status: planning. This locks in the recommended defaults and maps the build,
file-by-file, against the existing X-bookmark architecture. Nothing here ships
until P0 (reverse-engineering Instagram's saved feed) is confirmed.

## Goal

Bring Instagram saved posts into GatherOS the same way X bookmarks already flow
in: passively, while the user browses, plus an explicit backfill for the
existing backlog. Carousels, single images, and reels all land as real saves
with full-res media and source metadata.

## Locked defaults

These are the decisions, settled. Everything downstream assumes them.

1. **One save per post.** A carousel (multi-image/video post) becomes a single
   save. The extra media live in `source_meta.imageUrls` and reuse the
   `tweetMediaItems` / inline paging we already built for multi-image tweets —
   the 3/3 count badge, arrow paging, peek-follows, higher-res panning all come
   for free. We do *not* explode a carousel into N saves.

2. **Generalize the source, don't fork it.** Add a `source` column to `saves`
   (`'x'` | `'instagram'`, `NOT NULL DEFAULT 'x'`) and rename `tweet_meta` →
   `source_meta` (same JSON blob, source-agnostic shape). `kind` stays as-is
   (`image` | `video` | `url`). A migration backfills `source = 'x'` for every
   existing tweet-meta row and copies `tweet_meta` → `source_meta`.

3. **One combined "Saved" view.** There is no separate Instagram tab. The
   existing Bookmarks chip is renamed **Saved** and filters
   `source='x' AND tag x:bookmark` **OR** `source='instagram' AND tag
   instagram:save`. A small per-card source badge (X glyph / IG glyph)
   distinguishes origin.

4. **Interceptor-only capture.** We read Instagram's own saved-feed network
   responses (the same technique as `x-graphql-interceptor.js`). We do **not**
   try to capture real-time "save" button clicks in the DOM initially — too
   brittle, and the interceptor already sees newly-saved posts when the saved
   collection refetches.

Plus three cross-cutting rules:

- **Passive + explicit, never a background poll.** We capture saved posts while
  the user is *already* on instagram.com, and we expose an explicit **"Import
  saved"** backfill button. We never poll Instagram in the background. This is
  deliberate for Meta account safety — automated/background requests to
  Instagram endpoints are exactly what trips their abuse detection.
- **Download-on-save.** Instagram CDN URLs (`*.cdninstagram.com`,
  `fbcdn.net`) are short-lived and signed. We must fetch + persist bytes at
  save time, not store the URL. Reels go through the existing
  `saveVideoFromUrl` path; images through the existing image-save path.
- **Dedup + tombstone parity.** Reuse content-hash dedup. Mirror the tweet
  tombstone system for IG (dismiss/undismiss keyed by IG post id) so
  "Import saved" can override a tombstone the same way `forceImport` does for X.

## Architecture mapping (X → Instagram)

| Concern | X today | Instagram (new) |
| --- | --- | --- |
| Network read | `extension/content/x-graphql-interceptor.js` (MAIN world) | `extension/content/ig-interceptor.js` (MAIN world) |
| DOM watcher | `extension/content/x-bookmark-watcher.js` | not needed for P0 (interceptor-only) |
| Relay + batching | `extension/background.js` | add `handleSavedBatch` / `handleImportSaved` |
| Backfill UI | panel "Import bookmarks" in `extension/panel.js` | panel "Import saved" action |
| Native bridge | `src/main/native-host.js` (forwards `forceImport`) | extend whitelist for IG fields |
| Local HTTP sink | `src/main/extension-server.js` `/save` | accept IG payload + carousel |
| Persistence | `src/main/db.js` `saves.tweet_meta`, `kind` | `source` column + `tweet_meta`→`source_meta` migration |
| Tombstones | `dismissed_tweets` table | `dismissed_posts` (or generalize to `dismissed_sources`) |
| Render | `tweetMediaItems`, `ImageCard`, `FocusedView`, `DetailPanel` | unchanged — already source-agnostic once `source_meta` lands |

## `source_meta` shape (Instagram)

```json
{
  "source": "instagram",
  "postId": "<ig media id>",
  "shortcode": "<shortcode>",
  "permalink": "https://www.instagram.com/p/<shortcode>/",
  "author": "<display name>",
  "handle": "<username>",
  "avatarUrl": "<persisted-or-cdn>",
  "text": "<caption>",
  "imageUrls": ["<full-res 1>", "<full-res 2>", "..."],
  "isCarousel": true,
  "isReel": false,
  "savedAt": 0
}
```

This is intentionally the same skeleton as the X `tweet_meta` (author/handle/
text/imageUrls), so `tweetMediaItems(record, meta)` works without branching on
source — `kind === 'video'` still puts the video at index 0 for reels.

## Phases

### P0 — Reverse-engineer the saved feed (the linchpin)

Before any code: confirm the network request Instagram fires when you open
**Saved → All posts** and scroll. Capture:

- the endpoint (likely a `graphql/query` or an `api/v1/feed/saved/` style call),
- the cursor / pagination param and where the next-cursor comes back in the
  response,
- the response JSON path to each post's `id`, `shortcode`, caption, and the
  full-res `image_versions2` / `carousel_media` / `video_versions` arrays.

Deliverable: a short captured-request spec. If this isn't cleanly
interceptable, the whole approach changes — so it gates everything.

### P1 — Interceptor + relay (log only)

- `extension/content/ig-interceptor.js`: patch `fetch`/XHR in the MAIN world,
  match the saved-feed endpoint, parse posts, `postMessage` to the isolated
  relay (mirror the X interceptor exactly).
- `manifest.json`: add `*://*.instagram.com/*` matches for the new content
  scripts; bump version.
- `background.js`: receive batches, normalize to the `source_meta` shape, log
  only (no save yet). Validates parsing against real data before we touch disk.

### P2 — Desktop accepts Instagram saves

- `db.js`: migration — add `source` column (`DEFAULT 'x'`), add `source_meta`,
  backfill `source='x'` + copy `tweet_meta`→`source_meta` for existing rows.
  Keep `tweet_meta` readable during transition.
- `extension-server.js` `/save`: accept `source='instagram'` payloads; for
  carousels persist every `imageUrls` entry's bytes (download-on-save), reels
  via `saveVideoFromUrl`; tag `instagram:save`; content-hash dedup; IG
  tombstone check with `forceImport` override.
- `native-host.js`: extend the forwarded-field whitelist for IG payload +
  `forceImport`.

### P3 — Backfill, passive capture, UI

- panel `panel.js`: **"Import saved"** action mirroring "Import bookmarks" —
  scoped counts (reuse 25/50/100/200/500), auto-scroll the saved page to drive
  the interceptor, `forceImport` to override tombstones.
- Passive capture: when the interceptor sees saved posts during normal
  browsing, relay → save (respecting tombstones, no force).
- Rename Bookmarks chip → **Saved**; combined filter; per-card source badge.

### P4 — Polish

- Tombstone dismiss/undismiss parity for IG posts.
- Empty-state copy mentions both X and Instagram.
- Source badge styling pass; Saved-view filter edge cases.

## Open risks

- **P0 is make-or-break.** If the saved feed isn't a clean interceptable JSON
  request (e.g. heavily obfuscated or server-rendered), reassess before P1.
- **CDN expiry.** Confirmed handled by download-on-save, but worth verifying
  signed-URL lifetime is long enough to fetch within the save window.
- **Account safety.** Auto-scroll during "Import saved" must look human-paced;
  never background, never headless. Keep it conservative.
