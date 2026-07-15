import {
  importLimitReached,
  importProcessedCount,
  rememberImportEntries,
} from './import-limit.mjs';
import {
  isAcceptedSaveResponse,
  isNewImportedSaveResponse,
} from './save-response.mjs';
import {
  catchUpPreflightResult,
  catchUpSummary,
} from './catch-up-import.mjs';
import {
  runCatchUpTransportBatch,
  runFixedTransportBatch,
} from './x-import-transport.mjs';
import { createSocialImportProgress } from './social-import-progress.mjs';

// Service worker for the GatherOS browser extension.
//
// v1 capture surface: right-click any image → "Save to GatherOS".
// Talks to the desktop app via Chrome's native messaging protocol —
// no localhost port, no token paste, no Options page. The desktop
// app installs the native host manifest on first launch, so
// installing the extension and the app in either order works.

const HOST_NAME = 'co.gatheros.host';
const MENU_ID = 'gatheros-save-image';
// chrome.alarms identifier for the recurring "check x.com for new
// bookmarks" job. Two minutes balances "phone bookmarks appear
// promptly" against "don't hammer twitter for users who never
// bookmark anything." A focus-triggered poll (see below) covers the
// common case — bookmark on phone, then return to the computer —
// near-instantly, so this timer is mostly a safety net.
const BOOKMARK_POLL_ALARM = 'gatherosBookmarkPoll';
const BOOKMARK_POLL_PERIOD_MINUTES = 2;

// Don't fire the poll more than once per this window, no matter how
// many triggers (alarm + window focus) land close together. Persisted
// to storage so it survives service-worker teardown.
const BOOKMARK_POLL_THROTTLE_MS = 30 * 1000;
const STORAGE_LAST_POLL_KEY = 'gatherosLastPollAt';

// Create — or re-create — the recurring bookmark poll. Always uses
// periodInMinutes so the alarm keeps firing. Safe to call repeatedly:
// chrome.alarms.create replaces any same-named alarm, so this also
// self-heals if the recurring alarm ever got clobbered by a fire-once
// one (e.g. a manual `chrome.alarms.create(BOOKMARK_POLL_ALARM, { when })`
// test trigger reusing this name — use a throwaway name for that).
function ensureBookmarkPollAlarm() {
  chrome.alarms.create(BOOKMARK_POLL_ALARM, { periodInMinutes: BOOKMARK_POLL_PERIOD_MINUTES });
}

// Throttled entry point for every poll trigger. Skips if we polled
// within the last BOOKMARK_POLL_THROTTLE_MS; otherwise stamps the
// time and runs the refresh. Stamping before the fetch is intentional
// — the throttle caps request rate regardless of success.
async function maybePollBookmarks() {
  const { [STORAGE_LAST_POLL_KEY]: last = 0 } = await chrome.storage.local.get(STORAGE_LAST_POLL_KEY);
  const now = Date.now();
  if (now - last < BOOKMARK_POLL_THROTTLE_MS) return;
  await chrome.storage.local.set({ [STORAGE_LAST_POLL_KEY]: now });
  await pollBookmarksRefresh();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Save to GatherOS',
    contexts: ['image'],
  });
  // Register the polling alarm on install and on every browser
  // startup. chrome.alarms persists across service-worker idles so
  // this only needs to fire-and-forget; the alarm itself wakes the
  // worker to run the poll on the BOOKMARK_POLL_PERIOD_MINUTES cadence.
  ensureBookmarkPollAlarm();
  ensureIgPollAlarm();
});
chrome.runtime.onStartup.addListener(() => {
  ensureBookmarkPollAlarm();
  ensureIgPollAlarm();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const imageUrl = info.srcUrl;
  if (!imageUrl) {
    notify('No image URL on that element.');
    return;
  }

  try {
    const response = await chrome.runtime.sendNativeMessage(HOST_NAME, {
      type: 'save',
      imageUrl,
      pageUrl: tab?.url || info.pageUrl || null,
      pageTitle: tab?.title || null,
    });
    if (!response || !response.ok) {
      // Most common failure modes from the host:
      //   - app not running  → "app not running"
      //   - 401             → "invalid token" (prefs.json missing token)
      //   - 400             → "imageUrl required"
      const msg = response?.error || 'Save failed.';
      if (msg === 'app not running' || msg === 'GatherOS is not installed or has never been launched.') {
        notify('Open GatherOS first, then try again.');
      } else {
        notify(msg);
      }
      return;
    }
    notify(response.duplicate ? 'Already in your library.' : 'Saved to GatherOS.');
  } catch (err) {
    // chrome.runtime.lastError surfaces here as the rejection.
    // Most common: host not found (manifest never installed),
    // which means the desktop app hasn't been launched yet.
    const msg = err?.message || String(err);
    if (msg.includes('host not found') || msg.includes('Specified native messaging host')) {
      notify('Open GatherOS once to finish setup, then try again.');
    } else {
      notify(`Couldn't reach GatherOS — ${msg}`);
    }
  }
});

// Real-time X bookmark capture. The content script
// (content/x-bookmark-watcher.js) detects clicks on the bookmark
// button on x.com / twitter.com, extracts the tweet permalink +
// image URL from the surrounding article DOM, and posts the result
// here. We forward it to the GatherOS native host using the same
// 'save' message type the right-click flow uses — the desktop
// dedups by content_hash so re-bookmarking is a no-op.
//
// The content script reads the response back and renders an in-page
// toast so the user gets confirmation without leaving x.com. Errors
// route through the same channel; the content script decides what
// to show (or to stay silent if GatherOS isn't running).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return undefined;
  if (msg.type === 'gatheros:x-bookmark') {
    handleClickBookmark(msg, sendResponse);
    return true;
  }
  if (msg.type === 'gatheros:bookmark-batch') {
    handleBookmarkBatch(msg.bookmarks);
    return false;
  }
  if (msg.type === 'gatheros:bookmark-refresh-template') {
    saveRefreshTemplate(msg.url, msg.authorization);
    return false;
  }
  // Panel-triggered backfill: open the bookmarks tab and import older
  // bookmarks up to the chosen limit (msg.limit; 0 / missing = all).
  if (msg.type === 'gatheros:import-bookmarks') {
    handleImportBookmarks(msg).then(sendResponse);
    return true;
  }
  // Instagram saved-post sync. The interceptor (content/ig-interceptor.js)
  // extracts saved posts from Instagram's saved-feed responses; the
  // watcher relays the batch here. Mirrors the X bookmark flow with its
  // own "seen" baseline.
  if (msg.type === 'gatheros:ig-saved-batch') {
    handleIgSavedBatch(msg.posts);
    return false;
  }
  if (msg.type === 'gatheros:ig-saved-refresh-template') {
    saveIgRefreshTemplate(msg.url, msg.headers);
    if (msg.savedPageUrl) {
      chrome.storage.local.set({ [IG_STORAGE_SAVED_URL_KEY]: msg.savedPageUrl });
    }
    return false;
  }
  // Panel-triggered Instagram backfill.
  if (msg.type === 'gatheros:import-saved') {
    handleImportSaved(msg, sender).then(sendResponse);
    return true;
  }
  // Panel-driven actions. The in-page panel (panel.js) doesn't know
  // its window/tab ids, so we fill them from the message sender. Each
  // capture runs async and reports its result through notify().
  if (msg.type === 'gatheros:capture-page') {
    captureActivePage(withSenderTab(msg, sender));
    return false;
  }
  if (msg.type === 'gatheros:capture-full-page') {
    captureFullPage(withSenderTab(msg, sender));
    return false;
  }
  if (msg.type === 'gatheros:capture-area') {
    captureActiveArea(withSenderTab(msg, sender));
    return false;
  }
  if (msg.type === 'gatheros:save-url') {
    savePageUrl(msg);
    return false;
  }
  // Status + launch route through here because content scripts can't
  // talk to the native host directly; only the worker can.
  if (msg.type === 'gatheros:status') {
    pingApp().then(sendResponse);
    return true;
  }
  if (msg.type === 'gatheros:open') {
    openApp().then(sendResponse);
    return true;
  }
  return undefined;
});

// Merge the sender's tab ids into a panel message — the panel knows
// pageUrl/pageTitle (via location/document) but not window/tab ids.
function withSenderTab(msg, sender) {
  const tab = (sender && sender.tab) || {};
  return {
    ...msg,
    windowId: msg.windowId ?? tab.windowId,
    tabId: msg.tabId ?? tab.id,
  };
}

async function pingApp() {
  try {
    const r = await chrome.runtime.sendNativeMessage(HOST_NAME, { type: 'ping' });
    return {
      ok: true,
      appRunning: !!(r && r.appRunning),
      // Sync switches from the app's Settings. Default on if absent
      // (older app that doesn't report them).
      syncX: r ? r.syncX !== false : true,
      syncInstagram: r ? r.syncInstagram !== false : true,
    };
  } catch (err) {
    return { ok: false, hostMissing: true, error: err?.message || String(err) };
  }
}

async function openApp() {
  try {
    const r = await chrome.runtime.sendNativeMessage(HOST_NAME, { type: 'open' });
    return { ok: !!(r && r.ok) };
  } catch (err) {
    return { ok: false, hostMissing: true, error: err?.message || String(err) };
  }
}

// Toolbar click toggles the in-page panel (panel.js detects an existing
// instance and removes it). Pages where injection is disallowed
// (chrome://, the Web Store, PDFs) fail gracefully with a hint.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['panel.js'] });
  } catch {
    notify('Open the GatherOS panel on a normal web page (not this one).');
  }
});

function handleClickBookmark(msg, sendResponse) {
  chrome.runtime.sendNativeMessage(HOST_NAME, {
    type: 'save',
    imageUrl: msg.imageUrl,
    pageUrl: msg.pageUrl,
    videoUrl: msg.videoUrl,
    posterUrl: msg.posterUrl,
    tweetMeta: msg.tweetMeta,
    tags: msg.tags,
  }).then(async (response) => {
    const ok = isAcceptedSaveResponse(response);
    sendResponse({
      ok,
      duplicate: !!(response && response.duplicate),
      error: response?.error
        || (response?.syncDisabled ? 'Bookmark sync is disabled in GatherLocal.' : null)
        || (response?.skipped ? 'Save skipped.' : null),
    });
    // Mark this tweet as seen so the bookmark-batch flow (cross-
    // device sync) doesn't re-import it later. We do this even on
    // duplicate so the seen set stays in sync with what GatherOS
    // actually has.
    if (ok && msg.tweetId) {
      await markBookmarksSeen([msg.tweetId]);
    }
  }).catch((err) => {
    const text = err?.message || String(err);
    // Distinguish "GatherOS isn't running / installed" from real
    // errors so the content script can stay quiet rather than nag.
    const offline = text.includes('host not found')
      || text.includes('Specified native messaging host');
    sendResponse({
      ok: false,
      offline,
      error: text,
    });
  });
}

