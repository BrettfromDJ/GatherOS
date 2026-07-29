// Isolated-world content script for cosmos.so.
//
// Cosmos serves its element data through Apollo GraphQL + Next.js server
// components — no clean REST API — so instead of decoding that, we read the
// saved elements straight off the rendered grid. Every saved element shows
// as an <img src="https://cdn.cosmos.so/<id>?format=webp&w=…">. We watch the
// page for those, dedupe by the CDN id, and relay batches to the background
// worker, which routes them through the desktop /save pipeline.
//
// Scope: only the user's OWN pages — their profile grid and their own
// collections — and, within a collection, only the actual saves (not the
// "Similar" recommendations shown below them).

const CDN_HOST = 'cdn.cosmos.so';
const COSMOS_USERNAME_KEY = 'gatherosCosmosUsername';
const seen = new Set();
// Element ids already saved live this page-load. A video element carries two
// cdn assets (its poster still and the video itself) and can re-fire the save
// mutation, so the same element could otherwise be sent twice under two
// different image ids — landing a real save plus a dead blank tile. Dedupe by
// element id so one element saves exactly once per session.
const savedElementIds = new Set();

// The tile the user last interacted with, captured on pointer-down. Most
// saves are grid/feed saves with no viewer open, so the interceptor's
// element→image guess (and a whole-page image scan) can't tell which tile was
// clicked. The save button lives inside — or beside — the tile's /e/<id>
// link, so from the pointer target we can read the exact element id AND its
// image, then match them to the save mutation that fires a moment later.
let lastCosmosClick = null; // { elementId, imageId, at }

// Capture the tile under the pointer, by geometry. Feed tiles have no
// /e/<id> link and the save button is an overlay, so DOM-ancestor walking is
// unreliable — but the save button sits ON TOP of the tile art, so the
// pointer coordinates fall inside the tile image's box. Find the smallest
// cosmos image whose box contains the point: that's the tile being saved.
function captureCosmosClick(x, y) {
  let best = null;
  let bestArea = Infinity;
  for (const img of document.querySelectorAll('img')) {
    const id = cosmosImageId(img.currentSrc || img.src);
    if (!id) continue;
    if (img.getClientRects().length === 0) continue;
    const r = img.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const area = r.width * r.height;
    if (area < bestArea) { bestArea = area; best = { id, el: img }; }
  }
  if (!best) {
    // Pointer landed on chrome, not a picture — the Save button in the
    // detail view's sidebar, a menu, the page background. Forget the last
    // tile rather than keeping it: a stale grid tile that outlives the
    // click that made it is exactly what got saved in place of the image
    // the user was actually looking at.
    lastCosmosClick = null;
    return;
  }
  // Element id too, when the tile happens to expose an /e/<id> link — lets the
  // save handler confirm the match. Feed tiles often don't, so it may be null
  // and the handler matches on recency instead.
  let elementId = null;
  const a = best.el.closest('a[href*="/e/"]');
  if (a) { const m = /\/e\/(\d+)/.exec(a.getAttribute('href') || ''); if (m) elementId = m[1]; }
  lastCosmosClick = { elementId, imageId: best.id, at: Date.now() };
}
document.addEventListener('pointerdown', (e) => {
  try { captureCosmosClick(e.clientX, e.clientY); } catch { /* never break the page */ }
}, true);
// Image ids the interceptor flagged as "Similar" recommendations (from the
// GetClusterRecommendations query) — never import these. Scoped per page load,
// which resets naturally as the crawl navigates from collection to collection.
const excludedUuids = new Set();

// Remember the owner's username the first time we're on their own profile,
// so the panel's "Import saves" backfill knows which profile URL to open.
// (Cosmos saves live at cosmos.so/<username>; there's no generic entry point.)
let rememberedUsername = null;
function rememberUsername() {
  const parts = profilePathParts();
  if (!parts || !isOwnPage()) return; // only trust our own, visible profile
  const username = parts[0];
  if (!username || username === rememberedUsername) return;
  rememberedUsername = username;
  try { chrome.storage.local.set({ [COSMOS_USERNAME_KEY]: username }); }
  catch { /* extension reloaded / no storage */ }
}

