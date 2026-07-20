// Isolated-world content script for cosmos.so.
//
// Cosmos serves its element data through Apollo GraphQL + Next.js server
// components — no clean REST API — so instead of decoding that, we read the
// saved elements straight off the rendered grid. Every saved element shows
// as an <img src="https://cdn.cosmos.so/<id>?format=webp&w=…">. We watch the
// page for those, dedupe by the CDN id, and relay batches to the background
// worker, which routes them through the desktop /save pipeline.
//
// Scope guard: only scrape the user's OWN profile grid (their saved
// elements), never the home feed or someone else's profile. Cosmos shows an
// "Edit profile" control only on your own profile, so we use that as the
// gate — if it's absent, we don't capture, which fails safe.

const CDN_HOST = 'cdn.cosmos.so';
const seen = new Set();

// https://cdn.cosmos.so/<uuid>?format=webp&w=400  →  <uuid>
function idFromCdnUrl(url) {
  const m = /cdn\.cosmos\.so\/([^/?#]+)/i.exec(url || '');
  return m ? m[1] : null;
}

// Only the user's own profile shows an "Edit profile" affordance, and its
// grid is their saved elements. Gate scraping to that page.
function onOwnSavesPage() {
  return [...document.querySelectorAll('a, button')]
    .some((el) => /edit profile/i.test((el.textContent || '').trim()));
}

function collectElements() {
  if (!onOwnSavesPage()) return [];
  const out = [];
  for (const img of document.querySelectorAll(`img[src*="${CDN_HOST}"]`)) {
    const src = img.currentSrc || img.src || '';
    // Skip chrome, not saves: Cosmos serves default avatars from a
    // /default-avatars/ path, and avatars / small preview thumbs render at a
    // tiny width (the ?w= cap). Real grid tiles come down at w>=200.
    if (src.includes('/default-avatars/')) continue;
    const wMatch = /[?&]w=(\d+)/.exec(src);
    if (wMatch && parseInt(wMatch[1], 10) < 200) continue;
    const id = idFromCdnUrl(src);
    if (!id || seen.has(id)) continue;
    // Full resolution: rebuild the URL WITHOUT the rendered-size (w=) cap so
    // we save the original, not the 400px grid thumbnail. format=webp is the
    // form Cosmos already serves; sharp handles webp on the desktop side.
    const mediaUrl = `https://${CDN_HOST}/${id}?format=webp`;
    // When the tile is a link, that's the element's page on Cosmos; keep it
    // for "Open on Cosmos". Fall back to the image URL when there's no link.
    const a = img.closest('a[href]');
    let pageUrl = mediaUrl;
    if (a) {
      try { pageUrl = new URL(a.getAttribute('href'), location.origin).href; }
      catch { /* keep the fallback */ }
    }
    seen.add(id);
    out.push({ id, mediaUrl, pageUrl, type: 'image', caption: img.alt || '' });
  }
  return out;
}

function flush() {
  const elements = collectElements();
  if (elements.length) {
    console.log('[gatheros] cosmos: sending', elements.length, 'saved element(s) to GatherOS');
    chrome.runtime.sendMessage({ type: 'gatheros:cosmos-saved-batch', elements });
  }
}

// Debounce so a burst of lazy-loaded tiles becomes one batch.
let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => { scheduled = false; flush(); }, 700);
}

// Grid tiles render (and lazy-load on scroll) after the initial paint, so
// watch the tree and sweep on load.
const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('load', schedule);
console.log('[gatheros] cosmos watcher active on', location.href);
schedule();