// ── Cross-device bookmark sync ─────────────────────────────────────
//
// The interceptor (content/x-graphql-interceptor.js) extracts every
// bookmark from every /Bookmarks GraphQL response it sees and ships
// the batch here through the content script. We compare each tweet
// id against a "seen" set in chrome.storage.local and route any
// new ones through the same /save pipeline the click capture uses.
//
// Baseline: the first batch we ever see is recorded silently (the
// user's existing archive — do not flood the library). From the
// second batch onward, anything not in the seen set is treated as
// a new bookmark from another device (iOS, web, etc.) and imported.
const STORAGE_SEEN_KEY = 'gatherosBookmarksSeen';
const STORAGE_BASELINE_KEY = 'gatherosBookmarksBaselineEstablished';
const STORAGE_VERSION_KEY = 'gatherosBookmarksCaptureVersion';
// Bump whenever the set of importable tweets widens. Text-only tweets
// became importable here; without a re-baseline, every previously-
// bookmarked text tweet (which the old code never recorded as "seen")
// would suddenly count as new and flood the library. On a version
// mismatch we re-seed the baseline silently instead.
const CAPTURE_VERSION = 2;

async function readSeenSet() {
  const data = await chrome.storage.local.get([STORAGE_SEEN_KEY, STORAGE_BASELINE_KEY, STORAGE_VERSION_KEY]);
  const seen = new Set(Array.isArray(data[STORAGE_SEEN_KEY]) ? data[STORAGE_SEEN_KEY] : []);
  const baseline = !!data[STORAGE_BASELINE_KEY];
  const version = Number(data[STORAGE_VERSION_KEY]) || 0;
  return { seen, baseline, version };
}

async function writeSeenSet(seen, { baseline, version } = {}) {
  const update = { [STORAGE_SEEN_KEY]: Array.from(seen) };
  if (baseline !== undefined) update[STORAGE_BASELINE_KEY] = !!baseline;
  if (version !== undefined) update[STORAGE_VERSION_KEY] = version;
  await chrome.storage.local.set(update);
}

async function markBookmarksSeen(ids) {
  if (!ids || !ids.length) return;
  const { seen } = await readSeenSet();
  let changed = false;
  for (const id of ids) {
    if (id && !seen.has(id)) {
      seen.add(id);
      changed = true;
    }
  }
  if (changed) await writeSeenSet(seen);
}

async function handleBookmarkBatch(bookmarks) {
  if (!Array.isArray(bookmarks) || bookmarks.length === 0) return;

  // A backfill owns the import: the API-driven import drives itself, so
  // ignore passive batches; the legacy scroll import routes through
  // handleImportBatch.
  if (importState) {
    if (importState.apiMode) return;
    if (importState.active) await handleImportBatch(bookmarks);
    return;
  }

  const { seen, baseline, version } = await readSeenSet();

  if (!baseline || version !== CAPTURE_VERSION) {
    // First batch ever (existing archive at install time) OR the first
    // batch after the importable set widened (e.g. text-only tweets).
    // Record everything currently visible silently so the backlog
    // doesn't flood the library; only tweets bookmarked from here on
    // count as new.
    for (const b of bookmarks) {
      if (b && b.tweetId) seen.add(b.tweetId);
    }
    await writeSeenSet(seen, { baseline: true, version: CAPTURE_VERSION });
    return;
  }

  // Established baseline — anything not in the seen set is a new
  // bookmark from any device. Import sequentially so we don't hit
  // the native host with a burst of parallel saves.
  const toImport = bookmarks.filter((b) => b && b.tweetId && !seen.has(b.tweetId));
  for (const b of toImport) {
    try {
      const response = await syncBookmarkToGather(b);
      if (isAcceptedSaveResponse(response)) {
        seen.add(b.tweetId);
      } else {
        console.warn('[gatheros] cross-device bookmark sync rejected:', response?.error || 'save not accepted');
      }
    } catch (err) {
      console.warn('[gatheros] cross-device bookmark sync failed:', err?.message || err);
    }
  }
  await writeSeenSet(seen);
}

// ── Backfill import ("Import bookmarks" from the panel) ─────────────
//
// Opens (or focuses) the bookmarks tab, asks the watcher there to
// auto-scroll, and imports every bookmark the interceptor surfaces up
// to the chosen limit. Unlike the normal flow, this bypasses the
// extension's "seen" baseline and sends each bookmark to the desktop,
// which is the real source of truth for dedup (content_hash) and
// deletes (tweet tombstones). That matters: bookmarks recorded into
// the seen-set at install time (baseline) were never actually saved,
// so gating a backfill on the seen-set would silently skip exactly the
// history the user is trying to import.

// Remote-controllable kill switch. Defaults to enabled; set this key
// truthy (from the desktop app over the native bridge, or a future
// config fetch) to disable the backfill in the field without shipping
// a new extension.
const STORAGE_IMPORT_DISABLED_KEY = 'gatherosImportDisabled';
// Consecutive batches that surface no page we haven't already processed
// this run → we've hit the bottom (or X stopped paginating). Ends the
// import so it doesn't scroll forever.
const IMPORT_STAGNANT_BATCHES_LIMIT = 4;
// Whole-run safety valve: if batches stop arriving entirely (page never
// loaded, signed out, etc.) the stagnation counter never advances, so
// force-end after this long.
const IMPORT_WATCHDOG_MS = 6 * 60 * 1000;

// Module-level run state. null when no backfill is active.
// { active, tabId, limit, processed:Set<id>, imported:number,
//   stagnant:number, watchdog:timeoutId }
let importState = null;

function createImportProgress(platform, mode, target = null) {
  return createSocialImportProgress({
    sendNativeMessage: (host, payload) => chrome.runtime.sendNativeMessage(host, payload),
    log: (...args) => console.warn(...args),
  });
}

function reserveSocialImport(platform) {
  if ((importState && importState.active) || (igImportState && igImportState.active)) return null;
  const reservation = { active: true, reservation: true, platform };
  if (platform === 'x') importState = reservation;
  else igImportState = reservation;
  return reservation;
}

function releaseSocialImport(platform, reservation) {
  if (platform === 'x' && importState === reservation) importState = null;
  if (platform === 'instagram' && igImportState === reservation) igImportState = null;
}

// Signed-in checks via each platform's real login cookie (auth_token /
// sessionid — the CSRF tokens exist for guests, so they aren't proof of
// a session). Returned to the panel so it can show an inline "sign in"
// message rather than relying on a missable system notification.
async function xSignedIn() {
  try {
    const a = await chrome.cookies.get({ url: 'https://x.com/', name: 'auth_token' });
    return !!(a && a.value);
  } catch { return false; }
}
async function igSignedIn() {
  try {
    const s = await chrome.cookies.get({ url: 'https://www.instagram.com/', name: 'sessionid' });
    return !!(s && s.value);
  } catch { return false; }
}

async function handleImportBookmarks(msg) {
  const reservation = reserveSocialImport('x');
  if (!reservation) {
    notify('A bookmark import is already running.');
    return { ok: false, busy: true };
  }
  const { [STORAGE_IMPORT_DISABLED_KEY]: disabled } =
    await chrome.storage.local.get(STORAGE_IMPORT_DISABLED_KEY);
  if (disabled) {
    releaseSocialImport('x', reservation);
    notify('Bookmark import is temporarily unavailable.');
    return { ok: false, disabled: true };
  }
  if (!(await xSignedIn())) {
    releaseSocialImport('x', reservation);
    return { ok: false, needsSignIn: true, platform: 'x' };
  }

  // No point opening x.com and scrolling if the desktop can't receive
  // saves — every import would just fail. Tell the user to open it.
  const status = await pingApp();
  if (!status || status.hostMissing || !status.appRunning) {
    releaseSocialImport('x', reservation);
    notify('Open GatherOS first, then run Import bookmarks.');
    return { ok: false, appClosed: true };
  }

  const mode = msg && msg.mode === 'catch-up' ? 'catch-up' : 'fixed';
  if (mode === 'catch-up') {
    try {
      const boundary = await requestXBookmarkStatus([]);
      if (!boundary || !boundary.ok) {
        releaseSocialImport('x', reservation);
        notify('Could not reach GatherOS.');
        return { ok: false, error: 'Could not reach GatherOS.' };
      }
      const preflight = catchUpPreflightResult(boundary);
      if (preflight) {
        releaseSocialImport('x', reservation);
        return preflight;
      }
    } catch {
      releaseSocialImport('x', reservation);
      notify('Could not reach GatherOS.');
      return { ok: false, error: 'Could not reach GatherOS.' };
    }
  }

  // 0 / missing / non-positive = "all".
  const n = Number(msg && msg.limit);
  const limit = mode === 'catch-up' ? Infinity : (Number.isFinite(n) && n > 0 ? n : Infinity);

  // Background import — replay the captured Bookmarks request and follow
  // the cursor, no tab or auto-scroll (mirrors the Instagram path).
  runXApiImport(limit, mode, reservation);
  return { ok: true };
}

async function requestXBookmarkStatus(tweetUrls) {
  const response = await chrome.runtime.sendNativeMessage(HOST_NAME, {
    type: 'x-bookmark-status',
    tweetUrls,
  });
  if (!response || !response.ok || !Array.isArray(response.statuses)
    || response.statuses.length !== tweetUrls.length) {
    throw new Error(response?.error || 'bookmark status failed');
  }
  return response;
}

// Rewrite the Bookmarks request URL's `variables` JSON to page from a
// given cursor (X paginates via variables.cursor, not a query param).
function xWithCursor(baseUrl, cursor) {
  try {
    const u = new URL(baseUrl);
    const raw = u.searchParams.get('variables');
    if (!raw) return baseUrl;
    let vars;
    try { vars = JSON.parse(raw); } catch { return baseUrl; }
    if (cursor) vars.cursor = cursor; else delete vars.cursor;
    u.searchParams.set('variables', JSON.stringify(vars));
    return u.toString();
  } catch { return baseUrl; }
}

// Find the timeline's bottom cursor in a Bookmarks response.
function extractBottomCursor(json) {
  let found = null;
  (function walk(node) {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const c of node) walk(c); return; }
    if (node.cursorType === 'Bottom' && typeof node.value === 'string') { found = node.value; return; }
    for (const k of Object.keys(node)) { if (k === '__typename') continue; walk(node[k]); }
  })(json);
  return found;
}

