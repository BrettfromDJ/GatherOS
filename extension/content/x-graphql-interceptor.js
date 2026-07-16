// MAIN-world script — runs in the same JavaScript context as
// twitter.com / x.com's own code. Necessary because:
//
//   1. The actual MP4 URLs for tweet videos aren't in the DOM —
//      they live in the response bodies of Twitter's GraphQL API
//      calls (TweetDetail, HomeTimeline, Bookmarks, etc.) inside
//      legacy.extended_entities.media[].video_info.variants[].
//
//   2. An isolated-world content script can't see responses to
//      fetches initiated by the page itself, so we install
//      wrappers around fetch and XMLHttpRequest here at the same
//      privilege level as x.com's own code.
//
//   3. The wrapper passes intercepted videos to the isolated world
//      via window.postMessage — which is the standard bridge
//      between main + isolated worlds in an MV3 extension.
//
// Cheap by design: we only parse JSON responses for URLs that look
// like graphql endpoints, and we read each response from a .clone()
// so we never disturb the page's own consumers.

(function gatherInterceptor() {
  if (window.__GATHEROS_INTERCEPTOR__) return;
  window.__GATHEROS_INTERCEPTOR__ = true;

  // Backfill switch. Normal browsing only imports the TOP of the
  // bookmarks list (newest), so scrolling never floods the library
  // with history. When the user runs "Import bookmarks" from the
  // panel, the isolated-world watcher flips this on via a postMessage
  // — while on, we forward bookmark entries from EVERY page, including
  // the cursor-paginated deep-scroll pages, which is what lets old
  // bookmarks import.
  let IMPORT_MODE = false;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== 'gatheros-control') return;
    if (d.type === 'import-mode') IMPORT_MODE = !!d.on;
  });

  // Build an ordered media list for a tweet from its legacy media array:
  // [{ type:'image', url } | { type:'video', url, poster }, …] in the
  // order they appear on the tweet. Photos use the large variant; videos
  // and animated GIFs use the highest-bitrate MP4 (twimg MP4 URLs are
  // durable, so secondary videos play later too). This is what lets a
  // tweet with more than one video bring in every video as a video —
  // not just the first, with the rest stranded as poster stills.
  function buildMediaList(legacy) {
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

  // Cache ordered media lists for multi-media tweets so the click-capture
  // watcher (which reads the DOM, not GraphQL) can attach every video URL
  // to a bookmark. Keyed by tweet id; only multi-item tweets are cached
  // (a single photo/video needs nothing extra).
  function extractTweetMedia(node, out) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const c of node) extractTweetMedia(c, out); return; }
    const legacy = node.legacy;
    if (legacy && legacy.id_str) {
      const media = buildMediaList(legacy);
      if (media.length > 1 && !out.has(legacy.id_str)) out.set(legacy.id_str, media);
    }
    for (const key of Object.keys(node)) {
      if (key === '__typename') continue;
      extractTweetMedia(node[key], out);
    }
  }

  function postTweetMedia(map) {
    if (map.size === 0) return;
    window.postMessage(
      { source: 'gatheros-interceptor', type: 'tweet-media', media: Array.from(map.entries()) },
      window.location.origin,
    );
  }

  // ── X Articles (long-form posts) ────────────────────────────────────
  // A bookmarked Article carries only its cover image through the normal
  // media path, so its title/body would be lost. X exposes the long-form
  // entity on the tweet as `article.article_results.result` with a title +
  // preview text + cover. Pull what we can so the desktop can show (and
  // search) the title instead of a bare image.
  //
  // NOTE: X's article schema is still evolving and undocumented — the field
  // paths below are best-effort across the shapes seen in the wild. If a
  // bookmarked article shows no title, this is the place to widen them.
  function extractArticle(t) {
    const result = t && t.article && t.article.article_results
      && t.article.article_results.result;
    if (!result) return null;
    const title = (result.title || (result.metadata && result.metadata.title) || '').trim();
    const excerpt = (result.preview_text || result.previewText || '').trim();
    if (!title && !excerpt) return null;
    let coverUrl = '';
    const cm = (result.cover_media_results && result.cover_media_results.result)
      || result.cover_media || null;
    if (cm) {
      coverUrl = cm.media_url_https
        || (cm.media_info && (cm.media_info.original_img_url || cm.media_info.url))
        || '';
    }
    return { title, excerpt, coverUrl };
  }

  // Cache article metadata by tweet id so the click-capture watcher (which
  // reads the DOM, where the title is locked inside the card image) can
  // attach it to a bookmark. Mirrors extractTweetMedia.
  function extractTweetArticles(node, out) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const c of node) extractTweetArticles(c, out); return; }
    const legacy = node.legacy;
    if (legacy && legacy.id_str && node.article && !out.has(legacy.id_str)) {
      const art = extractArticle(node);
      if (art) out.set(legacy.id_str, art);
    }
    for (const key of Object.keys(node)) {
      if (key === '__typename') continue;
      extractTweetArticles(node[key], out);
    }
  }

  function postTweetArticles(map) {
    if (map.size === 0) return;
    window.postMessage(
      { source: 'gatheros-interceptor', type: 'tweet-article', articles: Array.from(map.entries()) },
      window.location.origin,
    );
  }

  // Recursively walk a GraphQL response looking for tweet objects
  // (anything with a legacy.id_str and a media array containing
  // video_info.variants). Returns a Map<tweetId, {videoUrl, posterUrl}>.
  // Tweets without video pass through silently.
  function extractTweetVideos(node, out) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) extractTweetVideos(child, out);
      return;
    }
    const legacy = node.legacy;
    if (legacy && legacy.id_str) {
      const media = (legacy.extended_entities && legacy.extended_entities.media)
        || (legacy.entities && legacy.entities.media)
        || null;
      if (Array.isArray(media)) {
        for (const m of media) {
          const variants = m && m.video_info && m.video_info.variants;
          if (!Array.isArray(variants)) continue;
          // Pick the highest-bitrate MP4 variant. Twitter returns a
          // mix of mp4 + m3u8; we only want mp4 since the native
          // host can't download HLS without ffmpeg.
          let best = null;
          for (const v of variants) {
            if (!v || v.content_type !== 'video/mp4' || !v.url) continue;
            const br = typeof v.bitrate === 'number' ? v.bitrate : 0;
            if (!best || br > best.bitrate) best = { url: v.url, bitrate: br };
          }
          if (best) {
            out.set(legacy.id_str, {
              videoUrl: best.url,
              posterUrl: m.media_url_https || '',
            });
          }
        }
      }
    }
    for (const key of Object.keys(node)) {
      // Skip cycles + the obvious junk keys to keep the walk cheap.
      if (key === '__typename') continue;
      extractTweetVideos(node[key], out);
    }
  }

  function postVideos(map) {
    if (map.size === 0) return;
    window.postMessage(
      {
        source: 'gatheros-interceptor',
        type: 'tweet-videos',
        videos: Array.from(map.entries()),
      },
      window.location.origin,
    );
  }

  // Walk the bookmark timeline response and extract a flat array of
  // tweet objects in the shape GatherOS expects. Twitter returns its
  // bookmark feed inside data.bookmark_timeline_v2.timeline.
  // instructions[].entries[] — each entry that's a tweet has an
  // entryId starting with "tweet-" and the tweet payload at
  // content.itemContent.tweet_results.result.
  function extractBookmarkEntries(json) {
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
          const parsed = parseTweetForBookmark(wrapped);
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

  // Minimal author + caption + photo extraction from a tweet result.
  // Used for the quoted tweet inside a quote tweet (and reusable for any
  // nested tweet). Returns null when the result isn't a usable tweet.
  function extractTweetCore(result) {
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

  // The quoted tweet embedded in a quote tweet, or null.
  function quotedFromTweet(t) {
    const qr = t && t.quoted_status_result && t.quoted_status_result.result;
    return extractTweetCore(qr);
  }

  // Pull author / media / caption out of a single tweet result.
  // Returns null only when there's genuinely nothing to save — no
  // media AND no text. Text-only tweets (caption, no media) are saved:
  // the desktop renders the tweet card itself to an image.
  function parseTweetForBookmark(result) {
    // Quote-tweet / visibility wrappers nest the real tweet one
    // level deeper.
    const t = result.tweet || result;
    const legacy = t.legacy;
    if (!legacy || !legacy.id_str) return null;

    const userResult = t.core && t.core.user_results && t.core.user_results.result;
    if (!userResult) return null;
    // X has been migrating user fields out of legacy into a new
    // `core` sub-object (and avatar URL into a dedicated `avatar`
    // sub-object). Read from both so this works during and after the
    // schema rollout. Without this, every tweet in the bookmarks
    // feed returned null because userLegacy.screen_name was
    // undefined on accounts where the migration had landed.
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

    // Media extraction. extended_entities.media is the authoritative
    // list (entities.media truncates to the first photo for legacy
    // clients). Photos give us imageUrls; the first video on the
    // tweet (if any) gives us a single videoUrl + posterUrl pair
    // that the desktop's /save endpoint routes through
    // saveVideoFromUrl.
    const mediaList = (legacy.extended_entities && legacy.extended_entities.media)
      || (legacy.entities && legacy.entities.media)
      || [];
    const imageUrls = [];
    let videoUrl = null;
    let posterUrl = '';
    for (const m of mediaList) {
      if (!m) continue;
      if (m.type === 'photo' && m.media_url_https) {
        // Store with format+name params so the renderer can use the
        // URL verbatim. Matches the click-capture path which derives
        // its URLs from img.currentSrc (already param-encoded).
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

    // Long-form Article entity (title + preview + cover), if any.
    const article = extractArticle(t);
    // A bare article cover may carry no caption; surface it via imageUrls
    // so the save still has a thumbnail.
    if (article && article.coverUrl && imageUrls.length === 0) {
      imageUrls.push(article.coverUrl);
    }

    // Allow text-only tweets and articles through. Only bail when there's
    // nothing at all: no media, no text, and no article.
    if (imageUrls.length === 0 && !videoUrl && !(legacy.full_text || '').trim() && !article) {
      return null;
    }

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
      // Ordered media list — lets a multi-video tweet bring in every
      // video. The desktop's primary download follows media[0].
      media: buildMediaList(legacy),
      quoted: quotedFromTweet(t),
      ...(article ? { article } : {}),
    };
  }

  // ── Self-thread extraction ─────────────────────────────────────────
  // When a tweet's conversation loads (TweetDetail), the response carries
  // the whole thread. Collect every tweet object, group by conversation,
  // and keep the original author's self-reply chain (root + their
  // follow-ups in order). Cached on the isolated side so a bookmark of
  // the root tweet can be saved as a multi-part thread.
  function collectThreadTweets(node, acc) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) collectThreadTweets(child, acc);
      return;
    }
    const legacy = node.legacy;
    if (legacy && legacy.id_str && legacy.conversation_id_str) {
      const userResult = node.core && node.core.user_results && node.core.user_results.result;
      const authorId = userResult
        && (userResult.rest_id || (userResult.legacy && userResult.legacy.id_str));
      if (authorId) {
        const imageUrls = [];
        const mediaList = (legacy.extended_entities && legacy.extended_entities.media) || [];
        for (const m of mediaList) {
          if (m && m.type === 'photo' && m.media_url_https) {
            imageUrls.push(`${m.media_url_https}?format=jpg&name=large`);
          }
        }
        acc.push({
          id: legacy.id_str,
          conversationId: legacy.conversation_id_str,
          authorId: String(authorId),
          text: legacy.full_text || '',
          imageUrls,
        });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === '__typename') continue;
      collectThreadTweets(node[key], acc);
    }
  }

  // Returns [[rootTweetId, parts[]], ...] for any conversation whose
  // original author posted more than one tweet (a real thread).
  function extractThreads(json) {
    const raw = [];
    collectThreadTweets(json, raw);
    // Dedupe by tweet id (the same tweet can appear in multiple places).
    const byId = new Map();
    for (const t of raw) if (!byId.has(t.id)) byId.set(t.id, t);
    const byConv = new Map();
    for (const t of byId.values()) {
      if (!byConv.has(t.conversationId)) byConv.set(t.conversationId, []);
      byConv.get(t.conversationId).push(t);
    }
    const out = [];
    for (const [convId, list] of byConv) {
      const root = list.find((t) => t.id === convId);
      if (!root) continue;
      const parts = list
        .filter((t) => t.authorId === root.authorId)
        .sort((a, b) => (a.id.length - b.id.length) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((t) => ({ text: t.text, imageUrls: t.imageUrls }));
      if (parts.length > 1) out.push([convId, parts]);
    }
    return out;
  }

  function postThreads(entries) {
    if (!entries || entries.length === 0) return;
    window.postMessage(
      { source: 'gatheros-interceptor', type: 'thread-cache', threads: entries },
      window.location.origin,
    );
  }

  // Map every tweet that quotes another → its quoted tweet, so a manual
  // bookmark click (which reads the DOM, not GraphQL) can still attach
  // the quoted card by tweet id.
  function extractQuotedMap(json) {
    const out = new Map();
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const child of node) walk(child); return; }
      const legacy = node.legacy;
      if (legacy && legacy.id_str && node.quoted_status_result && node.quoted_status_result.result) {
        const q = quotedFromTweet(node);
        if (q && !out.has(legacy.id_str)) out.set(legacy.id_str, q);
      }
      for (const key of Object.keys(node)) {
        if (key === '__typename') continue;
        walk(node[key]);
      }
    }
    walk(json);
    return out;
  }

  function postQuoted(map) {
    if (map.size === 0) return;
    window.postMessage(
      { source: 'gatheros-interceptor', type: 'quoted-cache', quoted: Array.from(map.entries()) },
      window.location.origin,
    );
  }

  function postBookmarks(bookmarks) {
    if (bookmarks.length === 0) return;
    window.postMessage(
      {
        source: 'gatheros-interceptor',
        type: 'bookmark-batch',
        bookmarks,
      },
      window.location.origin,
    );
  }

  function isBookmarksEndpoint(url) {
    return typeof url === 'string' && /\/graphql\/[^/]+\/Bookmarks/.test(url);
  }

  // Returns true when the captured request is the "top of bookmarks
  // list" fetch (no pagination cursor in variables). We save the URL
  // of these as the refresh template the background service worker
  // re-fires on a schedule. Paginated requests (variables contain
  // cursor) are still processed for entry extraction but never saved
  // as the template — re-firing them would only ever return that one
  // page rather than any newly-bookmarked tweets.
  function isTopOfBookmarksRequest(url) {
    try {
      const u = new URL(url);
      const vars = u.searchParams.get('variables');
      if (!vars) return true; // no variables == default top
      const decoded = JSON.parse(vars);
      return !decoded || !decoded.cursor;
    } catch {
      return false;
    }
  }

  // Pull the Authorization header off a wrapped fetch / XHR call so
  // the background service worker can replay the request later. The
  // bearer token x.com uses for its web client has been stable for
  // years but sniffing it is more robust than hardcoding — if X ever
  // rotates it, the next user visit captures the new value
  // automatically. Returns null when no header was attached.
  function readAuthorization(init) {
    if (!init || !init.headers) return null;
    const h = init.headers;
    if (h && typeof h.get === 'function') return h.get('authorization') || h.get('Authorization');
    if (Array.isArray(h)) {
      for (const [k, v] of h) if (k && k.toLowerCase() === 'authorization') return v;
      return null;
    }
    if (typeof h === 'object') {
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'authorization') return h[k];
    }
    return null;
  }

  function postRefreshTemplate(url, authorization) {
    window.postMessage(
      {
        source: 'gatheros-interceptor',
        type: 'bookmark-refresh-template',
        url,
        authorization: authorization || null,
      },
      window.location.origin,
    );
  }

  function shouldIntercept(url) {
    if (typeof url !== 'string') return false;
    // Twitter routes everything through /graphql/ or /api/.../<endpoint>.
    // Be conservative — false positives mean parsing JSON we don't
    // care about, no correctness cost.
    return url.includes('/graphql/') || url.includes('/i/api/');
  }

  // Wrap fetch. Clone the response so the page's own readers see an
  // untouched stream; parse our copy off the main thread.
  const ORIGINAL_FETCH = window.fetch;
  window.fetch = function gatherFetch(...args) {
    const reqUrl = (typeof args[0] === 'string')
      ? args[0]
      : (args[0] && args[0].url) || '';
    const p = ORIGINAL_FETCH.apply(this, args);
    if (!shouldIntercept(reqUrl)) return p;
    p.then((res) => {
      if (!res || !res.ok) return;
      const clone = res.clone();
      clone.json().then((json) => {
        const videoMap = new Map();
        extractTweetVideos(json, videoMap);
        postVideos(videoMap);
        const mediaMap = new Map();
        extractTweetMedia(json, mediaMap);
        postTweetMedia(mediaMap);
        const articleMap = new Map();
        extractTweetArticles(json, articleMap);
        postTweetArticles(articleMap);
        postThreads(extractThreads(json));
        postQuoted(extractQuotedMap(json));
        // Normally only the TOP-of-list bookmarks request drives
        // imports — new bookmarks land at the top, so paginated
        // (deep-scroll) pages only surface history and importing them
        // would flood the library. During an explicit backfill
        // (IMPORT_MODE) we forward every page so old bookmarks import.
        // Video extraction above still runs for every response.
        if (isBookmarksEndpoint(reqUrl)) {
          const top = isTopOfBookmarksRequest(reqUrl);
          if (IMPORT_MODE || top) {
            postBookmarks(extractBookmarkEntries(json));
          }
          if (top) {
            // fetch(Request) puts the headers on args[0]; fetch(url,
            // init) puts them on args[1]. Read both.
            const reqInit = (args[0] && typeof args[0] === 'object' && args[0].headers)
              ? args[0]
              : args[1];
            postRefreshTemplate(reqUrl, readAuthorization(reqInit));
          }
        }
      }).catch(() => { /* non-JSON or parse error — silently ignore */ });
    }).catch(() => { /* fetch error — page-level concern, ignore */ });
    return p;
  };

  // Wrap XMLHttpRequest. X uses fetch in most places but XHR shows up
  // in a few older code paths and the lazy-loaded video player code.
  const XHR_OPEN = XMLHttpRequest.prototype.open;
  const XHR_SET_HEADER = XMLHttpRequest.prototype.setRequestHeader;
  const XHR_SEND = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function gatherXhrOpen(method, url, ...rest) {
    this.__gatherUrl = url;
    this.__gatherHeaders = {};
    return XHR_OPEN.call(this, method, url, ...rest);
  };
  // Capture every header the page sets so we can replay Authorization
  // (and friends) on background-polled refreshes later. The page
  // doesn't see our hooked map — we just record values as they pass
  // through and then forward them along to the real setter.
  XMLHttpRequest.prototype.setRequestHeader = function gatherXhrSetHeader(name, value) {
    if (this.__gatherHeaders && typeof name === 'string') {
      this.__gatherHeaders[name.toLowerCase()] = value;
    }
    return XHR_SET_HEADER.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function gatherXhrSend(...args) {
    this.addEventListener('load', () => {
      if (!shouldIntercept(this.__gatherUrl)) return;
      try {
        const json = JSON.parse(this.responseText);
        const videoMap = new Map();
        extractTweetVideos(json, videoMap);
        postVideos(videoMap);
        const mediaMap = new Map();
        extractTweetMedia(json, mediaMap);
        postTweetMedia(mediaMap);
        const articleMap = new Map();
        extractTweetArticles(json, articleMap);
        postTweetArticles(articleMap);
        postThreads(extractThreads(json));
        postQuoted(extractQuotedMap(json));
        // Same gate as the fetch path: top-of-list always, every page
        // during an explicit backfill (IMPORT_MODE).
        if (isBookmarksEndpoint(this.__gatherUrl)) {
          const top = isTopOfBookmarksRequest(this.__gatherUrl);
          if (IMPORT_MODE || top) {
            postBookmarks(extractBookmarkEntries(json));
          }
          if (top) {
            const auth = this.__gatherHeaders && this.__gatherHeaders.authorization;
            postRefreshTemplate(this.__gatherUrl, auth || null);
          }
        }
      } catch { /* non-JSON or parse error */ }
    });
    return XHR_SEND.apply(this, args);
  };
})();
