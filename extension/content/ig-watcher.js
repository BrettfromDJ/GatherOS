// Isolated-world content script for instagram.com. Two jobs:
//
//   1. Relay the saved-post batches the MAIN-world interceptor
//      (ig-interceptor.js) extracts from Instagram's saved-feed network
//      responses up to the background service worker, which owns the
//      "seen" baseline and routes new posts through the desktop /save
//      pipeline.
//
//   2. Drive the "Import saved" backfill: when the background asks, flip
//      the interceptor into IMPORT_MODE and gently auto-scroll the saved
//      page so Instagram keeps loading older pages for the interceptor
//      to capture. The background owns the stop decision (count reached
//      or no new posts) and sends 'gatheros:ig-stop-import'.
//
// v1 is interceptor-only: there's no real-time "save" click capture
// (Instagram's save button is brittle to hook and the interceptor
// already sees newly-saved posts when the saved collection refetches).

// ── Relay saved-post batches ───────────────────────────────────────
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'gatheros-ig-interceptor') return;
  if (data.type === 'saved-batch' && Array.isArray(data.posts)) {
    chrome.runtime.sendMessage({ type: 'gatheros:ig-saved-batch', posts: data.posts });
  }
  // Replay template for the background poll (saves made on mobile sync
  // without a desktop Saved-page visit).
  if (data.type === 'saved-refresh-template' && data.url) {
    chrome.runtime.sendMessage({
      type: 'gatheros:ig-saved-refresh-template',
      url: data.url,
      headers: data.headers || {},
    });
  }
});

// ── In-page toast (mirrors the X watcher's pill) ───────────────────
let toastEl = null;
let toastTimer = null;
function showToast(message, { tone = 'ok', sticky = false } = {}) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.style.cssText = [
      'position:fixed', 'right:24px', 'bottom:24px', 'z-index:2147483647',
      'display:flex', 'align-items:center', 'gap:8px', 'padding:10px 14px',
      'font:500 13px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif',
      'color:rgba(255,255,255,0.95)', 'background:rgba(20,20,22,0.78)',
      'backdrop-filter:blur(20px) saturate(1.8)',
      '-webkit-backdrop-filter:blur(20px) saturate(1.8)',
      'border:0.5px solid rgba(255,255,255,0.14)', 'border-radius:999px',
      'box-shadow:0 1px 2px rgba(0,0,0,0.2),0 8px 22px rgba(0,0,0,0.28)',
      'opacity:0', 'transform:translateY(8px)',
      'transition:opacity 160ms ease,transform 160ms ease', 'pointer-events:none',
    ].join(';');
    document.body.appendChild(toastEl);
  }
  const dotColor = tone === 'error' ? 'rgba(255,90,90,0.95)' : 'rgba(110,220,140,0.95)';
  toastEl.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block"></span><span></span>`;
  toastEl.querySelector('span:last-child').textContent = message;
  requestAnimationFrame(() => {
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translateY(0)';
  });
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  if (!sticky) {
    toastTimer = setTimeout(() => {
      if (!toastEl) return;
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateY(8px)';
    }, 2200);
  }
}

// ── Backfill auto-scroll ───────────────────────────────────────────
let importScrollActive = false;

function setInterceptorImportMode(on) {
  window.postMessage(
    { source: 'gatheros-ig-control', type: 'import-mode', on: !!on },
    window.location.origin,
  );
}

const importSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runImportScroll() {
  if (importScrollActive) return;
  importScrollActive = true;
  setInterceptorImportMode(true);
  showToast('Importing saved posts…', { tone: 'ok', sticky: true });

  // Instagram lazy-loads on scroll, same as X. Keep the cadence gentle
  // so we stay clear of Instagram's abuse detection (account safety is
  // the whole reason this is user-initiated and never a background poll).
  const TICK_MS = 1400;
  const MAX_TICKS = 400;
  let ticks = 0;
  while (importScrollActive && ticks < MAX_TICKS) {
    const scroller = document.scrollingElement || document.documentElement;
    if (scroller) window.scrollTo(0, scroller.scrollHeight);
    ticks += 1;
    await importSleep(TICK_MS);
  }
  if (importScrollActive) {
    importScrollActive = false;
    setInterceptorImportMode(false);
  }
}

function stopImportScroll(summary) {
  importScrollActive = false;
  setInterceptorImportMode(false);
  const n = summary && typeof summary.imported === 'number' ? summary.imported : null;
  if (n !== null) {
    showToast(
      n > 0 ? `Done — imported ${n} saved post${n === 1 ? '' : 's'}` : 'No new saved posts to import',
      { tone: 'ok' },
    );
  }
}

// ── Self-start after navigating to the saved tab ───────────────────
// The backfill opens instagram.com, but the saved feed lives at
// /<username>/saved/ — a URL only the page knows (the worker can't see
// the viewer's username). So on every instagram.com load we check a
// storage flag the worker sets; if a backfill is pending we either
// start scrolling (already on a saved page) or navigate there. Using a
// flag rather than a one-off message is what lets the start survive the
// navigation reload.
const IG_IMPORT_FLAG = 'gatherosIgImportActive';

function resolveSavedUrl() {
  // The saved-tab link in the profile menu / nav, e.g. /<user>/saved/.
  const a = document.querySelector('a[href*="/saved/"]');
  if (a) {
    try { return new URL(a.getAttribute('href'), location.origin).href; }
    catch { /* fall through */ }
  }
  return null;
}

async function checkPendingImport() {
  let active = false;
  try {
    const data = await chrome.storage.local.get(IG_IMPORT_FLAG);
    active = !!data[IG_IMPORT_FLAG];
  } catch { return; }
  if (!active) return;
  if (/\/saved(\/|$)/.test(location.pathname)) {
    runImportScroll();
  } else {
    const url = resolveSavedUrl();
    if (url && url !== location.href) {
      location.assign(url); // full reload re-runs this script on the saved page
    } else {
      showToast('Open your Saved posts to finish importing', { tone: 'ok', sticky: true });
    }
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return undefined;
  if (msg.type === 'gatheros:ig-start-import') { runImportScroll(); return false; }
  if (msg.type === 'gatheros:ig-import-progress') {
    if (importScrollActive) {
      const saved = typeof msg.imported === 'number' ? msg.imported : 0;
      const scanned = typeof msg.processed === 'number' ? msg.processed : 0;
      showToast(
        saved > 0 ? `Importing… ${saved} saved` : `Scanning saved posts… ${scanned}`,
        { tone: 'ok', sticky: true },
      );
    }
    return false;
  }
  if (msg.type === 'gatheros:ig-stop-import') { stopImportScroll(msg.summary); return false; }
  return undefined;
});

// Run once on load — picks up a pending backfill after the navigation
// to the saved tab.
checkPendingImport();