// Paginate the captured Bookmarks GraphQL request from the worker,
// following the bottom cursor, importing each bookmark up to `limit`.
// Fixed/all imports override tombstones; catch-up preserves them.
// Uses the stored bearer + a fresh ct0 cookie;
// no tab, no scroll.
async function runXApiImport(limit, mode = 'fixed', reservation = null) {
  // Signed-in check first. auth_token is X's real login cookie (ct0 is
  // the CSRF token and can exist for guests), so check it before doing
  // anything — a signed-out user gets a clear message instead of being
  // dumped on x.com's login page by the tab fallback.
  let authToken = false;
  let csrf = null;
  try {
    const at = await chrome.cookies.get({ url: 'https://x.com/', name: 'auth_token' });
    authToken = !!(at && at.value);
    const c = await chrome.cookies.get({ url: 'https://x.com/', name: 'ct0' });
    if (c && c.value) csrf = c.value;
  } catch { /* ignore */ }
  if (!authToken) {
    releaseSocialImport('x', reservation);
    notify('Sign in to X in this browser, then run Import bookmarks.');
    return;
  }

  const progress = createImportProgress('x', mode, mode === 'fixed' && Number.isFinite(limit) ? limit : null);
  await progress.start({ platform: 'x', mode, target: mode === 'fixed' && Number.isFinite(limit) ? limit : null });

  const { [STORAGE_TEMPLATE_KEY]: template } = await chrome.storage.local.get(STORAGE_TEMPLATE_KEY);

  // Signed in but no replayable request yet (or no csrf) — fall back to
  // the visible bookmarks tab, which captures a fresh template so the
  // quiet path works next time.
  if (!template || !template.url || !template.authorization || !csrf) {
    return runXScrollImport(limit, mode, progress, reservation);
  }

  const headers = {
    authorization: template.authorization,
    'x-csrf-token': csrf,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': 'en',
    accept: '*/*',
  };

  // Probe the top request VERBATIM (byte-identical to the working
  // background poll — no variables rewrite). Any failure → fall back to
  // the reliable tab import rather than silently importing nothing.
  let json;
  try {
    const res = await fetch(template.url, { method: 'GET', credentials: 'include', headers });
    if (!res.ok) return runXScrollImport(limit, mode, progress, reservation);
    json = await res.json();
  } catch {
    return runXScrollImport(limit, mode, progress, reservation);
  }
  let entries = pollExtractBookmarkEntries(json);
  if (entries.length === 0) return runXScrollImport(limit, mode, progress, reservation);

  const state = {
    active: true,
    apiMode: true,
    limit,
    imported: 0,
    known: 0,
    failed: 0,
    processed: new Set(),
    seenIds: new Set(),
    mode,
    knownStreak: 0,
    boundaryReached: false,
    error: null,
    progress,
    reservation,
  };
  importState = state;
  notify('Importing bookmarks from X…');

  const PAGE_DELAY_MS = 1200;
  const MAX_PAGES = 400;
  let cursor = null;
  let lastCursor = null;
  let pages = 0;
  try {
    while (state.active && !importLimitReached(state) && pages < MAX_PAGES) {
      if (!progress.beforeNext()) { state.active = false; break; }
      await progress.update({ stage: 'scanning', scanned: state.processed.size, saved: state.imported, known: state.known, failed: state.failed });
      if (mode !== 'catch-up') rememberImportEntries(state, entries);
      if (mode === 'catch-up') {
        try {
          const result = await runCatchUpTransportBatch({
            state,
            entries,
            classify: async (pageEntries) => (
              await requestXBookmarkStatus(pageEntries.map((b) => b?.tweetUrl || ''))
            ).statuses,
            save: syncBookmarkToGather,
            isAccepted: isAcceptedSaveResponse,
            isNew: isNewImportedSaveResponse,
            progress,
          });
          state.boundaryReached = result.boundaryReached;
          for (const id of result.acceptedIds) state.seenIds.add(id);
        } catch (err) {
          if (err?.code === 'IMPORT_STOPPED') { state.active = false; break; }
          state.error = err;
          console.warn('[gatheros] X catch-up save failed:', err?.message || err);
        }
      } else {
        const result = await runFixedTransportBatch({
          state,
          entries,
          save: syncBookmarkToGather,
          isAccepted: isAcceptedSaveResponse,
          isNew: isNewImportedSaveResponse,
          onError: (err, b) => {
          console.warn('[gatheros] X import save failed:', err?.message || err);
          state.seenIds.delete(b.tweetId);
          },
          progress,
        });
        for (const id of result.acceptedIds) state.seenIds.add(id);
        for (const id of result.attemptedIds) {
          if (!result.acceptedIds.includes(id)) state.seenIds.delete(id);
        }
      }
      await progress.update({ stage: 'saving', scanned: state.processed.size, saved: state.imported, known: state.known, failed: state.failed });
      if (state.error || state.boundaryReached || !state.active) break;
      pages += 1;
      const next = extractBottomCursor(json);
      // Stop at the bottom: no cursor, an unchanging cursor, an empty
      // page (X pads the tail with cursor-only pages), or limit reached.
      if (!next || next === lastCursor || entries.length === 0 || importLimitReached(state)) break;
      lastCursor = next;
      cursor = next;
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      if (!progress.beforeNext()) { state.active = false; break; }
      let res;
      try {
        res = await fetch(xWithCursor(template.url, cursor), { method: 'GET', credentials: 'include', headers });
      } catch (err) { state.error = err; break; }
      if (!res.ok) { state.error = new Error(`X request failed (${res.status})`); break; }
      try { json = await res.json(); } catch (err) { state.error = err; break; }
      entries = pollExtractBookmarkEntries(json);
    }
  } catch (err) {
    if (err?.code === 'IMPORT_STOPPED') state.active = false;
    else state.error = err;
  } finally {
    const imported = state.imported;
    if (importState === state) importState = null;
    try {
      const { seen } = await readSeenSet();
      for (const id of state.seenIds) seen.add(id);
      await writeSeenSet(seen, { baseline: true, version: CAPTURE_VERSION });
    } catch { /* ignore */ }
    if (state.error) await progress.finish('failed', state.error?.message || null);
    else if (!state.active && !state.boundaryReached) await progress.finish('stopped');
    else await progress.finish('complete');
    notify(catchUpSummary(state));
  }
}

// Reliable fallback: open the bookmarks tab and auto-scroll (the original
// import). Also re-captures a fresh request template so the quiet API path
// works on the next run.
async function runXScrollImport(limit, mode = 'fixed', progress = null, reservation = null) {
  if (progress && !progress.beforeNext()) {
    releaseSocialImport('x', reservation);
    await progress.finish('stopped');
    return;
  }
  let tab;
  try {
    tab = await chrome.tabs.create({ url: 'https://x.com/i/bookmarks', active: true });
  } catch (err) {
    releaseSocialImport('x', reservation);
    if (progress) await progress.finish('failed', err?.message || null);
    notify("Couldn't open your X bookmarks.");
    return;
  }
  importState = {
    active: true,
    tabId: tab.id,
    limit,
    processed: new Set(),
    imported: 0,
    known: 0,
    failed: 0,
    stagnant: 0,
    mode,
    knownStreak: 0,
    boundaryReached: false,
    error: null,
    progress: progress || createImportProgress('x', mode, mode === 'fixed' && Number.isFinite(limit) ? limit : null),
    reservation,
    watchdog: setTimeout(() => { endImport('timeout'); }, IMPORT_WATCHDOG_MS),
  };
  if (!progress) await importState.progress.start({ platform: 'x', mode, target: mode === 'fixed' && Number.isFinite(limit) ? limit : null });
  scheduleImportStart(tab.id);
}

// Tell the bookmarks tab's watcher to begin auto-scrolling. The content
// script may not have loaded the instant the tab opens, so retry a few
// times with backoff until the message is received.
function scheduleImportStart(tabId, attempt = 0) {
  setTimeout(() => {
    if (!importState || !importState.active || importState.scrollPaused || importState.tabId !== tabId) return;
    chrome.tabs.sendMessage(tabId, { type: 'gatheros:start-import' }, () => {
      if (chrome.runtime.lastError && attempt < 6) {
        scheduleImportStart(tabId, attempt + 1);
      }
    });
  }, attempt === 0 ? 2500 : 1000);
}

function pauseImportScroll(state) {
  if (!state || state.scrollPaused || state.tabId == null) return;
  state.scrollPaused = true;
  chrome.tabs.sendMessage(state.tabId, {
    type: 'gatheros:pause-import-scroll',
    processed: importProcessedCount(state),
  }, () => { void chrome.runtime.lastError; });
}

async function handleImportBatch(bookmarks) {
  const state = importState;
  if (!state || !state.active || state.apiMode) return;
  if (state.progress && !state.progress.beforeNext()) { await endImport('stopped'); return; }
  let foundNew = false;
  let reachedLimit = false;
  const resolvedIds = [];
  if (state.mode === 'catch-up') {
    try {
      const result = await runCatchUpTransportBatch({
        state,
        entries: bookmarks,
        classify: async (batch) => (
          await requestXBookmarkStatus(batch.map((b) => b?.tweetUrl || ''))
        ).statuses,
        save: syncBookmarkToGather,
        isAccepted: isAcceptedSaveResponse,
        isNew: isNewImportedSaveResponse,
        progress: state.progress,
      });
      resolvedIds.push(...result.acceptedIds);
      foundNew = result.acceptedIds.length > 0;
      if (result.boundaryReached) {
        state.boundaryReached = true;
        reachedLimit = true;
        pauseImportScroll(state);
      }
    } catch (err) {
      if (err?.code === 'IMPORT_STOPPED') { state.active = false; await endImport('stopped'); return; }
      state.error = err;
      console.warn('[gatheros] backfill import failed:', err?.message || err);
    }
  } else {
    const result = await runFixedTransportBatch({
      state,
      entries: bookmarks,
      save: syncBookmarkToGather,
      isAccepted: isAcceptedSaveResponse,
      isNew: isNewImportedSaveResponse,
      progress: state.progress,
      onError: (err) => console.warn('[gatheros] backfill import failed:', err?.message || err),
    });
    resolvedIds.push(...result.acceptedIds);
    foundNew = result.attemptedIds.length > 0;
    reachedLimit = result.reachedLimit;
    if (reachedLimit) pauseImportScroll(state);
  }
  // Keep the seen-set current so the normal incremental poll doesn't
  // re-handle these later.
  await markBookmarksSeen(resolvedIds);
  if (!state.active || importState !== state) return;

  // Stream the running count to the tab so the import toast updates live.
  if (state.tabId != null) {
    chrome.tabs.sendMessage(state.tabId, {
      type: 'gatheros:import-progress',
      imported: state.imported,
      processed: importProcessedCount(state),
    }, () => { void chrome.runtime.lastError; });
  }

  if (foundNew) state.stagnant = 0;
  else state.stagnant += 1;

  if (state.error) {
    await endImport('error');
  } else if (state.progress && !state.progress.beforeNext()) {
    await endImport('stopped');
  } else if (reachedLimit || state.stagnant >= IMPORT_STAGNANT_BATCHES_LIMIT) {
    await endImport(reachedLimit ? 'limit' : 'bottom');
  }
}

