// Real-time X bookmark capture. Watches for clicks on the bookmark
// button anywhere on x.com / twitter.com, walks up to the enclosing
// <article>, extracts the tweet permalink + image URLs from the
// rendered DOM, and posts to the background service worker which
// forwards to GatherOS via native messaging.
//
// v1: only tweets with at least one image are synced. Dedup happens
// GatherOS-side via content_hash, so re-bookmarking or scrolling past
// the same tweet twice is a silent no-op.
//
// If X ever changes the bookmark button's data-testid, this single
// constant is the only thing that needs updating. As of this writing
// it's been stable since 2023.
const BOOKMARK_TESTID = 'bookmark';

// Cache of tweet ID → { videoUrl, posterUrl }, populated by the
// MAIN-world x-graphql-interceptor.js as Twitter's GraphQL endpoints
// return tweet payloads. We listen for window messages on the page's
// own origin to receive them. This is the only way to learn a tweet
// video's real http(s) MP4 URL — the DOM's <video src> is a blob:
// URL produced by Twitter's MSE player and can't be fetched out of
// the page.
const tweetVideoCache = new Map();
// rootTweetId -> [{ text, imageUrls }] for threads whose conversation
// the interceptor has seen. Lets a bookmark of the root tweet be saved
// as a multi-part thread.
const tweetThreadCache = new Map();
// tweetId -> { authorName, authorHandle, authorAvatarUrl, caption, imageUrls }
// for the tweet embedded inside a quote tweet.
const tweetQuotedCache = new Map();
// tweetId -> ordered media list [{type:'image'|'video', url, poster}] for
// multi-media tweets, from the interceptor. Lets a bookmark of a tweet
// with more than one video carry every video URL (the DOM only exposes
// the first video's stream + the rest as poster stills).
const tweetMediaCache = new Map();
// tweetId -> { title, excerpt, coverUrl } for X long-form Articles, from the
// interceptor. The DOM only exposes the article as a card image, so without
// this a bookmarked article loses its title/body text.
const tweetArticleCache = new Map();
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'gatheros-interceptor') return;
  if (data.type === 'tweet-videos' && Array.isArray(data.videos)) {
    for (const [id, info] of data.videos) {
      if (id && info && info.videoUrl) tweetVideoCache.set(id, info);
    }
  }
  if (data.type === 'tweet-media' && Array.isArray(data.media)) {
    for (const [id, list] of data.media) {
      if (id && Array.isArray(list) && list.length > 1) tweetMediaCache.set(id, list);
    }
  }
  if (data.type === 'thread-cache' && Array.isArray(data.threads)) {
    for (const [rootId, parts] of data.threads) {
      if (rootId && Array.isArray(parts) && parts.length > 1) {
        tweetThreadCache.set(rootId, parts);
      }
    }
  }
  if (data.type === 'quoted-cache' && Array.isArray(data.quoted)) {
    for (const [id, quoted] of data.quoted) {
      if (id && quoted) tweetQuotedCache.set(id, quoted);
    }
  }
  if (data.type === 'tweet-article' && Array.isArray(data.articles)) {
    for (const [id, article] of data.articles) {
      if (id && article && (article.title || article.excerpt)) {
        tweetArticleCache.set(id, article);
      }
    }
  }
  // Cross-device bookmark sync. The interceptor extracts every
  // bookmark it sees in a /Bookmarks GraphQL response and forwards
  // the batch here; we relay it to the background service worker,
  // which owns the "seen" baseline in chrome.storage and routes any
  // new (not-yet-seen) tweet through the same /save pipeline the
  // click capture uses. End result: bookmarks made on iOS / web /
  // any device land in GatherOS the next time the desktop browser
  // pulls the bookmarks feed (visit x.com or /i/bookmarks).
  if (data.type === 'bookmark-batch' && Array.isArray(data.bookmarks)) {
    chrome.runtime.sendMessage({
      type: 'gatheros:bookmark-batch',
      bookmarks: data.bookmarks,
    });
  }
  // Refresh-template messages carry the full URL of the most recent
  // top-of-bookmarks GraphQL request plus the Authorization header
  // x.com attached. The background service worker stores both so a
  // chrome.alarms-driven poll can re-fire the same request later
  // without needing the bookmarks page to be open.
  if (data.type === 'bookmark-refresh-template' && data.url) {
    chrome.runtime.sendMessage({
      type: 'gatheros:bookmark-refresh-template',
      url: data.url,
      authorization: data.authorization || null,
    });
  }
});