// Real-time saves: the MAIN-world interceptor (cosmos-interceptor.js) detects
// the save mutation and posts the saved element here. Relay it straight to the
// background as a one-item batch so it lands in GatherOS immediately.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const d = event.data;
  if (!d || d.source !== 'gatheros-cosmos-interceptor') return;
  // "Similar" recommendation ids to keep out of the grid scrape (collection
  // pages). Handle before the save-only guard below.
  if (d.type === 'exclude' && Array.isArray(d.uuids)) {
    for (const u of d.uuids) excludedUuids.add(String(u).toLowerCase());
    return;
  }
  if (d.type !== 'save') return;
  // One element saves once per page-load, no matter how many cdn assets it
  // has (poster + video) or how often its save mutation re-fires. Without
  // this, a video landed a real save plus a dead blank tile.
  const elKey = d.elementId != null ? String(d.elementId) : null;
  if (elKey && savedElementIds.has(elKey)) return;
  // Resolution order, most reliable first:
  //  1. The tile the user just clicked (matched by element id) — the only
  //     signal that survives a grid/feed save with no viewer open.
  //  2. The image on screen (lightbox/detail viewer).
  //  3. The interceptor's element→image guess (walks Cosmos's GraphQL; can
  //     mis-key multi-image/video elements — a "random image" that isn't
  //     even the saved tile).
  const cdn = (id) => `https://${CDN_HOST}/${id}?format=webp`;
  const clickRecent = !!lastCosmosClick && !!lastCosmosClick.imageId
    && (Date.now() - lastCosmosClick.at) < 5000;
  // A click whose tile named THIS element is unambiguous — nothing beats it.
  const fromClickExact = clickRecent && lastCosmosClick.elementId === elKey
    ? cdn(lastCosmosClick.imageId) : '';
  // Then the picture actually on screen. This has to outrank an un-named
  // click: in the detail view the last thing clicked is usually chrome, and
  // letting a leftover grid tile win there is what saved the wrong image.
  const fromView = fromClickExact ? '' : resolveCosmosImageFromDom(d.elementId);
  // Finally an un-named click — feed tiles expose no element id, so in the
  // grid (where no single image dominates) this is the one that identifies
  // the tile, and by now the viewer has had its say.
  const fromClickLoose = (!fromClickExact && !fromView && clickRecent && !lastCosmosClick.elementId)
    ? cdn(lastCosmosClick.imageId) : '';
  const mediaUrl = fromClickExact || fromView || fromClickLoose || d.mediaUrl;
  const pickedBy = fromClickExact ? 'clicked tile'
    : fromView ? 'on screen'
      : fromClickLoose ? 'clicked tile (unnamed)'
        : 'interceptor';
  if (!mediaUrl) return; // image not seen yet — the profile/grid reader backfills it later
  const m = /cdn\.cosmos\.so\/([^/?#]+)/i.exec(mediaUrl);
  const id = m ? m[1] : String(d.elementId);
  if (seen.has(id)) return;
  seen.add(id);
  if (elKey) savedElementIds.add(elKey);
  if (!chrome.runtime || !chrome.runtime.id) return;
  try {
    chrome.runtime.sendMessage({
      type: 'gatheros:cosmos-saved-batch',
      elements: [{ id, mediaUrl, pageUrl: d.pageUrl || mediaUrl, type: 'image', caption: '', collection: null, realtime: true }],
    });
    console.log('[gatheros] cosmos: real-time save →', mediaUrl, `(${pickedBy})`);
  } catch { /* extension reloaded */ }
});