async function endImport(_reason) {
  const run = importState;
  if (!run || !run.active) return; // guards double-end
  run.active = false;
  const { tabId, imported, watchdog } = run;
  if (watchdog) clearTimeout(watchdog);

  // Preserve existing seen-set baseline metadata. Catch-up only adds IDs
  // successfully saved before its boundary; fixed/all retain full baseline behavior.
  try {
    const { seen } = await readSeenSet();
    await writeSeenSet(seen, { baseline: true, version: CAPTURE_VERSION });
  } catch (err) {
    console.warn('[gatheros] could not set baseline after import:', err?.message || err);
  }

  const summary = { imported };
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { type: 'gatheros:stop-import', summary }, () => {
      void chrome.runtime.lastError; // tab may have closed — ignore
    });
  }
  notify(catchUpSummary(run));
  if (run.progress) {
    const terminal = (_reason === 'error' || _reason === 'timeout') ? 'failed' : (_reason === 'stopped' ? 'stopped' : 'complete');
    await run.progress.finish(terminal);
  }

  // Keep the (now-inactive) state around briefly to swallow trailing
  // cursor pages until the watcher stops scrolling + the interceptor's
  // IMPORT_MODE is back off, then fully clear.
  setTimeout(() => { if (importState === run && !run.active) importState = null; }, 8000);
}

// If the user closes the bookmarks tab mid-import, stop cleanly.
chrome.tabs.onRemoved.addListener((tabId) => {
  const run = importState;
  if (run && run.active && run.tabId === tabId) {
    if (run.watchdog) clearTimeout(run.watchdog);
    const imported = run.imported;
    run.active = false;
    if (importState === run) importState = null;
    if (run.progress) void run.progress.finish('stopped');
    if (imported > 0) notify(`Bookmark import stopped — imported ${imported} so far.`);
  }
});

// Send a single bookmark down the same /save pipeline as the click
// capture. Mirrors the payload shape the bookmark watcher uses so
// the native-host + extension-server contract stays single-source.
async function syncBookmarkToGather(b, { force = false } = {}) {
  const hasMediaList = Array.isArray(b.media) && b.media.length > 0;
  const payload = {
    type: 'save',
    pageUrl: b.tweetUrl,
    tags: ['bookmark'],
    // Explicit backfill overrides the desktop tombstone for bookmarks the
    // user previously removed. Passive sync omits this.
    ...(force ? { forceImport: true } : {}),
    tweetMeta: {
      authorName: b.authorName || '',
      authorHandle: b.authorHandle || '',
      authorAvatarUrl: b.authorAvatarUrl || '',
      caption: b.caption || '',
      // Ordered media list — carries every video on a multi-video tweet.
      media: hasMediaList ? b.media : undefined,
      imageUrls: Array.isArray(b.imageUrls) ? b.imageUrls : [],
      videoUrl: b.videoUrl || null,
      posterUrl: b.posterUrl || '',
      tweetCreatedAt: Number.isFinite(Number(b.tweetCreatedAt)) ? Number(b.tweetCreatedAt) : null,
      quoted: b.quoted || null,
    },
  };
  // Primary download follows media[0] when we have an explicit list, so
  // the on-disk file matches index 0 of the saved media.
  if (hasMediaList) {
    const first = b.media[0];
    if (first.type === 'video') {
      payload.videoUrl = first.url;
      payload.posterUrl = first.poster || '';
      payload.tweetMeta.videoUrl = first.url;
      payload.tweetMeta.posterUrl = first.poster || '';
    } else {
      payload.imageUrl = first.url;
    }
  } else if (b.videoUrl) {
    payload.videoUrl = b.videoUrl;
    payload.posterUrl = b.posterUrl;
  } else if (Array.isArray(b.imageUrls) && b.imageUrls.length > 0) {
    payload.imageUrl = b.imageUrls[0];
  } else if (!(b.caption || '').trim()) {
    // No media and no text — nothing to save. Skip silently.
    return;
  }
  // else: text-only tweet — send tweet_meta with no media; the desktop
  // renders the tweet card to an image (handled by /save's text branch).
  return chrome.runtime.sendNativeMessage(HOST_NAME, payload);
}

// ── Background polling for cross-device bookmarks ──────────────────
//
// The interceptor stores the URL of the most recent top-of-list
// /Bookmarks request plus the Authorization bearer header that
// accompanied it. On a timer (chrome.alarms) and whenever Chrome
// regains focus, the service worker re-fires that exact URL with the
// bearer + the user's CSRF token (from cookies). Response goes through
// the same extractor +
// handleBookmarkBatch path the interceptor uses for in-page
// captures, so phone-bookmarked tweets land in GatherOS without the
// user needing to visit x.com on desktop.

const STORAGE_TEMPLATE_KEY = 'gatherosBookmarkRefreshTemplate';

async function saveRefreshTemplate(url, authorization) {
  if (!url) return;
  // We don't want to overwrite a known-good authorization with null
  // — some XHR captures don't expose the header, but a previous
  // fetch capture might already have it stored.
  const { [STORAGE_TEMPLATE_KEY]: existing } = await chrome.storage.local.get(STORAGE_TEMPLATE_KEY);
  const next = {
    url,
    authorization: authorization || (existing && existing.authorization) || null,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [STORAGE_TEMPLATE_KEY]: next });
}

async function pollBookmarksRefresh() {
  if (importState && importState.active) return; // don't poll mid-import
  // Don't fetch x.com at all unless the app is open AND X sync is on —
  // no point pulling from the platform to sync into a closed app, or one
  // where the user turned X sync off in Settings.
  const status = await pingApp();
  if (!status || !status.appRunning || status.syncX === false) return;
  const { [STORAGE_TEMPLATE_KEY]: template } = await chrome.storage.local.get(STORAGE_TEMPLATE_KEY);
  if (!template || !template.url || !template.authorization) {
    // No template yet — user hasn't visited /i/bookmarks since the
    // poll alarm was registered. Quietly no-op until they do.
    return;
  }

  let csrf = null;
  let signedIn = false;
  try {
    // auth_token is the real login cookie — skip the poll when signed out
    // so we don't fire doomed requests at X every alarm/focus.
    const at = await chrome.cookies.get({ url: 'https://x.com/', name: 'auth_token' });
    signedIn = !!(at && at.value);
    const cookie = await chrome.cookies.get({ url: 'https://x.com/', name: 'ct0' });
    if (cookie && cookie.value) csrf = cookie.value;
  } catch (err) {
    console.warn('[gatheros] reading X cookies failed:', err?.message || err);
    return;
  }
  if (!signedIn || !csrf) return; // user not signed in to x.com in this Chrome profile

  let res;
  try {
    res = await fetch(template.url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        authorization: template.authorization,
        'x-csrf-token': csrf,
        // x.com checks these to recognise its own web client.
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'en',
        accept: '*/*',
      },
    });
  } catch (err) {
    // Network blip or x.com rejected the request — try again next
    // alarm. No need to clear the template; transient.
    console.warn('[gatheros] bookmark poll fetch failed:', err?.message || err);
    return;
  }
  if (!res.ok) {
    // 401 / 403 / 404: bearer or hash likely stale. Keep the
    // template so the next interceptor capture (the user's next
    // x.com visit) refreshes it; just skip this round.
    return;
  }

  let json;
  try { json = await res.json(); }
  catch { return; }

  const entries = pollExtractBookmarkEntries(json);
  if (entries.length > 0) {
    await handleBookmarkBatch(entries);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === BOOKMARK_POLL_ALARM) {
    // Re-assert the recurring schedule on every fire. If this alarm
    // was ever replaced by a one-shot, the poll would run once and
    // then never again; re-creating it here guarantees the cadence
    // persists no matter how it got triggered.
    ensureBookmarkPollAlarm();
    maybePollBookmarks();
  }
  if (alarm && alarm.name === IG_POLL_ALARM) {
    ensureIgPollAlarm();
    maybePollIgSaved();
  }
});

// Poll the moment the user returns focus to Chrome. The common flow is
// "bookmark on phone, then sit down at the computer" — this catches it
// within a second or two instead of waiting on the timer, and costs
// nothing while Chrome is unfocused. WINDOW_ID_NONE means Chrome lost
// focus (switched away); we only poll on regaining a real window. The
// throttle in maybePollBookmarks keeps rapid window-switching cheap.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  maybePollBookmarks();
  maybePollIgSaved();
});

// Background-side mirror of extractBookmarkEntries + parseTweetForBookmark
// from x-graphql-interceptor.js. Lives here so the service worker
// can parse responses from its own fetch (the MAIN-world interceptor
// is only available inside a tab). Keep these in sync with the
// interceptor's versions — same shape, same field-migration handling.
function pollExtractBookmarkEntries(json) {
  const out = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node.entryId === 'string' && node.entryId.startsWith('tweet-')) {
      const wrapped = node.content && node.content.itemContent
        && node.content.itemContent.tweet_results
        && node.content.itemContent.tweet_results.result;
      if (wrapped) {
        const parsed = pollParseTweetForBookmark(wrapped);
        if (parsed) out.push(parsed);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === '__typename') continue;
      walk(node[key]);
    }
  }
  walk(json);
  return out;
}

// Minimal author + caption + photo extraction for a nested tweet (the
// quoted tweet inside a quote tweet). Mirrors the interceptor's
// extractTweetCore so cross-device sync captures quotes too.
function pollExtractTweetCore(result) {
  if (!result || typeof result !== 'object') return null;
  const t = result.tweet || result;
  const legacy = t.legacy;
  if (!legacy || !legacy.id_str) return null;
  const userResult = t.core && t.core.user_results && t.core.user_results.result;
  const userCore = (userResult && userResult.core) || {};
  const userLegacy = (userResult && userResult.legacy) || {};
  const screenName = userCore.screen_name || userLegacy.screen_name || '';
  const displayName = userCore.name || userLegacy.name || '';
  const avatarUrl = (userResult && userResult.avatar && userResult.avatar.image_url)
    || userLegacy.profile_image_url_https || '';
  const mediaList = (legacy.extended_entities && legacy.extended_entities.media)
    || (legacy.entities && legacy.entities.media) || [];
  const imageUrls = [];
  for (const m of mediaList) {
    if (m && m.type === 'photo' && m.media_url_https) {
      imageUrls.push(`${m.media_url_https}?format=jpg&name=large`);
    }
  }
  return {
    authorName: displayName,
    authorHandle: screenName ? `@${screenName}` : '',
    authorAvatarUrl: avatarUrl,
    caption: legacy.full_text || '',
    imageUrls,
    tweetCreatedAt: Number.isFinite(Date.parse(legacy.created_at || ''))
      ? Date.parse(legacy.created_at)
      : null,
  };
}

