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

// Strip Twitter's &name=<variant> query param so we store one
// canonical URL per image regardless of which size X happened to be
// rendering at click time. Earlier versions rewrote to name=orig but
// that variant is occasionally gated by X for non-image-CDN paths;
// keeping the URL exactly as X served it sidesteps that and lets the
// renderer pick its own variant via twimgVariant() at display time.
function canonicalTwimg(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('name');
    return u.toString();
  } catch {
    return url;
  }
}

// Collect every twimg image URL inside the article. Multi-image
// tweets render each photo as a regular <img>, but X also uses
// <source> elements inside <picture> for responsive variants and
// occasionally background-image divs for in-grid hover thumbnails.
// We pull from all three plus img.currentSrc (the actually-loaded
// variant after srcset selection) so a 4-image tweet doesn't end up
// with three broken tiles. The path filter accepts /media/ as well
// as /tweet_video_thumb/ and /ext_tw_video_thumb/ so GIF / video
// poster frames also flow through.
function findImageUrls(article) {
  const out = [];
  const seen = new Set();
  const PBS_PATH = /pbs\.twimg\.com\/(?:media|tweet_video_thumb|ext_tw_video_thumb|amplify_video_thumb)\//;

  function collect(rawSrc) {
    if (!rawSrc) return;
    if (!PBS_PATH.test(rawSrc)) return;
    const canonical = canonicalTwimg(rawSrc);
    if (seen.has(canonical)) return;
    seen.add(canonical);
    out.push(canonical);
  }

  // 1. <img> tags — the main path. currentSrc reflects the variant
  //    the browser actually chose from srcset, which is generally
  //    higher fidelity than what's listed in src=.
  article.querySelectorAll('img').forEach((img) => {
    collect(img.currentSrc);
    collect(img.getAttribute('src'));
    // srcset is a comma-separated list of "URL widthDescriptor";
    // pull every URL out of it so we catch images that haven't yet
    // had their src resolved by the browser.
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      srcset.split(',').forEach((part) => {
        const url = part.trim().split(/\s+/)[0];
        collect(url);
      });
    }
  });

  // 2. <source> tags inside <picture> elements. X occasionally wraps
  //    media in <picture> to swap variants by viewport.
  article.querySelectorAll('source').forEach((s) => {
    const srcset = s.getAttribute('srcset') || s.getAttribute('src') || '';
    srcset.split(',').forEach((part) => {
      const url = part.trim().split(/\s+/)[0];
      collect(url);
    });
  });

  // 3. Inline background-image styles. Rarely used by X but cheap
  //    to check; pulls the URL out of url(...) wrappers.
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
  if (imageUrls.length === 0) return; // image-bearing only in v1

  const author = findAuthorInfo(article);
  const avatarUrl = findAvatarUrl(article);
  const caption = findCaption(article);

  // tweet_meta is the durable payload — DetailPanel renders a glass
  // tweet card from this, including the secondary-image thumbnail
  // strip and click-to-swap. The grid title + detail-panel notes
  // stay empty so the rest of the app reads identically to any
  // other image save.
  chrome.runtime.sendMessage({
    type: 'gatheros:x-bookmark',
    imageUrl: imageUrls[0],
    pageUrl: tweetUrl,
    tweetMeta: {
      authorName: author.displayName,
      authorHandle: author.handle,
      authorAvatarUrl: avatarUrl,
      caption,
      imageUrls,
    },
  });
}, true);