// Extract a cosmos image id from ANY image url the page might use, not just
// a bare cdn url. The lightbox viewer runs its image through Next.js's
// optimizer — src="/_next/image?url=<percent-encoded cdn url>&w=…" — so the
// cdn id hides inside an encoded query param. Direct cdn urls and
// percent-encoded slashes are handled too. Returns the id or null.
function cosmosImageId(rawUrl) {
  if (!rawUrl) return null;
  let url = String(rawUrl);
  if (/\/_next\/image/i.test(url)) {
    const q = /[?&]url=([^&]+)/.exec(url);
    if (q) { try { url = decodeURIComponent(q[1]); } catch { /* keep raw */ } }
  }
  // Decode once more in case the whole src arrived encoded.
  if (!/cdn\.cosmos\.so\//i.test(url) && /cdn\.cosmos\.so%2F/i.test(url)) {
    try { url = decodeURIComponent(url); } catch { /* keep */ }
  }
  const m = /cdn\.cosmos\.so(?:\/|%2F)([A-Za-z0-9-]+)/i.exec(url);
  return m ? m[1] : null;
}

// The big image the user is looking at when they save — the lightbox/detail
// viewer. Scan EVERY <img> (the viewer's src is a _next/image proxy url, not
// a bare cdn url, so a cdn-only selector misses it), keyed through
// cosmosImageId. Scope to an open dialog when present so the feed behind
// can't interfere. Returns the viewer's cosmos image id, or ''.
function dominantViewerImageId() {
  let root = null;
  for (const dlg of document.querySelectorAll('[role="dialog"], [aria-modal="true"]')) {
    if (dlg.getClientRects().length) { root = dlg; break; }
  }
  const collect = (scope) => {
    const out = [];
    for (const img of scope.querySelectorAll('img')) {
      const id = cosmosImageId(img.currentSrc || img.src);
      if (!id) continue;
      if (img.getClientRects().length === 0) continue;
      const r = img.getBoundingClientRect();
      if (Math.min(r.width, r.height) < 240) continue; // thumbnails/covers/tiles
      out.push({ id, area: r.width * r.height });
    }
    return out;
  };

  let boxes = root ? collect(root) : [];
  // A visible [role=dialog] isn't proof the viewer lives inside it — Cosmos
  // keeps an empty dialog container mounted, and scoping to it found nothing
  // and gave up, handing the save back to the interceptor's guess. If the
  // dialog holds no picture, scan the page instead of surrendering.
  const scopedToDialog = boxes.length > 0;
  if (!scopedToDialog) boxes = collect(document);
  if (!boxes.length) return '';
  boxes.sort((a, b) => b.area - a.area);
  // Inside a dialog that really holds the viewer, trust the largest. Scanning
  // the whole page, require clear dominance so a grid of similarly sized tiles
  // is never mistaken for a viewer — that's what keeps grid saves on the
  // clicked-tile path rather than grabbing whichever tile is biggest.
  if (!scopedToDialog && boxes.length > 1 && boxes[1].area > boxes[0].area * 0.62) return '';
  return boxes[0].id;
}

// Resolve the image the user is actually saving, straight from the page, so
// a save records the frame on screen rather than the interceptor's guess
// (which mis-keys multi-image elements). Returns a normalized full-res cdn
// url, or '' if the DOM can't answer.
function resolveCosmosImageFromDom(elementId) {
  // Preferred: the dominant viewer image (detail page or lightbox modal).
  let id = dominantViewerImageId();
  // Fallback: saved off a grid tile with no open viewer — find the tile
  // that links to this specific element and take its own image.
  if (!id && elementId != null) {
    const a = document.querySelector(`a[href*="/e/${elementId}"]`);
    if (a) {
      const img = a.querySelector('img');
      if (img) id = cosmosImageId(img.currentSrc || img.src);
    }
  }
  return id ? `https://${CDN_HOST}/${id}?format=webp` : '';
}