// Background mirror of the interceptor's buildMediaList — an ordered
// [{type:'image'|'video', url, poster}] list off a tweet's legacy media.
function pollBuildMediaList(legacy) {
  const mediaList = (legacy.extended_entities && legacy.extended_entities.media)
    || (legacy.entities && legacy.entities.media)
    || [];
  const out = [];
  for (const m of mediaList) {
    if (!m) continue;
    if (m.type === 'photo' && m.media_url_https) {
      out.push({ type: 'image', url: `${m.media_url_https}?format=jpg&name=large` });
    } else if (
      (m.type === 'video' || m.type === 'animated_gif')
      && m.video_info && Array.isArray(m.video_info.variants)
    ) {
      let best = null;
      for (const v of m.video_info.variants) {
        if (!v || v.content_type !== 'video/mp4' || !v.url) continue;
        const br = typeof v.bitrate === 'number' ? v.bitrate : 0;
        if (!best || br > best.bitrate) best = { url: v.url, bitrate: br };
      }
      if (best) out.push({ type: 'video', url: best.url, poster: m.media_url_https || '' });
    }
  }
  return out;
}

function pollParseTweetForBookmark(result) {
  const t = result.tweet || result;
  const legacy = t.legacy;
  if (!legacy || !legacy.id_str) return null;
  const userResult = t.core && t.core.user_results && t.core.user_results.result;
  if (!userResult) return null;
  const userCore = userResult.core || {};
  const userLegacy = userResult.legacy || {};
  const screenName = userCore.screen_name || userLegacy.screen_name;
  const displayName = userCore.name || userLegacy.name || '';
  const avatarUrl =
    (userResult.avatar && userResult.avatar.image_url)
    || userLegacy.profile_image_url_https
    || '';
  if (!screenName) return null;

  const tweetId = legacy.id_str;
  const tweetUrl = `https://x.com/${screenName}/status/${tweetId}`;
  const mediaList = (legacy.extended_entities && legacy.extended_entities.media)
    || (legacy.entities && legacy.entities.media)
    || [];
  const imageUrls = [];
  let videoUrl = null;
  let posterUrl = '';
  for (const m of mediaList) {
    if (!m) continue;
    if (m.type === 'photo' && m.media_url_https) {
      imageUrls.push(`${m.media_url_https}?format=jpg&name=large`);
    } else if (
      (m.type === 'video' || m.type === 'animated_gif')
      && m.video_info && Array.isArray(m.video_info.variants)
    ) {
      let best = null;
      for (const v of m.video_info.variants) {
        if (!v || v.content_type !== 'video/mp4' || !v.url) continue;
        const br = typeof v.bitrate === 'number' ? v.bitrate : 0;
        if (!best || br > best.bitrate) best = { url: v.url, bitrate: br };
      }
      if (best && !videoUrl) {
        videoUrl = best.url;
        posterUrl = m.media_url_https || '';
      }
    }
  }

  // Allow text-only tweets through (caption but no media) — the desktop
  // renders the tweet card to an image. Only bail when there's nothing
  // at all: no media and no text.
  if (imageUrls.length === 0 && !videoUrl && !(legacy.full_text || '').trim()) return null;

  return {
    tweetId,
    tweetUrl,
    authorName: displayName,
    authorHandle: `@${screenName}`,
    authorAvatarUrl: avatarUrl,
    caption: legacy.full_text || '',
    imageUrls,
    videoUrl,
    posterUrl,
    tweetCreatedAt: Number.isFinite(Date.parse(legacy.created_at || ''))
      ? Date.parse(legacy.created_at)
      : null,
    media: pollBuildMediaList(legacy),
    quoted: pollExtractTweetCore(t.quoted_status_result && t.quoted_status_result.result),
  };
}

// ── Instagram saved-post sync ──────────────────────────────────────
//
// The Instagram analogue of the X bookmark flow. Two paths:
//   • Passive: while the user browses instagram.com, the interceptor
//     surfaces the top of their saved feed; new posts (past a silent
//     baseline) sync to the desktop tagged 'instagram:save'.
//   • Backfill: "Import saved" from the panel opens Instagram, scrolls
//     the saved page, and imports up to a chosen count.
//
// Deliberately NO background poll (unlike X): automated/background
// requests to Instagram endpoints are exactly what trips Meta's abuse
// detection, so all capture happens only while the user is actively on
// instagram.com. Dedup + tombstones live desktop-side (content_hash +
// the source tombstone table), same as X.

const IG_STORAGE_SEEN_KEY = 'gatherosIgSavedSeen';
const IG_STORAGE_BASELINE_KEY = 'gatherosIgSavedBaselineEstablished';
const IG_STORAGE_VERSION_KEY = 'gatherosIgSavedCaptureVersion';
const IG_CAPTURE_VERSION = 1;
const IG_STORAGE_IMPORT_DISABLED_KEY = 'gatherosIgImportDisabled';
// Storage flag the watcher reads on each instagram.com page load to
// self-start its scroll after navigating to the saved page (the start
// can't be a one-off message because resolving + navigating to the
// saved tab reloads the content scripts).
const IG_STORAGE_IMPORT_ACTIVE_KEY = 'gatherosIgImportActive';
const IG_IMPORT_STAGNANT_BATCHES_LIMIT = 4;
const IG_IMPORT_WATCHDOG_MS = 6 * 60 * 1000;

let igImportState = null;

async function readIgSeenSet() {
  const data = await chrome.storage.local.get([
    IG_STORAGE_SEEN_KEY, IG_STORAGE_BASELINE_KEY, IG_STORAGE_VERSION_KEY,
  ]);
  const seen = new Set(Array.isArray(data[IG_STORAGE_SEEN_KEY]) ? data[IG_STORAGE_SEEN_KEY] : []);
  const baseline = !!data[IG_STORAGE_BASELINE_KEY];
  const version = Number(data[IG_STORAGE_VERSION_KEY]) || 0;
  return { seen, baseline, version };
}

async function writeIgSeenSet(seen, { baseline, version } = {}) {
  const update = { [IG_STORAGE_SEEN_KEY]: Array.from(seen) };
  if (baseline !== undefined) update[IG_STORAGE_BASELINE_KEY] = !!baseline;
  if (version !== undefined) update[IG_STORAGE_VERSION_KEY] = version;
  await chrome.storage.local.set(update);
}

async function markIgSeen(ids) {
  if (!ids || !ids.length) return;
  const { seen } = await readIgSeenSet();
  let changed = false;
  for (const id of ids) {
    if (id && !seen.has(id)) { seen.add(id); changed = true; }
  }
  if (changed) await writeIgSeenSet(seen);
}

async function handleIgSavedBatch(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return;

  // A backfill owns the import: the API-driven import drives itself, so
  // ignore passive batches; the legacy scroll import routes through
  // handleIgImportBatch.
  if (igImportState) {
    if (igImportState.apiMode) return;
    if (igImportState.active) await handleIgImportBatch(posts);
    return;
  }

  const { seen, baseline, version } = await readIgSeenSet();

  if (!baseline || version !== IG_CAPTURE_VERSION) {
    // First batch ever (existing archive) — record silently so the
    // backlog doesn't flood the library; only posts saved from here on
    // count as new.
    for (const p of posts) { if (p && p.postId) seen.add(p.postId); }
    await writeIgSeenSet(seen, { baseline: true, version: IG_CAPTURE_VERSION });
    return;
  }

  const toImport = posts.filter((p) => p && p.postId && !seen.has(p.postId));
  for (const p of toImport) {
    try {
      const response = await syncSavedPostToGather(p);
      if (isAcceptedSaveResponse(response)) {
        seen.add(p.postId);
      } else {
        console.warn('[gatheros] instagram saved sync rejected:', response?.error || 'save not accepted');
      }
    } catch (err) {
      console.warn('[gatheros] instagram saved sync failed:', err?.message || err);
    }
  }
  await writeIgSeenSet(seen);
}

function isSavedPageUrl(url) {
  return typeof url === 'string'
    && /^https:\/\/(www\.)?instagram\.com\/.*\/saved(\/|$)/i.test(url);
}

async function handleImportSaved(msg, sender) {
  const reservation = reserveSocialImport('instagram');
  if (!reservation) {
    notify('A saved-post import is already running.');
    return { ok: false, busy: true };
  }
  const { [IG_STORAGE_IMPORT_DISABLED_KEY]: disabled } =
    await chrome.storage.local.get(IG_STORAGE_IMPORT_DISABLED_KEY);
  if (disabled) {
    releaseSocialImport('instagram', reservation);
    notify('Saved-post import is temporarily unavailable.');
    return { ok: false, disabled: true };
  }
  if (!(await igSignedIn())) {
    releaseSocialImport('instagram', reservation);
    return { ok: false, needsSignIn: true, platform: 'instagram' };
  }

  const status = await pingApp();
  if (!status || status.hostMissing || !status.appRunning) {
    releaseSocialImport('instagram', reservation);
    notify('Open GatherOS first, then run Import saved.');
    return { ok: false, appClosed: true };
  }

  const n = Number(msg && msg.limit);
  const limit = Number.isFinite(n) && n > 0 ? n : Infinity;

  // Import directly from Instagram's saved API in the background — no tab,
  // no navigation, no username (the saved feed is session-scoped). Same
  // request the mobile-sync poll replays, just paginated + forced. Runs
  // async and reports progress via notifications.
  runIgApiImport(limit, reservation);
  return { ok: true };
}

// Paginate /api/v1/feed/saved/posts/ from the worker, following
// next_max_id, importing each saved post (force = overrides tombstones)
// up to `limit`. Uses the captured request template (URL + headers) plus
// a fresh csrftoken cookie; gently paced for Meta account safety.
function igWithMaxId(baseUrl, maxId) {
  try {
    const u = new URL(baseUrl);
    if (maxId) u.searchParams.set('max_id', maxId);
    else u.searchParams.delete('max_id');
    return u.toString();
  } catch {
    if (!maxId) return baseUrl;
    return baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'max_id=' + encodeURIComponent(maxId);
  }
}

