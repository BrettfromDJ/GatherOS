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

// Twitter rewrites image URLs to include &name=small / &name=900x900
// based on layout. Always request the original-resolution variant so
// the saved asset isn't a thumbnail.
function highResTwimg(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('name', 'orig');
    return u.toString();
  } catch {
    return url;
  }
}

// Collect every twimg media URL inside the article. Filter to the
// pbs.twimg.com/media/ host so avatars (profile_images path) and
// emoji (twemoji) don't leak in.
function findImageUrls(article) {
  const out = [];
  const seen = new Set();
  const imgs = article.querySelectorAll('img');
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (!src.includes('pbs.twimg.com/media/')) continue;
    const hi = highResTwimg(src);
    if (seen.has(hi)) continue;
    seen.add(hi);
    out.push(hi);
  }
  return out;
}

// Try to read the tweet author's display name from the article for a
// nicer save title. data-testid="User-Name" wraps the author block;
// the first line of its innerText is the display name. Falls back to
// the tweet URL if anything's missing.
function findTitle(article, tweetUrl) {
  const nameEl = article.querySelector('[data-testid="User-Name"]');
  const name = nameEl ? nameEl.innerText.split('\n')[0].trim() : '';
  return name ? `Bookmark from ${name}` : tweetUrl;
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

  const title = findTitle(article, tweetUrl);

  chrome.runtime.sendMessage({
    type: 'gatheros:x-bookmark',
    imageUrl: imageUrls[0],
    pageUrl: tweetUrl,
    pageTitle: title,
  });
}, true);
