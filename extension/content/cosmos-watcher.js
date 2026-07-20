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
// collections — never the home feed, explore, or anyone else's profile.

const CDN_HOST = 'cdn.cosmos.so';
const seen = new Set();

// https://cdn.cosmos.so/<uuid>?format=webp&w=400  →  <uuid>
function idFromCdnUrl(url) {
  const m = /cdn\.cosmos\.so\/([^/?#]+)/i.exec(url || '');
  return m ? m[1] : null;
}

// Top-level cosmos.so routes that are NOT the user's own content.
const RESERVED_PATHS = new Set([
  'home', 'explore', 'search', 'settings', 'notifications', 'about',
  'login', 'signup', 'onboarding', 'e', 'element', 'cluster', 'clusters',
]);

// URL shapes we sync:
//   /<username>            → profile grid
//   /<username>/saved      → the "Saved" tab
//   /<username>/<slug>     → one of the user's collections
// The feed (/), explore, search, etc. are excluded by segment count / the
// reserved list.
function profilePathParts() {
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return null;
  if (RESERVED_PATHS.has(parts[0].toLowerCase())) return null;
  return parts;
}

// Is an element actually rendered (visible)? getClientRects() returns boxes
// for anything laid out — including position:fixed/sticky elements, which
// offsetParent wrongly reports as hidden — and nothing for display:none. So
// this catches a real, visible control without false-negatives on a sticky
// sidebar.
function isVisible(el) {
  return el.getClientRects().length > 0;
}

// Ownership check: only the signed-in user's own pages show a *visible*
// "Edit profile" control. The home feed keeps that link in a hidden menu
// (display:none), and other people's pages show "Follow" instead — so a
// visible "Edit profile" reliably means "this is mine."
function isOwnPage() {
  return [...document.querySelectorAll('a, button')]
    .some((el) => /edit profile/i.test(el.textContent || '') && isVisible(el));
}

// On a collection page (/<username>/<slug>, not /saved), the collection's
// display name is the page <h1>; fall back to a prettified slug. Returns null
// on the profile / saved tab (those aren't a named collection).
function collectionNameFor(parts) {
  if (parts.length !== 2 || parts[1].toLowerCase() === 'saved') return null;
  const h1 = (document.querySelector('h1')?.textContent || '').trim();
  if (h1) return h1.slice(0, 80);
  return parts[1].replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function collectElements() {
  const parts = profilePathParts();
  if (!parts || !isOwnPage()) return [];
  const collection = collectionNameFor(parts);
  const out = [];
  for (const img of document.querySelectorAll(`img[src*="${CDN_HOST}"]`)) {
    const src = img.currentSrc || img.src || '';
    // Skip chrome, not saves: default avatars live under /default-avatars/,
    // and avatars / small preview thumbs render tiny (?w=<200).
    if (src.includes('/default-avatars/')) continue;
    const wMatch = /[?&]w=(\d+)/.exec(src);
    if (wMatch && parseInt(wMatch[1], 10) < 200) continue;
    const id = idFromCdnUrl(src);
    if (!id || seen.has(id)) continue;
    // Full resolution: rebuild the URL WITHOUT the rendered-size (w=) cap.
    const mediaUrl = `https://${CDN_HOST}/${id}?format=webp`;
    const a = img.closest('a[href]');
    let pageUrl = mediaUrl;
    if (a) {
      try { pageUrl = new URL(a.getAttribute('href'), location.origin).href; }
      catch { /* keep the fallback */ }
    }
    seen.add(id);
    out.push({ id, mediaUrl, pageUrl, type: 'image', caption: img.alt || '', collection });
  }
  return out;
}

function flush() {
  const elements = collectElements();
  if (elements.length) {
    const where = elements[0].collection ? `collection "${elements[0].collection}"` : 'profile';
    console.log('[gatheros] cosmos: sending', elements.length, `saved element(s) from ${where} to GatherOS`);
    chrome.runtime.sendMessage({ type: 'gatheros:cosmos-saved-batch', elements });
  }
}

// Debounce so a burst of lazy-loaded tiles becomes one batch. seen resets
// per page load, so navigating to a different collection re-collects fresh.
let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => { scheduled = false; flush(); }, 700);
}

const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('load', schedule);
console.log('[gatheros] cosmos watcher active on', location.href);
// One-time gate self-report after the page has rendered — makes it obvious in
// the console whether this page is being treated as your own saves.
setTimeout(() => {
  console.log(
    '[gatheros] cosmos gate —', location.pathname,
    '| profile-shaped URL:', !!profilePathParts(),
    '| own page:', isOwnPage(),
  );
}, 1500);
schedule();