async function runIgApiImport(limit, reservation = null) {
  // Signed-in check. Instagram sets `csrftoken` even for logged-out
  // visitors, so it's not proof of a session — the `sessionid` cookie is
  // the real auth cookie. Check it up front so a signed-out user gets a
  // clear "sign in" message instead of a misleading "couldn't read your
  // feed" after a doomed request (and we don't flip the sync baseline).
  let csrf = null;
  let signedIn = false;
  try {
    const sid = await chrome.cookies.get({ url: 'https://www.instagram.com/', name: 'sessionid' });
    signedIn = !!(sid && sid.value);
    const c = await chrome.cookies.get({ url: 'https://www.instagram.com/', name: 'csrftoken' });
    if (c && c.value) csrf = c.value;
  } catch { /* ignore */ }
  if (!signedIn || !csrf) {
    releaseSocialImport('instagram', reservation);
    notify('Sign in to Instagram in this browser, then run Import saved.');
    return;
  }

  const { [IG_STORAGE_TEMPLATE_KEY]: template } = await chrome.storage.local.get(IG_STORAGE_TEMPLATE_KEY);
  const baseUrl = (template && template.url) || IG_SAVED_FEED_URL;
  const progress = createImportProgress('instagram', Number.isFinite(limit) ? 'fixed' : 'all', Number.isFinite(limit) ? limit : null);
  await progress.start({
    platform: 'instagram', mode: Number.isFinite(limit) ? 'fixed' : 'all',
    target: Number.isFinite(limit) ? limit : null,
  });
  if (!progress.beforeNext()) { await progress.finish('stopped'); return; }

  const headers = { ...((template && template.headers) || {}), 'x-csrftoken': csrf, accept: '*/*' };
  if (!headers['x-ig-app-id']) headers['x-ig-app-id'] = IG_WEB_APP_ID;

  const state = {
    active: true,
    apiMode: true,
    limit,
    imported: 0,
    known: 0,
    failed: 0,
    processed: 0,
    seenIds: new Set(),
    progress,
    reservation,
  };
  igImportState = state;
  notify('Importing saved posts from Instagram…');

  const PAGE_DELAY_MS = 1400; // gentle pacing — looks like a slow scroll
  const MAX_PAGES = 300;
  let maxId = null;
  let pages = 0;
  let authFailedFirstPage = false;
  try {
    while (igImportState && igImportState.active
      && igImportState.processed < limit && pages < MAX_PAGES) {
      if (!state.progress.beforeNext()) { state.active = false; break; }
      await state.progress.update({ stage: 'scanning', scanned: state.processed, saved: state.imported, known: state.known, failed: state.failed });
      let res;
      try {
        res = await fetch(igWithMaxId(baseUrl, maxId), {
          method: 'GET', credentials: 'include', headers,
        });
      } catch (err) {
        state.error = err;
        console.warn('[gatheros] IG import fetch failed:', err?.message || err);
        break;
      }
      if (!res.ok) { authFailedFirstPage = pages === 0; state.error = new Error(`Instagram request failed (${res.status})`); break; }
      let json;
      try { json = await res.json(); } catch (err) { state.error = err; break; }

      const posts = pollExtractSavedPosts(json);
      for (const p of posts) {
        if (igImportState.processed >= limit) break;
        if (!state.progress.beforeNext()) { state.active = false; break; }
        igImportState.processed += 1;
        try {
          const resp = await syncSavedPostToGather(p, { force: true });
          if (isNewImportedSaveResponse(resp)) state.imported += 1;
          else if (isAcceptedSaveResponse(resp)) state.known += 1;
          if (isAcceptedSaveResponse(resp)) state.seenIds.add(p.postId);
        } catch (err) {
          state.failed += 1;
          console.warn('[gatheros] IG import save failed:', err?.message || err);
        }
        await state.progress.update({ stage: 'saving', scanned: state.processed, saved: state.imported, known: state.known, failed: state.failed });
      }
      pages += 1;
      if (!json.more_available || !json.next_max_id) break;
      maxId = json.next_max_id;
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      if (!state.progress.beforeNext()) { state.active = false; break; }
    }
  } finally {
    const imported = state.imported;
    igImportState = null;
    // Establish the baseline so passive sync only imports newer posts.
    try {
      const { seen } = await readIgSeenSet();
      for (const id of state.seenIds) seen.add(id);
      await writeIgSeenSet(seen, { baseline: true, version: IG_CAPTURE_VERSION });
    } catch { /* ignore */ }
    if (state.error) await state.progress.finish('failed', state.error?.message || null);
    else if (!state.active) await state.progress.finish('stopped');
    else await state.progress.finish('complete');
    if (authFailedFirstPage) {
      notify('Could not read your Instagram saved feed. Open your Saved page once, then try again.');
    } else {
      notify(imported > 0
        ? `Imported ${imported} saved post${imported === 1 ? '' : 's'} from Instagram.`
        : 'No new saved posts to import.');
    }
  }
}

async function handleIgImportBatch(posts) {
  let foundNew = false;
  let reachedLimit = false;
  const resolvedIds = [];
  if (igImportState.progress && !igImportState.progress.beforeNext()) { await endIgImport('stopped'); return; }
  for (const p of posts) {
    if (!p || !p.postId) continue;
    if (igImportState.progress && !igImportState.progress.beforeNext()) { await endIgImport('stopped'); return; }
    if (igImportState.processed.has(p.postId)) continue;
    igImportState.processed.add(p.postId);
    foundNew = true;
    try {
      const resp = await syncSavedPostToGather(p, { force: true });
      if (isNewImportedSaveResponse(resp)) igImportState.imported += 1;
      else if (isAcceptedSaveResponse(resp)) igImportState.known = (igImportState.known || 0) + 1;
      if (isAcceptedSaveResponse(resp)) resolvedIds.push(p.postId);
    } catch (err) {
      igImportState.failed = (igImportState.failed || 0) + 1;
      console.warn('[gatheros] instagram backfill failed:', err?.message || err);
    }
    if (igImportState.progress) {
      await igImportState.progress.update({
        stage: 'saving', scanned: igImportState.processed.size,
        saved: igImportState.imported, known: igImportState.known || 0, failed: igImportState.failed || 0,
      });
    }
    if (igImportState.processed.size >= igImportState.limit) { reachedLimit = true; break; }
  }
  await markIgSeen(resolvedIds);

  if (igImportState.tabId != null) {
    chrome.tabs.sendMessage(igImportState.tabId, {
      type: 'gatheros:ig-import-progress',
      imported: igImportState.imported,
      processed: igImportState.processed.size,
    }, () => { void chrome.runtime.lastError; });
  }

  if (foundNew) igImportState.stagnant = 0;
  else igImportState.stagnant += 1;

  if (reachedLimit || igImportState.stagnant >= IG_IMPORT_STAGNANT_BATCHES_LIMIT) {
    await endIgImport(reachedLimit ? 'limit' : 'bottom');
  }
}

async function endIgImport(_reason) {
  const run = igImportState;
  if (!run || !run.active) return;
  run.active = false;
  const { tabId, imported, watchdog } = run;
  if (watchdog) clearTimeout(watchdog);
  await chrome.storage.local.set({ [IG_STORAGE_IMPORT_ACTIVE_KEY]: false });

  // The backfill establishes the baseline so passive capture resumes
  // importing only genuinely-new saved posts.
  try {
    const { seen } = await readIgSeenSet();
    await writeIgSeenSet(seen, { baseline: true, version: IG_CAPTURE_VERSION });
  } catch (err) {
    console.warn('[gatheros] could not set IG baseline after import:', err?.message || err);
  }

  const summary = { imported };
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { type: 'gatheros:ig-stop-import', summary }, () => {
      void chrome.runtime.lastError;
    });
  }
  notify(imported > 0
    ? `Imported ${imported} saved post${imported === 1 ? '' : 's'} from Instagram.`
    : 'No new saved posts to import.');
  if (run.progress) {
    const terminal = (_reason === 'error' || _reason === 'timeout') ? 'failed' : (_reason === 'stopped' ? 'stopped' : 'complete');
    await run.progress.finish(terminal);
  }

  setTimeout(() => { if (igImportState === run && !run.active) igImportState = null; }, 8000);
}

// Stop cleanly if the user closes the saved tab mid-import.
chrome.tabs.onRemoved.addListener((tabId) => {
  const run = igImportState;
  if (run && run.active && run.tabId === tabId) {
    if (run.watchdog) clearTimeout(run.watchdog);
    const imported = run.imported;
    run.active = false;
    if (igImportState === run) igImportState = null;
    if (run.progress) void run.progress.finish('stopped');
    chrome.storage.local.set({ [IG_STORAGE_IMPORT_ACTIVE_KEY]: false });
    if (imported > 0) notify(`Saved-post import stopped — imported ${imported} so far.`);
  }
});

// Send a single saved post down the same /save pipeline as X, tagged
// 'instagram:save' and carrying source:'instagram'. Carousels arrive as
// one post with every still in imageUrls (paged in the UI by the same
// tweetMediaItems helper); reels route through the video branch.
async function syncSavedPostToGather(p, { force = false } = {}) {
  const payload = {
    type: 'save',
    source: 'instagram',
    pageUrl: p.tweetUrl, // IG permalink — shares the X field name through the relay
    tags: ['instagram'],
    ...(force ? { forceImport: true } : {}),
    tweetMeta: {
      authorName: p.authorName || '',
      authorHandle: p.authorHandle || '',
      authorAvatarUrl: p.authorAvatarUrl || '',
      caption: p.caption || '',
      // Ordered media list — lets the renderer page through and play
      // multiple videos in one save (Instagram carousels).
      media: Array.isArray(p.media) ? p.media : undefined,
      imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
      videoUrl: p.videoUrl || null,
      posterUrl: p.posterUrl || '',
    },
  };
  if (p.videoUrl) {
    payload.videoUrl = p.videoUrl;
    payload.posterUrl = p.posterUrl;
  } else if (Array.isArray(p.imageUrls) && p.imageUrls.length > 0) {
    payload.imageUrl = p.imageUrls[0];
  } else if (!(p.caption || '').trim()) {
    return; // nothing to save
  }
  return chrome.runtime.sendNativeMessage(HOST_NAME, payload);
}