// Pull the numeric tweet id out of a permalink. /user/status/12345
// → "12345", anything else → null. Used as the cache key against
// tweetVideoCache.
function tweetIdFromUrl(url) {
  const m = (url || '').match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

// The GraphQL response often arrives within ~200-500ms of a tweet
// scrolling into view, but a user can click bookmark fast enough to
// beat it. Poll the cache briefly so the common case "cache cold,
// fills moments later" still finds the URL. Resolves with the
// cached entry, or null if the deadline passed with nothing.
function awaitTweetVideo(tweetId, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const cached = tweetVideoCache.get(tweetId);
    if (cached) { resolve(cached); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      const c = tweetVideoCache.get(tweetId);
      if (c) {
        clearInterval(interval);
        resolve(c);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(null);
      }
    }, 80);
  });
}

// Reusable in-page toast pinned to the bottom-right. Lives entirely
// inside the content script's own DOM node so X's styles can't
// bleed in. Each call replaces any earlier visible toast so a
// rapid-fire bookmarking session collapses to "Saved (3)" rather
// than stacking multiple pills. State + DOM are module-level so
// they survive React-like rerenders of X's own page chrome.
let toastEl = null;
let toastTimer = null;
function showGatherToast(message, { tone = 'ok', sticky = false } = {}) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    // Pin via inline styles so X's CSS / class scoping can't break
    // it. z-index is well above x.com's modal stack.
    toastEl.style.cssText = [
      'position:fixed',
      'right:24px',
      'bottom:24px',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:10px 14px',
      'font:500 13px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif',
      'color:rgba(255,255,255,0.95)',
      'background:rgba(20,20,22,0.78)',
      'backdrop-filter:blur(20px) saturate(1.8)',
      '-webkit-backdrop-filter:blur(20px) saturate(1.8)',
      'border:0.5px solid rgba(255,255,255,0.14)',
      'border-radius:999px',
      'box-shadow:0 1px 2px rgba(0,0,0,0.2),0 8px 22px rgba(0,0,0,0.28)',
      'opacity:0',
      'transform:translateY(8px)',
      'transition:opacity 160ms ease,transform 160ms ease',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(toastEl);
  }
  // Re-build content: a small coloured dot + message.
  const dotColor = tone === 'error'
    ? 'rgba(255,90,90,0.95)'
    : 'rgba(110,220,140,0.95)';
  toastEl.innerHTML = `
    <span style="width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block"></span>
    <span></span>
  `;
  toastEl.querySelector('span:last-child').textContent = message;
  // Force a frame before applying the visible state so the CSS
  // transition fires from the offscreen position.
  requestAnimationFrame(() => {
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translateY(0)';
  });
  // Sticky toasts (live import progress) stay until explicitly replaced
  // by a non-sticky one; everything else auto-dismisses.
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  if (!sticky) {
    toastTimer = setTimeout(() => {
      if (!toastEl) return;
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateY(8px)';
    }, 2200);
  }
}