// https://cdn.cosmos.so/<uuid>?format=webp&w=400  →  <uuid>
function idFromCdnUrl(url) {
  const m = /cdn\.cosmos\.so\/([^/?#]+)/i.exec(url || '');
  return m ? m[1] : null;
}

const RESERVED_PATHS = new Set([
  'home', 'explore', 'search', 'settings', 'notifications', 'about',
  'login', 'signup', 'onboarding', 'e', 'element', 'cluster', 'clusters',
]);

// URL shapes we sync: /<username>, /<username>/saved, /<username>/<slug>.
function profilePathParts() {
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return null;
  if (RESERVED_PATHS.has(parts[0].toLowerCase())) return null;
  return parts;
}

function isVisible(el) {
  return el.getClientRects().length > 0;
}

// Owner-only, visible controls: "Edit profile" on your profile, "Organize"
// on your own collection. Other people's pages show Follow/Save instead, and
// the feed keeps these in a hidden menu — so a visible match means "mine".
function isOwnPage() {
  return [...document.querySelectorAll('a, button')].some((el) => {
    const t = (el.textContent || '').trim();
    return /^(edit profile|organize)$/i.test(t) && isVisible(el);
  });
}

// Name a collection from its URL slug (deterministic; the page <h1> is often
// the profile name, not the collection title). Null on profile / saved tab.
function collectionNameFor(parts) {
  if (parts.length !== 2 || parts[1].toLowerCase() === 'saved') return null;
  return parts[1]
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 80);
}

function collectElements() {
  const parts = profilePathParts();
  if (!parts || !isOwnPage()) return [];
  // /<username>/collections is an index of collection cards, not saves — its
  // cdn images are collection covers. Never import from it; we only enumerate
  // the individual collections it links to (see collectOwnCollectionLinks).
  if (parts.length === 2 && parts[1].toLowerCase() === 'collections') return [];
  const collection = collectionNameFor(parts);
  // Scope to the main content area — excludes the fixed header/bottom bar,
  // whose preview images aren't saves.
  const root = document.querySelector('main') || document;
  const out = [];
  for (const img of root.querySelectorAll(`img[src*="${CDN_HOST}"]`)) {
    const src = img.currentSrc || img.src || '';
    if (src.includes('/default-avatars/')) continue;          // avatars
    const wMatch = /[?&]w=(\d+)/.exec(src);
    if (wMatch && parseInt(wMatch[1], 10) < 200) continue;    // small chrome thumbs
    if (img.getClientRects().length === 0) continue;          // hidden / preload
    // Avatars and mini collection covers are often *requested* at retina
    // width (w≥200) while rendering tiny, so the w filter alone lets them
    // through — they were landing as stray "avatar" saves. Gate on the
    // actual on-screen size instead: real grid tiles are large; account
    // avatars, collaborator faces, and index thumbnails are not. (A tile
    // still mid-load reads small here; we skip it now and the 2s re-sweep
    // catches it at full size, since `seen` isn't marked until it passes.)
    const rect = img.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) continue;
    // Chrome that isn't a save: profile header avatar, side rails, etc.
    if (img.closest('header, nav, aside, [role="banner"]')) continue;
    const id = idFromCdnUrl(src);
    if (!id || seen.has(id)) continue;
    if (excludedUuids.has(id.toLowerCase())) continue;        // "Similar" recommendation, not a save
    const mediaUrl = `https://${CDN_HOST}/${id}?format=webp`;  // full-res
    const a = img.closest('a[href]');
    let pageUrl = mediaUrl;
    if (a) {
      try { pageUrl = new URL(a.getAttribute('href'), location.origin).href; }
      catch { /* keep the fallback */ }
    }
    // Skip an element already saved live this session — its poster tile
    // carries a different cdn id than the live save used, so uuid dedup
    // alone would let it through as a duplicate/blank second save.
    const eid = /\/e\/(\d+)/.exec(pageUrl);
    if (eid && savedElementIds.has(eid[1])) continue;
    seen.add(id);
    out.push({ id, mediaUrl, pageUrl, type: 'image', caption: img.alt || '', collection });
  }
  return out;
}