// ── Instagram background poll (mobile-save sync, X-style) ──────────
//
// Instagram saved posts are server-side, and desktop Chrome holds the
// user's instagram.com session — so we re-fire the captured top-of-saved
// request on a timer + on window focus using their cookies + a fresh
// csrftoken, picking up posts saved on the phone without a Saved-page
// visit. Gentler cadence than X (Meta is stricter about automation) and
// self-healing: a stale template/claim just refreshes on the next real
// Saved-page visit. Only the top of the feed is replayed (one request).

const IG_POLL_ALARM = 'gatherosIgSavedPoll';
const IG_POLL_PERIOD_MINUTES = 5;
const IG_POLL_THROTTLE_MS = 90 * 1000;
const IG_STORAGE_LAST_POLL_KEY = 'gatherosIgLastPollAt';
const IG_STORAGE_TEMPLATE_KEY = 'gatherosIgSavedRefreshTemplate';
const IG_STORAGE_POLL_DISABLED_KEY = 'gatherosIgPollDisabled';
// Last-seen saved (all-posts) page URL — Instagram has no username-less
// saved route, so we remember the user's and open it directly on import.
const IG_STORAGE_SAVED_URL_KEY = 'gatherosIgSavedPageUrl';
// The Instagram web client's app id. Captured from the live request when
// possible; this constant is the fallback so a replay still authenticates.
const IG_WEB_APP_ID = '936619743392459';
// Default saved-feed endpoint. The poll falls back to this when no replay
// template has been captured yet (no Saved-page visit since install), so
// mobile saves sync on their own — the manual import uses the same URL.
const IG_SAVED_FEED_URL = 'https://www.instagram.com/api/v1/feed/saved/posts/?count=12';

function ensureIgPollAlarm() {
  chrome.alarms.create(IG_POLL_ALARM, { periodInMinutes: IG_POLL_PERIOD_MINUTES });
}

async function maybePollIgSaved() {
  const data = await chrome.storage.local.get([IG_STORAGE_POLL_DISABLED_KEY, IG_STORAGE_LAST_POLL_KEY]);
  if (data[IG_STORAGE_POLL_DISABLED_KEY]) return;
  const now = Date.now();
  if (now - (data[IG_STORAGE_LAST_POLL_KEY] || 0) < IG_POLL_THROTTLE_MS) return;
  await chrome.storage.local.set({ [IG_STORAGE_LAST_POLL_KEY]: now });
  await pollIgSavedRefresh();
}

async function saveIgRefreshTemplate(url, headers) {
  if (!url) return;
  const { [IG_STORAGE_TEMPLATE_KEY]: existing } = await chrome.storage.local.get(IG_STORAGE_TEMPLATE_KEY);
  const next = {
    url,
    // Keep any previously-captured headers if this capture missed some.
    headers: { ...((existing && existing.headers) || {}), ...((headers && typeof headers === 'object') ? headers : {}) },
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [IG_STORAGE_TEMPLATE_KEY]: next });
}

async function pollIgSavedRefresh() {
  if (igImportState && igImportState.active) return; // don't poll mid-backfill
  // Don't touch Instagram unless the app is open AND Instagram sync is on
  // (Settings). This is the account-safety win: no background requests to
  // Instagram once the user turns sync off.
  const status = await pingApp();
  if (!status || !status.appRunning || status.syncInstagram === false) return;
  // A captured replay template (from a Saved-page visit) is preferred — it
  // carries the exact headers Instagram's web client sent. But it's no
  // longer required: fall back to the default saved-feed endpoint + app id
  // so a phone save syncs without ever opening Saved on desktop.
  const { [IG_STORAGE_TEMPLATE_KEY]: template } = await chrome.storage.local.get(IG_STORAGE_TEMPLATE_KEY);
  const url = (template && template.url) || IG_SAVED_FEED_URL;

  let csrf = null;
  let signedIn = false;
  try {
    // sessionid is the real auth cookie (csrftoken is set even when
    // logged out) — skip the poll entirely when signed out so we don't
    // fire doomed 401 requests at Instagram on every alarm/focus.
    const sid = await chrome.cookies.get({ url: 'https://www.instagram.com/', name: 'sessionid' });
    signedIn = !!(sid && sid.value);
    const cookie = await chrome.cookies.get({ url: 'https://www.instagram.com/', name: 'csrftoken' });
    if (cookie && cookie.value) csrf = cookie.value;
  } catch (err) {
    console.warn('[gatheros] reading IG cookies failed:', err?.message || err);
    return;
  }
  if (!signedIn || !csrf) return; // not signed in to instagram.com in this Chrome profile

  const headers = { ...((template && template.headers) || {}), 'x-csrftoken': csrf, accept: '*/*' };
  if (!headers['x-ig-app-id']) headers['x-ig-app-id'] = IG_WEB_APP_ID;

  let res;
  try {
    res = await fetch(url, { method: 'GET', credentials: 'include', headers });
  } catch (err) {
    console.warn('[gatheros] IG saved poll fetch failed:', err?.message || err);
    return;
  }
  // 4xx/claim drift: keep the template; the next Saved visit refreshes it.
  if (!res.ok) return;

  let json;
  try { json = await res.json(); } catch { return; }

  const posts = pollExtractSavedPosts(json);
  if (posts.length > 0) await handleIgSavedBatch(posts);
}

// Background mirror of the interceptor's saved-post parser (the MAIN-world
// script isn't reachable from the worker). Keep in sync with
// content/ig-interceptor.js — same shapes, same field handling.
function igPollBestImageUrl(node) {
  const cands = node && node.image_versions2 && Array.isArray(node.image_versions2.candidates)
    ? node.image_versions2.candidates : null;
  if (cands && cands.length) {
    let best = cands[0];
    for (const c of cands) if (c && typeof c.width === 'number' && c.width > (best.width || 0)) best = c;
    if (best && best.url) return best.url;
  }
  return node.display_url || node.thumbnail_url || node.thumbnail_src || '';
}
function igPollBestVideoUrl(node) {
  if (Array.isArray(node.video_versions) && node.video_versions.length) {
    let best = node.video_versions[0];
    for (const v of node.video_versions) if (v && typeof v.width === 'number' && v.width > (best.width || 0)) best = v;
    if (best && best.url) return best.url;
  }
  return node.video_url || '';
}
function igPollCarouselChildren(node) {
  if (Array.isArray(node.carousel_media)) return node.carousel_media;
  const edges = node.edge_sidecar_to_children && Array.isArray(node.edge_sidecar_to_children.edges)
    ? node.edge_sidecar_to_children.edges : null;
  if (edges) return edges.map((e) => e && e.node).filter(Boolean);
  return null;
}
function igPollIsVideoNode(node) {
  return node.media_type === 2 || node.is_video === true
    || (Array.isArray(node.video_versions) && node.video_versions.length > 0);
}
function igPollCaptionOf(node) {
  if (node.caption && typeof node.caption.text === 'string') return node.caption.text;
  if (typeof node.caption === 'string') return node.caption;
  const edges = node.edge_media_to_caption && Array.isArray(node.edge_media_to_caption.edges)
    ? node.edge_media_to_caption.edges : null;
  if (edges && edges[0] && edges[0].node && typeof edges[0].node.text === 'string') return edges[0].node.text;
  return '';
}
function igPollOwnerOf(node) {
  const u = node.user || node.owner || {};
  return {
    username: u.username || '',
    fullName: u.full_name || u.fullName || '',
    avatarUrl: u.profile_pic_url || u.profile_pic_url_hd || '',
  };
}
function igPollMediaItemOf(node) {
  if (igPollIsVideoNode(node)) {
    return { type: 'video', url: igPollBestVideoUrl(node) || '', poster: igPollBestImageUrl(node) || '' };
  }
  return { type: 'image', url: igPollBestImageUrl(node) || '' };
}
function igPollLooksLikeMedia(node) {
  if (!node || typeof node !== 'object') return false;
  const hasCode = typeof node.code === 'string' || typeof node.shortcode === 'string';
  const hasMedia = !!node.image_versions2 || !!node.display_url
    || Array.isArray(node.carousel_media) || !!node.edge_sidecar_to_children
    || Array.isArray(node.video_versions) || typeof node.video_url === 'string';
  return hasCode && hasMedia;
}
function igPollParseSavedMedia(node) {
  const shortcode = node.code || node.shortcode;
  const postId = node.pk || node.id || shortcode;
  if (!shortcode && !postId) return null;
  const owner = igPollOwnerOf(node);
  const permalink = `https://www.instagram.com/p/${shortcode || postId}/`;
  const children = igPollCarouselChildren(node);
  let media = [];
  if (children && children.length) media = children.map(igPollMediaItemOf).filter((m) => m.url);
  else { const item = igPollMediaItemOf(node); if (item.url) media = [item]; }
  const imageUrls = media.map((m) => (m.type === 'video' ? m.poster : m.url)).filter(Boolean);
  let videoUrl = null;
  let posterUrl = '';
  if (media[0] && media[0].type === 'video') { videoUrl = media[0].url || null; posterUrl = media[0].poster || ''; }
  const caption = igPollCaptionOf(node);
  if (media.length === 0 && !caption.trim()) return null;
  return {
    postId: String(postId),
    shortcode: shortcode || '',
    tweetUrl: permalink,
    authorName: owner.fullName,
    authorHandle: owner.username ? `@${owner.username}` : '',
    authorAvatarUrl: owner.avatarUrl,
    caption,
    media,
    imageUrls,
    videoUrl,
    posterUrl,
    isCarousel: !!(children && children.length),
  };
}
function pollExtractSavedPosts(json) {
  const out = [];
  const seen = new Set();
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const c of node) walk(c); return; }
    if (igPollLooksLikeMedia(node)) {
      const parsed = igPollParseSavedMedia(node);
      if (parsed && !seen.has(parsed.postId)) { seen.add(parsed.postId); out.push(parsed); }
      return;
    }
    for (const key of Object.keys(node)) { if (key === '__typename') continue; walk(node[key]); }
  }
  walk(json);
  return out;
}

function notify(message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon.png',
      title: 'GatherOS',
      message,
    });
  } catch {
    // Notifications can fail silently on some platforms; nothing
    // else to fall back on from a service worker.
  }
}

// ── Panel-driven browser capture + URL save ────────────────────────
//
// The injected in-page panel (panel.js) drives these. Browser-page and
// area captures are taken as JPEG and shipped to the desktop app as a
// data:image URL through the same native-message 'save' path the
// right-click flow uses. JPEG (+ a downscale fallback) keeps the
// payload under the native-messaging 1 MB cap that a full PNG would
// blow past. Area cropping happens here in the worker via
// OffscreenCanvas. "Save URL" sends only pageUrl, which the app
// screenshots into a kind='url' save.