// The click target inside the bookmark button is often the inner SVG
// or <path>. Walk up to the actual button with the data-testid before
// reading aria-label / starting the tweet extraction.
function findBookmarkButton(target) {
  let el = target;
  while (el && el !== document.body) {
    if (el.getAttribute && el.getAttribute('data-testid') === BOOKMARK_TESTID) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// The bookmark button's aria-label flips between "Bookmark" and
// "Remove Bookmark" (and localized equivalents). We want to fire only
// on adds; ignore the remove action so re-clicking doesn't ping the
// app. If the label is missing or unfamiliar we default to add and
// let GatherOS's content_hash dedup catch any spurious duplicates.
function isBookmarkAddAction(button) {
  const label = (button.getAttribute('aria-label') || '').toLowerCase();
  if (!label) return true;
  if (label.includes('remove')) return false;
  return true;
}

// Each tweet on the timeline is its own <article role="article">.
// The bookmark button lives inside the action row near the bottom.
function findTweetArticle(button) {
  let el = button;
  while (el && el !== document.body) {
    if (el.tagName === 'ARTICLE') return el;
    el = el.parentElement;
  }
  return null;
}

// The article contains several /status/<id> links (timestamp, share
// menu, photo thumbnails). We want the bare /<user>/status/<id>
// permalink — the first match that doesn't have a trailing /photo/
// or /analytics segment.
function findTweetUrl(article) {
  const links = article.querySelectorAll('a[href*="/status/"]');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/^(\/[^/]+\/status\/\d+)(?:[/?#]|$)/);
    if (match) {
      return new URL(match[1], 'https://x.com').href;
    }
  }
  return null;
}

// Dedup key: strip Twitter's &name=<variant> so different
// resolutions of the same image (in srcset) collapse to one entry.
// We do NOT strip format= — that's the bit that determines whether
// twimg serves JPG, PNG, or WebP, and we want to keep whatever
// variant X was actually rendering.
function dedupeKey(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('name');
    return u.toString();
  } catch {
    return url;
  }
}

// Collect every twimg image URL the browser successfully rendered
// inside the article. Crucially, we read img.currentSrc — that's the
// exact URL the browser fetched after srcset selection, which means
// it's guaranteed to be a URL twimg actually serves bytes for.
// Synthesizing URLs (adding ?format=jpg&name=large) was unreliable
// because some images live only as WebP / video poster frames and
// twimg 404s on the wrong variant. The path filter accepts /media/
// as well as the video thumbnail paths so animated formats flow
// through too.
function findImageUrls(article) {
  const out = [];
  const seen = new Set();
  const PBS_PATH = /pbs\.twimg\.com\/(?:media|tweet_video_thumb|ext_tw_video_thumb|amplify_video_thumb)\//;

  function collect(rawSrc) {
    if (!rawSrc) return;
    if (!PBS_PATH.test(rawSrc)) return;
    const key = dedupeKey(rawSrc);
    if (seen.has(key)) return;
    seen.add(key);
    // Store the URL exactly as X served it — including its current
    // format= / name= params — so the renderer can use it verbatim.
    out.push(rawSrc);
  }

  // <img> tags — the primary path. Prefer currentSrc because that's
  // the URL the browser already validated by loading it. Fall back
  // to src / srcset for images that hadn't started loading yet.
  article.querySelectorAll('img').forEach((img) => {
    if (img.currentSrc) {
      collect(img.currentSrc);
      return;
    }
    collect(img.getAttribute('src'));
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      srcset.split(',').forEach((part) => {
        const url = part.trim().split(/\s+/)[0];
        collect(url);
      });
    }
  });

  // <source> tags inside <picture> elements — X uses these to serve
  // WebP / AVIF to capable browsers.
  article.querySelectorAll('source').forEach((s) => {
    const srcset = s.getAttribute('srcset') || s.getAttribute('src') || '';
    srcset.split(',').forEach((part) => {
      const url = part.trim().split(/\s+/)[0];
      collect(url);
    });
  });

  // Inline background-image styles — rare on x.com but cheap to scan.
  article.querySelectorAll('[style*="background-image"]').forEach((el) => {
    const style = el.getAttribute('style') || '';
    const match = style.match(/url\(["']?([^"')]+)["']?\)/);
    if (match) collect(match[1]);
  });

  return out;
}

// Read the author's display name + @handle from the User-Name block.
// X renders these on two adjacent lines inside the same wrapper:
//   "Brett ✦ DesignJoy
//    @brettfromdj"
// We split on newlines, take the first non-empty line as the display
// name and the first line starting with @ as the handle. Either may
// be missing depending on layout (verified/locked accounts add extra
// lines for badges); both fall back gracefully.
function findAuthorInfo(article) {
  const nameEl = article.querySelector('[data-testid="User-Name"]');
  if (!nameEl) return { displayName: '', handle: '' };
  const lines = nameEl.innerText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const displayName = lines[0] || '';
  const handle = lines.find((l) => l.startsWith('@')) || '';
  return { displayName, handle };
}

// The author's avatar lives inside data-testid="Tweet-User-Avatar"
// (the outer wrapper); the actual rendered <img> is one or two
// levels deep. Grab whatever src twitter shipped — it's already
// scaled for the timeline so we leave it as-is.
function findAvatarUrl(article) {
  const wrap = article.querySelector('[data-testid="Tweet-User-Avatar"]');
  if (!wrap) return '';
  const img = wrap.querySelector('img');
  return img ? (img.getAttribute('src') || '') : '';
}

// The tweet body lives in data-testid="tweetText". innerText
// preserves line breaks but flattens hashtag / mention link wrappers
// into plain text, which is what we want for searchable / displayable
// content. Returns an empty string when the tweet has no body.
function findCaption(article) {
  const captionEl = article.querySelector('[data-testid="tweetText"]');
  return captionEl ? captionEl.innerText.trim() : '';
}

function findTweetCreatedAt(article) {
  const timeEl = article.querySelector('time[datetime]');
  if (!timeEl) return null;
  const ms = Date.parse(timeEl.getAttribute('datetime') || '');
  return Number.isFinite(ms) ? ms : null;
}

// Tweet video extraction. X embeds video as a <video> element with
// one or more <source> children — usually a single MP4 source with
// the highest available bitrate already pre-selected. Returns the
// MP4 URL + poster URL, or null when the tweet has no playable
// http(s) MP4 we can hand to the native host.
//
// IMPORTANT: X streams a chunk of its videos via Media Source
// Extensions, which makes the <video src> a blob: URL that only
// resolves inside the page. Those can't be fetched from outside the
// renderer, so we skip them — the caller falls back to saving the
// poster image as an image bookmark, giving the user a record of
// the tweet even when the MP4 itself is unreachable.
//
// The MP4 URL pattern bakes the resolution into the path:
//     https://video.twimg.com/.../1280x720/<id>.mp4
// We pick the source with the largest path-encoded width so the
// save lands at the best quality X is willing to serve. The poster
// frame comes from the <video poster=...> attribute and gets used
// as the save's thumbnail downstream.
function findTweetVideo(article) {
  const video = article.querySelector('video');
  if (!video) return null;
  const posterUrl = video.getAttribute('poster') || '';

  const sources = Array.from(video.querySelectorAll('source'));
  // Some tweets render their MP4 directly on the <video> element
  // rather than nesting it in a <source>; add that as a fallback.
  if (video.getAttribute('src')) {
    sources.push(video);
  }

  let best = null;
  for (const s of sources) {
    const src = s.getAttribute('src');
    if (!src) continue;
    // Only http(s) URLs survive — blob: (MSE) and data: URLs can't
    // be fetched by the native host.
    if (!/^https?:\/\//i.test(src)) continue;
    // Twitter videos are MP4; HLS / m3u8 streams need ffmpeg to
    // download, which we don't have. Skip those so the user gets a
    // clear "no video found" rather than a corrupt save.
    if (!/\.mp4(\?|$)/i.test(src) && !/video\/mp4/i.test(s.getAttribute?.('type') || '')) {
      continue;
    }
    const match = src.match(/\/(\d{2,5})x(\d{2,5})\//);
    const width = match ? parseInt(match[1], 10) : 0;
    if (!best || width > best.width) {
      best = { src, width };
    }
  }

  // When the <video> exists but no http(s) MP4 is reachable, report
  // the poster so the caller can still bookmark the tweet as an
  // image. videoUrl: null is the signal.
  if (!best) {
    return posterUrl ? { videoUrl: null, posterUrl } : null;
  }

  return {
    videoUrl: best.src,
    posterUrl,
  };
}

// ── Backfill import ("Import bookmarks" from the panel) ─────────────
// The background service worker starts/stops a backfill on the
// bookmarks tab. While it runs we (1) tell the MAIN-world interceptor
// to forward every bookmarks page rather than just the newest, and
// (2) auto-scroll the timeline at a gentle pace so x.com keeps loading
// older pages for the interceptor to capture. The background owns the
// stop decision (count reached, or no new bookmarks turning up) and
// sends 'gatheros:stop-import' with a summary. A hard tick cap here is
// a backstop so a stuck page can never scroll forever on its own.
let importScrollActive = false;

function setInterceptorImportMode(on) {
  window.postMessage(
    { source: 'gatheros-control', type: 'import-mode', on: !!on },
    window.location.origin,
  );
}

function importSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runImportScroll() {
  if (importScrollActive) return; // already running — ignore duplicate start
  importScrollActive = true;
  setInterceptorImportMode(true);
  // Sticky so it persists for the whole scroll; the background updates
  // it live via 'gatheros:import-progress'.
  showGatherToast('Importing bookmarks…', { tone: 'ok', sticky: true });

  // ~1.2s/tick is fast enough to feel responsive but slow enough to
  // stay under x.com's rate limiting. MAX_TICKS caps a single run at a
  // few hundred pages even if the background never signals stop.
  const TICK_MS = 1200;
  const MAX_TICKS = 400;
  let ticks = 0;
  while (importScrollActive && ticks < MAX_TICKS) {
    const scroller = document.scrollingElement || document.documentElement;
    if (scroller) window.scrollTo(0, scroller.scrollHeight);
    ticks += 1;
    await importSleep(TICK_MS);
  }
  // Loop ended on its own (hit MAX_TICKS) without a stop signal — clean
  // up so the interceptor returns to top-of-list-only.
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
    showGatherToast(
      n > 0 ? `Done — imported ${n} bookmark${n === 1 ? '' : 's'}` : 'No new bookmarks to import',
      { tone: 'ok' }, // non-sticky → auto-dismisses
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
      // Be honest: only say "saved" for genuinely-new imports. While
      // everything so far is a duplicate/already-saved, show the scan
      // count ticking so it never claims to import when it isn't.
      const text = saved > 0
        ? `Importing… ${saved} saved`
        : `Scanning bookmarks… ${scanned}`;
      showGatherToast(text, { tone: 'ok', sticky: true });
    }
    return false;
  }
  if (msg.type === 'gatheros:stop-import') { stopImportScroll(msg.summary); return false; }
  return undefined;
});

// Use the capture phase so we read the article BEFORE X's own click
// handler can re-render or detach it. Reading is synchronous so
// there's no race with the subsequent state flip.
// async because we may need to wait briefly for the GraphQL
// interceptor's cache to populate before we can send the real MP4
// URL through to the native host.
document.addEventListener('click', async (e) => {
  const button = findBookmarkButton(e.target);
  if (!button) return;
  if (!isBookmarkAddAction(button)) return;

  const article = findTweetArticle(button);
  if (!article) return;

  const tweetUrl = findTweetUrl(article);
  if (!tweetUrl) return;

  const imageUrls = findImageUrls(article);
  let tweetVideo = findTweetVideo(article);

  // If the article has a <video> but DOM extraction couldn't find a
  // usable http(s) MP4 (blob: URL from Twitter's MSE player), ask
  // the GraphQL interceptor's cache. That cache is fed by the real
  // tweet payloads Twitter's app fetches anyway, which contain the
  // direct https MP4 variants. Briefly poll the cache so a "just-
  // landed-on-the-page-and-clicked-fast" case isn't a miss.
  const articleHasVideo = !!article.querySelector('video');
  if (articleHasVideo && (!tweetVideo || !tweetVideo.videoUrl)) {
    const tweetId = tweetIdFromUrl(tweetUrl);
    if (tweetId) {
      const cached = await awaitTweetVideo(tweetId);
      if (cached && cached.videoUrl) {
        tweetVideo = {
          videoUrl: cached.videoUrl,
          // Fall back to the cached poster if we don't have one
          // from the DOM — both sources should agree.
          posterUrl: (tweetVideo && tweetVideo.posterUrl) || cached.posterUrl || '',
        };
      }
    }
  }

  // After cache lookup: tweetVideo may still be { videoUrl: null,
  // posterUrl } if the cache missed entirely. Fold its poster into
  // imageUrls so the bookmark still lands — the user gets a still
  // of the tweet in their library instead of nothing.
  if (tweetVideo && !tweetVideo.videoUrl && tweetVideo.posterUrl) {
    imageUrls.unshift(tweetVideo.posterUrl);
  }
  const author = findAuthorInfo(article);
  const avatarUrl = findAvatarUrl(article);
  const caption = findCaption(article);
  const tweetCreatedAt = findTweetCreatedAt(article);

  // Skip only when there's genuinely nothing to save — no images, no
  // usable video/poster, AND no text. Text-only tweets (caption but no
  // media) are now savable: the desktop renders the tweet card itself
  // to an image.
  if (imageUrls.length === 0
    && !(tweetVideo && tweetVideo.videoUrl)
    && !(caption && caption.trim())) return;

  // Rewrite name=<small variant> → name=large for the URL we ship
  // to the desktop as the primary save. img.currentSrc is whatever
  // size X chose for the timeline (usually 360x360 or 900x900), and
  // that ends up being the resolution saved to disk if we hand it
  // over unchanged. Critically we keep format= intact — that was the
  // bit that 404'd in earlier iterations. The captured imageUrls
  // array stays at the original timeline variant for the thumbnail
  // strip; only the primary save URL and the focused-view alt swap
  // get upscaled.
  function twimgLarge(url) {
    try {
      const u = new URL(url);
      u.searchParams.set('name', 'large');
      return u.toString();
    } catch { return url; }
  }

  // tweet_meta is the durable payload — DetailPanel renders a glass
  // tweet card from this, including the secondary-image thumbnail
  // strip and click-to-swap. The grid title + detail-panel notes
  // stay empty so the rest of the app reads identically to any
  // other image save.
  //
  // Branching: if the tweet has images, save as image (primary +
  // optional alt thumbs). If it's video-only, send videoUrl +
  // posterUrl instead — the desktop's /save endpoint detects the
  // video branch and routes to saveVideoFromUrl.
  const payload = {
    type: 'gatheros:x-bookmark',
    // Background uses this to add the tweet to the "seen" baseline
    // after a successful save, so the bookmark-batch flow (cross-
    // device sync) doesn't re-import the same tweet later.
    tweetId: tweetIdFromUrl(tweetUrl),
    pageUrl: tweetUrl,
    // Auto-tag every X bookmark so the user can filter their library
    // to "just my X bookmarks" via the existing tag picker. The
    // 'x:' namespace keeps it visually distinct from user-authored
    // tags and reserves space for future capture surfaces
    // (instagram:, pinterest:, …).
    tags: ['bookmark'],
    tweetMeta: {
      authorName: author.displayName,
      authorHandle: author.handle,
      authorAvatarUrl: avatarUrl,
      caption,
      imageUrls,
      videoUrl: tweetVideo?.videoUrl || null,
      posterUrl: tweetVideo?.posterUrl || null,
      tweetCreatedAt,
    },
  };
  // If we've seen this tweet's conversation, save it as a thread (root +
  // the author's self-replies). Only attached when the bookmarked tweet
  // is the thread root and there's more than one part — otherwise it's
  // a plain single-tweet save, unchanged.
  const threadParts = tweetThreadCache.get(tweetIdFromUrl(tweetUrl));
  if (Array.isArray(threadParts) && threadParts.length > 1) {
    payload.tweetMeta.thread = threadParts;
  }
  // If this tweet quotes another, attach the quoted tweet so the desktop
  // can render it as a nested card.
  const quoted = tweetQuotedCache.get(tweetIdFromUrl(tweetUrl));
  if (quoted) {
    payload.tweetMeta.quoted = quoted;
  }
  // Long-form Article: attach its title/excerpt/cover so the desktop can
  // show the text instead of just the card image. If the DOM never gave us
  // an image, fall back to the article cover so the save still has a thumb.
  const articleMeta = tweetArticleCache.get(tweetIdFromUrl(tweetUrl));
  if (articleMeta) {
    payload.tweetMeta.article = articleMeta;
    if (!payload.imageUrl && articleMeta.coverUrl) {
      payload.imageUrl = twimgLarge(articleMeta.coverUrl);
      payload.tweetMeta.imageUrls = [articleMeta.coverUrl];
    }
  }
  if (tweetVideo && tweetVideo.videoUrl) {
    // Real playable MP4 — route through the video branch on the
    // desktop. The poster doubles as the JPEG thumbnail.
    payload.videoUrl = tweetVideo.videoUrl;
    payload.posterUrl = tweetVideo.posterUrl;
  } else if (imageUrls.length > 0) {
    // Image-bearing (or video-with-poster-fallback). twimgLarge is
    // a no-op on non-twimg URLs, so the poster fallback flows
    // through it unchanged.
    payload.imageUrl = twimgLarge(imageUrls[0]);
  }

  // Multi-media tweet (e.g. two videos): attach the full ordered media
  // list the interceptor cached, and re-route the local primary download
  // to media[0] so index 0 of the saved media matches the on-disk file.
  // Every other video then streams from its MP4 URL instead of showing a
  // frozen poster.
  const cachedMedia = tweetMediaCache.get(tweetIdFromUrl(tweetUrl));
  if (Array.isArray(cachedMedia) && cachedMedia.length > 1) {
    payload.tweetMeta.media = cachedMedia;
    const first = cachedMedia[0];
    delete payload.imageUrl;
    delete payload.videoUrl;
    delete payload.posterUrl;
    if (first.type === 'video') {
      payload.videoUrl = first.url;
      payload.posterUrl = first.poster || '';
      payload.tweetMeta.videoUrl = first.url;
      payload.tweetMeta.posterUrl = first.poster || '';
    } else {
      payload.imageUrl = twimgLarge(first.url);
    }
  }

  chrome.runtime.sendMessage(payload, (response) => {
    // Background hands back { ok, duplicate, offline, error } once the
    // native host has answered. Stay silent when GatherOS isn't
    // running (offline=true) — otherwise every bookmark click would
    // nag a user who isn't actively using the app this session.
    if (!response) return;
    if (response.ok) {
      showGatherToast(
        response.duplicate ? 'Already in GatherOS' : 'Saved to GatherOS',
        { tone: 'ok' },
      );
      return;
    }
    if (response.offline) return;
    showGatherToast(
      `GatherOS save failed: ${response.error || 'unknown error'}`,
      { tone: 'error' },
    );
  });
}, true);