// What to crawl next, given the current own-page. Cosmos nests saves two ways:
//   /<username>              profile — uncategorized saves (scraped in place)
//   /<username>/collections  index — lists collections, holds NO saves itself
//   /<username>/<slug>       an individual collection — the real saves
// So from the profile we head to the collections index; from the index we
// enqueue each individual collection; an individual collection returns nothing
// (its saves are scraped where we already are).
function collectOwnCollectionLinks() {
  // No isOwnPage() gate here: this only runs during our own backfill crawl, on
  // pages the background navigated to from the stored username, and it's scoped
  // to links under the current path's username. The collections index may not
  // carry the "Organize"/"Edit profile" signal, and we can't miss it.
  const parts = profilePathParts();
  if (!parts) return [];
  const username = parts[0].toLowerCase();
  const onProfileRoot = parts.length === 1;
  const onCollectionsIndex = parts.length === 2 && parts[1].toLowerCase() === 'collections';

  // From the profile, the only hop we need is the collections index — that's
  // where the collections are listed. (The profile itself just holds the
  // uncategorized saves, already scraped in place.)
  if (onProfileRoot) return [`${location.origin}/${parts[0]}/collections`];

  // From the collections index, enqueue each individual collection card. Any
  // other page is already inside a collection — nothing more to enumerate.
  if (!onCollectionsIndex) return [];

  const out = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    let href;
    try { href = new URL(a.getAttribute('href'), location.origin); }
    catch { continue; }
    if (href.host !== location.host) continue;
    const p = href.pathname.split('/').filter(Boolean);
    if (p.length !== 2) continue;                    // /<username>/<slug> only
    if (p[0].toLowerCase() !== username) continue;   // our own collections
    const slug = p[1].toLowerCase();
    if (slug === 'saved' || slug === 'collections' || RESERVED_PATHS.has(slug)) continue;
    out.add(`${href.origin}/${p[0]}/${p[1]}`);
  }
  return [...out];
}

let timer = null;
function stop() {
  try { observer.disconnect(); } catch { /* ignore */ }
  if (timer) { clearInterval(timer); timer = null; }
}

function flush() {
  // If the extension was reloaded, this old content script is orphaned — bail
  // (and stop the timer) instead of spamming "Extension context invalidated".
  if (!chrome.runtime || !chrome.runtime.id) { stop(); return; }
  rememberUsername();
  const elements = collectElements();
  if (!elements.length) return;
  const where = elements[0].collection ? `collection "${elements[0].collection}"` : 'profile';
  try {
    chrome.runtime.sendMessage({ type: 'gatheros:cosmos-saved-batch', elements });
    console.log('[gatheros] cosmos: sending', elements.length, `saved element(s) from ${where} to GatherOS`);
  } catch {
    stop();
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => { scheduled = false; flush(); }, 700);
}

const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('load', schedule);
// Cosmos lazy-loads tiles by swapping an <img>'s src (an attribute change
// childList won't catch) and streams more in on scroll — so also re-sweep on a
// timer. seen dedupes, so re-scans never re-send. Scroll to pull it all in.
timer = setInterval(schedule, 2000);
console.log('[gatheros] cosmos watcher active on', location.href);
setTimeout(() => {
  console.log(
    '[gatheros] cosmos gate —', location.pathname,
    '| profile-shaped URL:', !!profilePathParts(),
    '| own page:', isOwnPage(),
  );
}, 1500);
schedule();

// ── Backfill import ("Import saves" from the panel) ─────────────────
// The background opens this profile tab and sends 'gatheros:start-import'.
// We auto-scroll the grid at a gentle pace so Cosmos keeps loading older
// tiles for the sweep to relay, and stop when the page stops growing (grid
// bottom) — telling the background so it can finalize. The background also
// stops us early via 'gatheros:stop-import' when the requested count is hit.
let importScrollActive = false;
function importSleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function runImportScroll() {
  if (importScrollActive) return; // already running — ignore duplicate start
  importScrollActive = true;
  showCosmosToast('Importing Cosmos saves…', { sticky: true });

  const TICK_MS = 1500;   // gentle — Cosmos lazy-loads tiles on scroll
  const MAX_TICKS = 400;  // backstop so a stuck page can't scroll forever
  const BOTTOM_STAGNANT_TICKS = 4; // grid height flat this long = bottom
  let ticks = 0;
  let lastHeight = 0;
  let flat = 0;
  while (importScrollActive && ticks < MAX_TICKS) {
    const scroller = document.scrollingElement || document.documentElement;
    const height = scroller ? scroller.scrollHeight : 0;
    if (scroller) window.scrollTo(0, height);
    schedule(); // pull in the tiles the scroll just rendered
    flat = height <= lastHeight ? flat + 1 : 0;
    lastHeight = height;
    if (flat >= BOTTOM_STAGNANT_TICKS) break; // reached the bottom of the grid
    ticks += 1;
    await importSleep(TICK_MS);
  }
  const wasActive = importScrollActive;
  importScrollActive = false;
  // Reached the bottom on our own (not stopped by the background). Report it,
  // along with any collections found here (only the profile root has them),
  // so the background can crawl each collection next.
  if (wasActive && chrome.runtime && chrome.runtime.id) {
    const collections = collectOwnCollectionLinks();
    console.log('[gatheros] cosmos import — finished', location.pathname,
      collections.length ? `| queued ${collections.length} collection(s): ${collections.join(', ')}` : '| no collections to crawl');
    try {
      chrome.runtime.sendMessage({ type: 'gatheros:cosmos-import-scrolled', collections });
    } catch { /* extension reloaded */ }
  }
}