const NATIVE_MSG_LIMIT = 1024 * 1024;            // mirrors native-host MAX_MSG
const SAFE_CAPTURE_BYTES = NATIVE_MSG_LIMIT - 16 * 1024; // headroom for JSON envelope
const CAPTURE_JPEG_QUALITY = 80;                 // 0–100 for captureVisibleTab
const CAPTURE_MAX_EDGE = 2000;                   // downscale ceiling so retina shots fit the cap

async function captureActivePage({ windowId, pageUrl, pageTitle }) {
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: 'jpeg',
      quality: CAPTURE_JPEG_QUALITY,
    });
  } catch (err) {
    notify(captureErrorText(err));
    return;
  }
  dataUrl = await shrinkDataUrlIfNeeded(dataUrl);
  await finishCaptureSave(dataUrl, pageUrl, pageTitle);
}

async function captureActiveArea({ tabId, windowId, pageUrl, pageTitle }) {
  let rect = null;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: areaSelectOverlay,
    });
    rect = res?.result || null;
  } catch (err) {
    notify(captureErrorText(err));
    return;
  }
  if (!rect) return; // user pressed Esc or made a tiny drag — stay silent

  let shotUrl;
  try {
    shotUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 92 });
  } catch (err) {
    notify(captureErrorText(err));
    return;
  }

  // Crop the captured viewport down to the selected rect. The rect is
  // in CSS px; the screenshot is in device px, so scale by dpr.
  let bmp;
  try {
    bmp = await createImageBitmap(await (await fetch(shotUrl)).blob());
  } catch (err) {
    notify(`Capture failed — ${err?.message || err}`);
    return;
  }
  const dpr = rect.dpr || 1;
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.min(bmp.width - sx, Math.round(rect.w * dpr));
  const sh = Math.min(bmp.height - sy, Math.round(rect.h * dpr));
  if (sw < 1 || sh < 1) { bmp.close?.(); return; }

  const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(sw, sh));
  const cw = Math.max(1, Math.round(sw * scale));
  const ch = Math.max(1, Math.round(sh * scale));
  const canvas = new OffscreenCanvas(cw, ch);
  canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, cw, ch);
  bmp.close?.();

  let dataUrl = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
  dataUrl = await shrinkDataUrlIfNeeded(dataUrl);
  await finishCaptureSave(dataUrl, pageUrl, pageTitle);
}

// Full scrollable page: captureVisibleTab only grabs the viewport, so
// we scroll the page one viewport at a time, shoot each, and stitch
// the frames onto one tall OffscreenCanvas. captureVisibleTab is rate-
// limited (~2/sec), hence the throttle + retry. The stitched image is
// downscaled to stay under the native-messaging cap. Known limits:
// sticky/fixed headers repeat across frames, and lazy-loaded content
// may not have rendered — acceptable for a v1 snapshot.
const FULLPAGE_MAX_CANVAS_PX = 16384; // Chrome canvas dimension ceiling
const FULLPAGE_MAX_EDGE = 4000;       // allow a taller result than viewport shots

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureVisibleTabThrottled(windowId) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 });
    } catch (err) {
      const m = err?.message || String(err);
      if (attempt < 3 && /MAX_CAPTURE|too many|exceeded|quota|rate/i.test(m)) {
        await sleep(650);
        continue;
      }
      throw err;
    }
  }
}

async function captureFullPage({ tabId, windowId, pageUrl, pageTitle }) {
  let metrics;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: fullPagePrepare });
    metrics = res?.result || null;
  } catch (err) {
    notify(captureErrorText(err));
    return;
  }
  if (!metrics || !metrics.totalH) { notify("This page can't be captured."); return; }

  const { dpr, viewW, viewH, totalH, originalY } = metrics;
  const shots = [];
  try {
    for (let y = 0; y < totalH; y += viewH) {
      const top = Math.min(y, Math.max(0, totalH - viewH)); // last frame aligns to the bottom
      await chrome.scripting.executeScript({ target: { tabId }, func: fullPageScrollTo, args: [top] });
      await sleep(230); // paint + honor captureVisibleTab's rate limit
      shots.push({ top, url: await captureVisibleTabThrottled(windowId) });
      if (top >= totalH - viewH) break;
    }
  } catch (err) {
    await restoreScroll(tabId, originalY);
    notify(captureErrorText(err));
    return;
  }
  await restoreScroll(tabId, originalY);

  // Stitch. Scale the canvas down if the page is taller than Chrome's
  // canvas ceiling so the whole page still fits in one image.
  const fullW = Math.round(viewW * dpr);
  const fullH = Math.round(totalH * dpr);
  const renderScale = Math.min(1, FULLPAGE_MAX_CANVAS_PX / Math.max(fullW, fullH));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(fullW * renderScale)),
                                     Math.max(1, Math.round(fullH * renderScale)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const { top, url } of shots) {
    let bmp;
    try { bmp = await createImageBitmap(await (await fetch(url)).blob()); }
    catch { continue; }
    ctx.drawImage(
      bmp,
      0, Math.round(top * dpr * renderScale),
      bmp.width * renderScale, bmp.height * renderScale,
    );
    bmp.close?.();
  }

  let dataUrl = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 }));
  dataUrl = await shrinkDataUrlIfNeeded(dataUrl, FULLPAGE_MAX_EDGE);
  await finishCaptureSave(dataUrl, pageUrl, pageTitle);
}

async function restoreScroll(tabId, y) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: fullPageScrollTo, args: [y] });
  } catch { /* page may have navigated away — nothing to restore */ }
}

// Injected: measure the page and switch off smooth-scroll so the
// per-frame scrolls land instantly. Returns null if unmeasurable.
function fullPagePrepare() {
  const de = document.documentElement;
  if (!de) return null;
  de.style.scrollBehavior = 'auto';
  const totalH = Math.max(
    de.scrollHeight || 0,
    document.body ? document.body.scrollHeight : 0,
    de.clientHeight || 0,
  );
  return {
    dpr: window.devicePixelRatio || 1,
    viewW: window.innerWidth,
    viewH: window.innerHeight,
    totalH,
    originalY: window.scrollY || de.scrollTop || 0,
  };
}

function fullPageScrollTo(top) {
  window.scrollTo(0, top);
}

async function savePageUrl({ pageUrl, pageTitle }) {
  if (!pageUrl) { notify('No page URL to save.'); return; }
  try {
    const resp = await chrome.runtime.sendNativeMessage(HOST_NAME, {
      type: 'save',
      pageUrl,
      pageTitle: pageTitle || null,
    });
    reportSaveResult(resp);
  } catch (err) {
    reportNativeError(err);
  }
}

async function finishCaptureSave(dataUrl, pageUrl, pageTitle) {
  if (!dataUrl) { notify('Capture produced no image.'); return; }
  if (dataUrl.length > SAFE_CAPTURE_BYTES) {
    notify('Capture too large to send — try a smaller area.');
    return;
  }
  try {
    const resp = await chrome.runtime.sendNativeMessage(HOST_NAME, {
      type: 'save',
      imageUrl: dataUrl,
      pageUrl: pageUrl || null,
      pageTitle: pageTitle || null,
    });
    reportSaveResult(resp);
  } catch (err) {
    reportNativeError(err);
  }
}

function reportSaveResult(resp) {
  if (!resp || !resp.ok) {
    const msg = resp?.error || 'Save failed.';
    notify(msg === 'app not running' ? 'Open GatherOS first, then try again.' : msg);
    return;
  }
  notify(resp.duplicate ? 'Already in your library.' : 'Saved to GatherOS.');
}

function reportNativeError(err) {
  const msg = err?.message || String(err);
  if (msg.includes('host not found') || msg.includes('Specified native messaging host')) {
    notify('Open GatherOS once to finish setup, then try again.');
  } else {
    notify(`Couldn't reach GatherOS — ${msg}`);
  }
}

function captureErrorText(err) {
  const m = err?.message || String(err);
  if (/cannot be (captured|edited)|chrome:\/\/|extension gallery|activeTab|<all_urls>|No tab|cannot access/i.test(m)) {
    return "This page can't be captured.";
  }
  return `Capture failed — ${m}`;
}

// Re-encode a data URL smaller until it fits the native-message cap.
// Only kicks in for oversized captures (big retina viewports); normal
// JPEGs pass straight through.
async function shrinkDataUrlIfNeeded(dataUrl, maxEdge = CAPTURE_MAX_EDGE) {
  if (!dataUrl || dataUrl.length <= SAFE_CAPTURE_BYTES) return dataUrl;
  try {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    let q = 0.8;
    let out = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: q }));
    while (out.length > SAFE_CAPTURE_BYTES && q > 0.4) {
      q -= 0.15;
      out = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: q }));
    }
    return out;
  } catch {
    return dataUrl; // best effort; finishCaptureSave guards the hard cap
  }
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

// Injected into the active tab to let the user drag-select a region.
// Resolves to { x, y, w, h, dpr } in CSS px, or null if cancelled.
// Must be self-contained — chrome.scripting serializes it, so it can't
// reference anything from this module's scope.
function areaSelectOverlay() {
  return new Promise((resolve) => {
    const root = document.documentElement || document.body;
    const ov = document.createElement('div');
    // Transparent overlay — only the box-shadow on the selection dims
    // the page, so the selected region itself stays at full opacity.
    ov.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:transparent;';
    const sel = document.createElement('div');
    sel.style.cssText =
      'position:fixed;display:none;border:1.5px solid #fff;' +
      'box-shadow:0 0 0 9999px rgba(0,0,0,0.30);background:transparent;';
    ov.appendChild(sel);
    root.appendChild(ov);

    let sx = 0, sy = 0, drawing = false;
    const teardown = () => {
      ov.remove();
      window.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); teardown(); resolve(null); }
    };
    window.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', (e) => {
      drawing = true;
      sx = e.clientX; sy = e.clientY;
      sel.style.left = sx + 'px'; sel.style.top = sy + 'px';
      sel.style.width = '0px'; sel.style.height = '0px';
      sel.style.display = 'block';
    });
    ov.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      sel.style.left = Math.min(sx, e.clientX) + 'px';
      sel.style.top = Math.min(sy, e.clientY) + 'px';
      sel.style.width = Math.abs(e.clientX - sx) + 'px';
      sel.style.height = Math.abs(e.clientY - sy) + 'px';
    });
    ov.addEventListener('mouseup', (e) => {
      if (!drawing) return;
      drawing = false;
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      teardown();
      if (w < 6 || h < 6) { resolve(null); return; }
      // Let the overlay clear from the page before the screenshot.
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          resolve({ x, y, w, h, dpr: window.devicePixelRatio || 1 })));
    });
  });
}
