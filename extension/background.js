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
});
chrome.runtime.onStartup.addListener(() => {
  ensureBookmarkPollAlarm();
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
    return { ok: true, appRunning: !!(r && r.appRunning) };
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
    const ok = !!(response && response.ok);
    sendResponse({
      ok,
      duplicate: !!(response && response.duplicate),
      error: response?.error || null,
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

async function readSeenSet() {
  const data = await chrome.storage.local.get([STORAGE_SEEN_KEY, STORAGE_BASELINE_KEY]);
  const seen = new Set(Array.isArray(data[STORAGE_SEEN_KEY]) ? data[STORAGE_SEEN_KEY] : []);
  const baseline = !!data[STORAGE_BASELINE_KEY];
  return { seen, baseline };
}

async function writeSeenSet(seen, { baseline } = {}) {
  const update = { [STORAGE_SEEN_KEY]: Array.from(seen) };
  if (baseline !== undefined) update[STORAGE_BASELINE_KEY] = !!baseline;
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
  const { seen, baseline } = await readSeenSet();

  if (!baseline) {
    // First batch — this is the user's existing archive at install
    // time. Record everything silently; no imports.
    for (const b of bookmarks) {
      if (b && b.tweetId) seen.add(b.tweetId);
    }
    await writeSeenSet(seen, { baseline: true });
    return;
  }

  // Established baseline — anything not in the seen set is a new
  // bookmark from any device. Import sequentially so we don't hit
  // the native host with a burst of parallel saves.
  const toImport = bookmarks.filter((b) => b && b.tweetId && !seen.has(b.tweetId));
  for (const b of toImport) {
    try {
      await syncBookmarkToGather(b);
      // Add to seen even when the save fails offline — the next
      // visit will retry naturally because the bookmark will appear
      // in the response again. Tracking it as "seen" only on
      // confirmed save would otherwise re-attempt on every poll.
      seen.add(b.tweetId);
    } catch (err) {
      console.warn('[gatheros] cross-device bookmark sync failed:', err?.message || err);
      // Still mark seen — same reasoning as above; an unrecoverable
      // failure (e.g. content_hash bug) shouldn't loop forever.
      seen.add(b.tweetId);
    }
  }
  await writeSeenSet(seen);
}

// Send a single bookmark down the same /save pipeline as the click
// capture. Mirrors the payload shape the bookmark watcher uses so
// the native-host + extension-server contract stays single-source.
async function syncBookmarkToGather(b) {
  const payload = {
    type: 'save',
    pageUrl: b.tweetUrl,
    tags: ['x:bookmark'],
    tweetMeta: {
      authorName: b.authorName || '',
      authorHandle: b.authorHandle || '',
      authorAvatarUrl: b.authorAvatarUrl || '',
      caption: b.caption || '',
      imageUrls: Array.isArray(b.imageUrls) ? b.imageUrls : [],
      videoUrl: b.videoUrl || null,
      posterUrl: b.posterUrl || '',
    },
  };
  if (b.videoUrl) {
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
  const { [STORAGE_TEMPLATE_KEY]: template } = await chrome.storage.local.get(STORAGE_TEMPLATE_KEY);
  if (!template || !template.url || !template.authorization) {
    // No template yet — user hasn't visited /i/bookmarks since the
    // poll alarm was registered. Quietly no-op until they do.
    return;
  }

  let csrf = null;
  try {
    const cookie = await chrome.cookies.get({ url: 'https://x.com/', name: 'ct0' });
    if (cookie && cookie.value) csrf = cookie.value;
  } catch (err) {
    console.warn('[gatheros] reading ct0 cookie failed:', err?.message || err);
    return;
  }
  if (!csrf) return; // user not signed in to x.com in this Chrome profile

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
  };
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

// ── Popup-driven browser capture + URL save ────────────────────────
//
// The toolbar popup (popup.html) drives these. Browser-page and area
// captures are taken as JPEG and shipped to the desktop app as a
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