function stopImportScroll(summary) {
  importScrollActive = false;
  const n = summary && typeof summary.imported === 'number' ? summary.imported : null;
  if (n !== null) {
    showCosmosToast(
      n > 0 ? `Done — imported ${n} save${n === 1 ? '' : 's'}` : 'No new saves to import',
      {}, // non-sticky → auto-dismisses
    );
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return undefined;
  if (msg.type === 'gatheros:start-import') { runImportScroll(); return false; }
  if (msg.type === 'gatheros:import-progress') {
    if (importScrollActive) {
      const saved = typeof msg.imported === 'number' ? msg.imported : 0;
      const scanned = typeof msg.processed === 'number' ? msg.processed : 0;
      showCosmosToast(
        saved > 0 ? `Importing… ${saved} saved` : `Importing… ${scanned} scanned`,
        { sticky: true },
      );
    }
    return false;
  }
  if (msg.type === 'gatheros:stop-import') { stopImportScroll(msg.summary); return false; }
  return undefined;
});

// Small glass toast (mirrors the X watcher's) so the backfill has visible
// progress in the tab it opens.
let cosmosToastEl = null;
let cosmosToastTimer = null;
function showCosmosToast(message, { sticky = false } = {}) {
  if (!cosmosToastEl) {
    cosmosToastEl = document.createElement('div');
    cosmosToastEl.style.cssText = [
      'position:fixed', 'right:24px', 'bottom:24px', 'z-index:2147483647',
      'display:flex', 'align-items:center', 'gap:8px', 'padding:10px 14px',
      'font:500 13px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif',
      'color:rgba(255,255,255,0.95)', 'background:rgba(20,20,22,0.78)',
      'backdrop-filter:blur(20px) saturate(1.8)', '-webkit-backdrop-filter:blur(20px) saturate(1.8)',
      'border:0.5px solid rgba(255,255,255,0.14)', 'border-radius:999px',
      'box-shadow:0 1px 2px rgba(0,0,0,0.2),0 8px 22px rgba(0,0,0,0.28)',
      'opacity:0', 'transform:translateY(8px)',
      'transition:opacity 160ms ease,transform 160ms ease', 'pointer-events:none',
    ].join(';');
    (document.body || document.documentElement).appendChild(cosmosToastEl);
  }
  cosmosToastEl.innerHTML =
    '<span style="width:6px;height:6px;border-radius:50%;background:rgba(110,220,140,0.95);display:inline-block"></span><span></span>';
  cosmosToastEl.querySelector('span:last-child').textContent = message;
  requestAnimationFrame(() => {
    if (!cosmosToastEl) return;
    cosmosToastEl.style.opacity = '1';
    cosmosToastEl.style.transform = 'translateY(0)';
  });
  if (cosmosToastTimer) { clearTimeout(cosmosToastTimer); cosmosToastTimer = null; }
  if (!sticky) {
    cosmosToastTimer = setTimeout(() => {
      if (!cosmosToastEl) return;
      cosmosToastEl.style.opacity = '0';
      cosmosToastEl.style.transform = 'translateY(8px)';
      setTimeout(() => { if (cosmosToastEl) { cosmosToastEl.remove(); cosmosToastEl = null; } }, 220);
    }, 4200);
  }
}
