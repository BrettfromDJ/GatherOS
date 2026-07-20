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
const seen = new Set();

// Real-time saves: the MAIN-world interceptor (cosmos-interceptor.js) detects
// the save mutation and posts the saved element here. Relay it straight to the
// background as a one-item batch so it lands in GatherOS immediately.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const d = event.data;
  if (!d || d.source !== 'gatheros-cosmos-interceptor' || d.type !== 'save') return;
  if (!d.mediaUrl) return; // image not seen yet — the profile/grid reader backfills it later
  const m = /cdn\.cosmos\.so\/([^/?#]+)/i.exec(d.mediaUrl);
  const id = m ? m[1] : String(d.elementId);
  if (seen.has(id)) return;
  seen.add(id);
  if (!chrome.runtime || !chrome.runtime.id) return;
  try {
    chrome.runtime.sendMessage({
      type: 'gatheros:cosmos-saved-batch',
      elements: [{ id, mediaUrl: d.mediaUrl, pageUrl: d.pageUrl || d.mediaUrl, type: 'image', caption: '', collection: null, realtime: true }],
    });
    console.log('[gatheros] cosmos: real-time save →', d.mediaUrl);
  } catch { /* extension reloaded */ }
});

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
    const id = idFromCdnUrl(src);
    if (!id || seen.has(id)) continue;
    const mediaUrl = `https://${CDN_HOST}/${id}?format=webp`;  // full-res
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

let timer = null;
function stop() {
  try { observer.disconnect(); } catch { /* ignore */ }
  if (timer) { clearInterval(timer); timer = null; }
}

function flush() {
  // If the extension was reloaded, this old content script is orphaned — bail
  // (and stop the timer) instead of spamming "Extension context invalidated".
  if (!chrome.runtime || !chrome.runtime.id) { stop(); return; }
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
