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

// Reusable in-page toast pinned to the bottom-right. Lives entirely
// inside the content script's own DOM node so X's styles can't
// bleed in. Each call replaces any earlier visible toast so a
// rapid-fire bookmarking session collapses to "Saved (3)" rather
// than stacking multiple pills. State + DOM are module-level so
// they survive React-like rerenders of X's own page chrome.
let toastEl = null;
let toastTimer = null;
function showGatherToast(message, { tone = 'ok' } = {}) {
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
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (!toastEl) return;
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateY(8px)';
  }, 2200);
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

// Use the capture phase so we read the article BEFORE X's own click
// handler can re-render or detach it. Reading is synchronous so
// there's no race with the subsequent state flip.
document.addEventListener('click', (e) => {
  const button = findBookmarkButton(e.target);
  if (!button) return;
  if (!isBookmarkAddAction(button)) return;

  const article = findTweetArticle(button);
  if (!article) return;

  const tweetUrl = findTweetUrl(article);
  if (!tweetUrl) return;

  const imageUrls = findImageUrls(article);
  const tweetVideo = findTweetVideo(article);
  // findTweetVideo may return { videoUrl: null, posterUrl } when the
  // tweet has a video but the MP4 lives behind a blob:/MSE URL we
  // can't fetch. Fold the poster into imageUrls so the bookmark
  // still lands — the user gets a still of the tweet in their
  // library instead of nothing.
  if (tweetVideo && !tweetVideo.videoUrl && tweetVideo.posterUrl) {
    imageUrls.unshift(tweetVideo.posterUrl);
  }
  // Skip tweets that have neither images, a usable video, nor a
  // poster fallback — nothing for the library to anchor to.
  if (imageUrls.length === 0 && !(tweetVideo && tweetVideo.videoUrl)) return;

  const author = findAuthorInfo(article);
  const avatarUrl = findAvatarUrl(article);
  const caption = findCaption(article);

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
    pageUrl: tweetUrl,
    // Auto-tag every X bookmark so the user can filter their library
    // to "just my X bookmarks" via the existing tag picker. The
    // 'x:' namespace keeps it visually distinct from user-authored
    // tags and reserves space for future capture surfaces
    // (instagram:, pinterest:, …).
    tags: ['x:bookmark'],
    tweetMeta: {
      authorName: author.displayName,
      authorHandle: author.handle,
      authorAvatarUrl: avatarUrl,
      caption,
      imageUrls,
      videoUrl: tweetVideo?.videoUrl || null,
      posterUrl: tweetVideo?.posterUrl || null,
    },
  };
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
