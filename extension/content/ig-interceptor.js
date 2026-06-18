// MAIN-world script — runs in instagram.com's own JavaScript context.
// Instagram's saved-posts feed (the bookmark equivalent of X) is only
// available inside the response bodies of its own network calls: the
// REST endpoints under /api/v1/feed/saved/ and the GraphQL queries at
// /graphql/query and /api/graphql. An isolated-world content script
// can't read responses to fetches the page itself initiates, so — just
// like the X interceptor — we wrap fetch + XMLHttpRequest here at the
// page's own privilege level and forward what we parse to the isolated
// world via window.postMessage.
//
// Cheap by design: we only parse JSON for URLs that look like a saved
// feed, and read each body from a .clone() so the page's own consumers
// are never disturbed.
//
// P0 NOTE: Instagram changes its endpoints and response shapes more
// often than X. The extraction below handles the shapes seen as of this
// writing (REST `media` items + GraphQL nodes), but is deliberately
// defensive — it walks the response for anything media-shaped rather
// than hard-coding a single path. When GATHEROS_IG_DEBUG is on it logs
// a one-line summary of every saved-feed response it sees (endpoint +
// post count) so the real shape can be confirmed against a live
// account and the parser locked down.

(function gatherIgInterceptor() {
  if (window.__GATHEROS_IG_INTERCEPTOR__) return;
  window.__GATHEROS_IG_INTERCEPTOR__ = true;

  // Flip on from the devtools console (window.GATHEROS_IG_DEBUG = true)
  // to log saved-feed responses. Off by default so normal browsing
  // stays quiet.
  const debugOn = () => !!window.GATHEROS_IG_DEBUG;

  // Discovery aid: when debug is on, log EVERY apiish request the page
  // makes (not just the ones our matcher recognizes) so the real
  // saved-feed endpoint can be spotted against a live account even if
  // shouldIntercept() doesn't match it yet. Noisy by design — only
  // active while GATHEROS_IG_DEBUG is set.
  function debugSawRequest(url) {
    if (!debugOn() || typeof url !== 'string') return;
    if (/\/api\/|\/graphql|saved|collection/i.test(url)) {
      // eslint-disable-next-line no-console
      console.log('[gatheros-ig] request:', url, '| matched=', shouldIntercept(url));
    }
  }

  // Backfill switch — same contract as the X interceptor. Normal
  // browsing only imports the TOP of the saved feed (newest); the
  // isolated-world watcher flips this on during an explicit "Import
  // saved" run so deep-scroll (cursor-paginated) pages flow through too.
  let IMPORT_MODE = false;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== 'gatheros-ig-control') return;
    if (d.type === 'import-mode') IMPORT_MODE = !!d.on;
  });

  // ── Saved-feed endpoint detection ──────────────────────────────────
  // REST: /api/v1/feed/saved/posts/, /api/v1/feed/saved/, and
  //       /api/v1/feed/collection/<id>/posts/ (a named saved collection).
  // GraphQL: /graphql/query or /api/graphql carrying a saved-media query.
  // The GraphQL body doesn't reveal "saved-ness" from the URL, so for
  // those we rely on the response actually containing saved-feed
  // connection keys (checked in extractSavedPosts via the walk).
  function isSavedRestEndpoint(url) {
    if (typeof url !== 'string') return false;
    return /\/api\/v1\/feed\/saved\//.test(url)
      || /\/api\/v1\/feed\/collection\/[^/]+\/(posts|all_media)\//.test(url);
  }
  function isGraphqlEndpoint(url) {
    return typeof url === 'string'
      && (/\/graphql\/query/.test(url) || /\/api\/graphql/.test(url));
  }
  function shouldIntercept(url) {
    return isSavedRestEndpoint(url) || isGraphqlEndpoint(url);
  }

  // Top-of-feed vs paginated. REST uses ?max_id=<cursor>; GraphQL puts
  // an `after` cursor in the `variables` form field (which we can't see
  // on the URL for POSTs), so GraphQL pages are treated as top unless a
  // max_id is present. During IMPORT_MODE every page is forwarded
  // regardless, so this only gates passive browsing.
  function isTopOfFeedRequest(url) {
    try {
      const u = new URL(url, window.location.origin);
      return !u.searchParams.get('max_id') && !u.searchParams.get('cursor');
    } catch {
      return true;
    }
  }

  // Pick the best (largest) image URL from an image_versions2 candidate
  // list, falling back to common single-URL fields.
  function bestImageUrl(node) {
    const cands = node
      && node.image_versions2
      && Array.isArray(node.image_versions2.candidates)
      ? node.image_versions2.candidates
      : null;
    if (cands && cands.length) {
      // Candidates are ordered largest-first by IG, but sort defensively.
      let best = cands[0];
      for (const c of cands) {
        if (c && typeof c.width === 'number' && c.width > (best.width || 0)) best = c;
      }
      if (best && best.url) return best.url;
    }
    // GraphQL / legacy single-URL shapes.
    return node.display_url || node.thumbnail_url || node.thumbnail_src || '';
  }

  function bestVideoUrl(node) {
    if (Array.isArray(node.video_versions) && node.video_versions.length) {
      let best = node.video_versions[0];
      for (const v of node.video_versions) {
        if (v && typeof v.width === 'number' && v.width > (best.width || 0)) best = v;
      }
      if (best && best.url) return best.url;
    }
    return node.video_url || '';
  }

  // A media item's children, across the REST (`carousel_media`) and
  // GraphQL (`edge_sidecar_to_children.edges[].node`) shapes.
  function carouselChildren(node) {
    if (Array.isArray(node.carousel_media)) return node.carousel_media;
    const edges = node.edge_sidecar_to_children
      && Array.isArray(node.edge_sidecar_to_children.edges)
      ? node.edge_sidecar_to_children.edges
      : null;
    if (edges) return edges.map((e) => e && e.node).filter(Boolean);
    return null;
  }

  function isVideoNode(node) {
    // REST media_type: 1=image, 2=video, 8=carousel. GraphQL: is_video.
    return node.media_type === 2
      || node.is_video === true
      || (Array.isArray(node.video_versions) && node.video_versions.length > 0);
  }

  function captionOf(node) {
    if (node.caption && typeof node.caption.text === 'string') return node.caption.text;
    if (typeof node.caption === 'string') return node.caption;
    const edges = node.edge_media_to_caption
      && Array.isArray(node.edge_media_to_caption.edges)
      ? node.edge_media_to_caption.edges
      : null;
    if (edges && edges[0] && edges[0].node && typeof edges[0].node.text === 'string') {
      return edges[0].node.text;
    }
    return '';
  }

  function ownerOf(node) {
    const u = node.user || node.owner || {};
    return {
      username: u.username || '',
      fullName: u.full_name || u.fullName || '',
      avatarUrl: u.profile_pic_url || u.profile_pic_url_hd || '',
    };
  }

  // Normalize one IG media node (image / video / carousel child) into a
  // single media item: { type, url, poster }. For a video, url is the
  // playable MP4 and poster is the still frame.
  function mediaItemOf(node) {
    if (isVideoNode(node)) {
      return { type: 'video', url: bestVideoUrl(node) || '', poster: bestImageUrl(node) || '' };
    }
    return { type: 'image', url: bestImageUrl(node) || '' };
  }

  // Normalize a saved post into the GatherOS save shape. `media` is an
  // explicit ordered list (locked default #1: one save per post, extra
  // media in metadata) that can hold multiple videos — the renderer
  // pages through it and streams secondary videos so they play instead
  // of showing a frozen poster. `imageUrls` is kept (stills only) for
  // the back-compat consumers (primary image download + count). The
  // FIRST item decides the downloaded primary: a leading video routes
  // through videoUrl/posterUrl (saveVideoFromUrl); otherwise the first
  // still is the primary image.
  function parseSavedMedia(node) {
    const shortcode = node.code || node.shortcode;
    const postId = node.pk || node.id || shortcode;
    if (!shortcode && !postId) return null;
    const owner = ownerOf(node);
    const permalink = `https://www.instagram.com/p/${shortcode || postId}/`;
    const children = carouselChildren(node);

    let media = [];
    if (children && children.length) {
      media = children.map(mediaItemOf).filter((m) => m.url);
    } else {
      const item = mediaItemOf(node);
      if (item.url) media = [item];
    }

    // Stills only — posters stand in for video items so the thumbnail
    // strip + primary-image fallback still work.
    const imageUrls = media.map((m) => (m.type === 'video' ? m.poster : m.url)).filter(Boolean);

    // Primary download routing, off the first item.
    let videoUrl = null;
    let posterUrl = '';
    if (media[0] && media[0].type === 'video') {
      videoUrl = media[0].url || null;
      posterUrl = media[0].poster || '';
    }

    const caption = captionOf(node);
    if (media.length === 0 && !caption.trim()) return null;

    return {
      postId: String(postId),
      shortcode: shortcode || '',
      tweetUrl: permalink, // reuse the X field name so the relay/background path is shared
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

  // Does this object look like a saved media item we can parse? Used to
  // drive the recursive walk without hard-coding a single response path.
  function looksLikeMedia(node) {
    if (!node || typeof node !== 'object') return false;
    const hasCode = typeof node.code === 'string' || typeof node.shortcode === 'string';
    const hasMedia = !!node.image_versions2
      || !!node.display_url
      || Array.isArray(node.carousel_media)
      || !!node.edge_sidecar_to_children
      || Array.isArray(node.video_versions)
      || typeof node.video_url === 'string';
    return hasCode && hasMedia;
  }

  // Walk the whole response collecting saved media. Dedup by postId so a
  // node that appears in multiple places counts once. We avoid recursing
  // into a media node's own children (we parse those inside
  // parseSavedMedia) so a carousel stays one save.
  function extractSavedPosts(json) {
    const out = [];
    const seen = new Set();
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const c of node) walk(c); return; }
      if (looksLikeMedia(node)) {
        const parsed = parseSavedMedia(node);
        if (parsed && !seen.has(parsed.postId)) {
          seen.add(parsed.postId);
          out.push(parsed);
        }
        return; // don't descend into this media's own sub-media
      }
      for (const key of Object.keys(node)) {
        if (key === '__typename') continue;
        walk(node[key]);
      }
    }
    walk(json);
    return out;
  }

  function postSaved(posts) {
    if (!posts.length) return;
    window.postMessage(
      { source: 'gatheros-ig-interceptor', type: 'saved-batch', posts },
      window.location.origin,
    );
  }

  // ── Replay template (background poll, X-style) ─────────────────────
  // Instagram's saved feed is server-side, and desktop Chrome holds the
  // user's instagram.com session — so the background worker can re-fire
  // the top-of-saved request on a timer/focus and pick up posts the user
  // saved on their phone, without a Saved-page visit. We capture the
  // request URL + the IG private-API headers here so the worker can
  // replay it (the session cookies + a fresh csrftoken come from the
  // cookie store on the worker side). Self-healing: a stale template is
  // refreshed on the next real Saved-page visit, same as X's bearer.
  const IG_REPLAY_HEADERS = [
    'x-ig-app-id', 'x-csrftoken', 'x-ig-www-claim',
    'x-asbd-id', 'x-requested-with', 'x-ig-nav-chain',
  ];
  function readIgHeaders(init) {
    const out = {};
    if (!init || !init.headers) return out;
    const h = init.headers;
    const get = (k) => {
      if (h && typeof h.get === 'function') return h.get(k);
      if (Array.isArray(h)) {
        for (const [hk, hv] of h) if (hk && hk.toLowerCase() === k) return hv;
        return null;
      }
      if (typeof h === 'object') {
        for (const hk of Object.keys(h)) if (hk.toLowerCase() === k) return h[hk];
      }
      return null;
    };
    for (const k of IG_REPLAY_HEADERS) { const v = get(k); if (v) out[k] = v; }
    return out;
  }
  function postIgRefreshTemplate(url, headers) {
    // Absolutize — Instagram often issues relative request URLs, and the
    // background worker's fetch needs a full URL to replay.
    let abs = url;
    try { abs = new URL(url, window.location.origin).href; } catch { /* keep as-is */ }
    window.postMessage(
      { source: 'gatheros-ig-interceptor', type: 'saved-refresh-template', url: abs, headers: headers || {} },
      window.location.origin,
    );
  }

  // Shared handler for both fetch + XHR captures.
  function handleResponse(url, json) {
    const posts = extractSavedPosts(json);
    if (debugOn()) {
      // One-line summary to confirm endpoint + shape against a live
      // account during P0 bring-up.
      // eslint-disable-next-line no-console
      console.log('[gatheros-ig] saw', posts.length, 'saved post(s) from', url, posts.slice(0, 2));
    }
    if (posts.length === 0) return; // not a saved-feed response (most graphql calls)
    if (IMPORT_MODE || isTopOfFeedRequest(url)) {
      postSaved(posts);
    }
  }

  const ORIGINAL_FETCH = window.fetch;
  window.fetch = function gatherIgFetch(...args) {
    const reqUrl = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url) || '';
    debugSawRequest(reqUrl);
    const p = ORIGINAL_FETCH.apply(this, args);
    if (!shouldIntercept(reqUrl)) return p;
    // Capture a replay template off the top-of-saved REST request so the
    // background worker can re-fire it on a timer/focus (mobile-save sync).
    if (isSavedRestEndpoint(reqUrl) && isTopOfFeedRequest(reqUrl)) {
      const init = (args[0] && typeof args[0] === 'object' && args[0].headers) ? args[0] : args[1];
      postIgRefreshTemplate(reqUrl, readIgHeaders(init));
    }
    p.then((res) => {
      if (!res || !res.ok) return;
      res.clone().json()
        .then((json) => handleResponse(reqUrl, json))
        .catch(() => { /* non-JSON / parse error — ignore */ });
    }).catch(() => { /* fetch error — page concern */ });
    return p;
  };

  const XHR_OPEN = XMLHttpRequest.prototype.open;
  const XHR_SET_HEADER = XMLHttpRequest.prototype.setRequestHeader;
  const XHR_SEND = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function gatherIgXhrOpen(method, url, ...rest) {
    this.__gatherIgUrl = url;
    this.__gatherIgHeaders = {};
    return XHR_OPEN.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function gatherIgXhrSetHeader(name, value) {
    if (this.__gatherIgHeaders && typeof name === 'string'
      && IG_REPLAY_HEADERS.includes(name.toLowerCase())) {
      this.__gatherIgHeaders[name.toLowerCase()] = value;
    }
    return XHR_SET_HEADER.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function gatherIgXhrSend(...args) {
    debugSawRequest(this.__gatherIgUrl);
    if (isSavedRestEndpoint(this.__gatherIgUrl) && isTopOfFeedRequest(this.__gatherIgUrl)) {
      postIgRefreshTemplate(this.__gatherIgUrl, this.__gatherIgHeaders || {});
    }
    this.addEventListener('load', () => {
      if (!shouldIntercept(this.__gatherIgUrl)) return;
      try {
        handleResponse(this.__gatherIgUrl, JSON.parse(this.responseText));
      } catch { /* non-JSON / parse error */ }
    });
    return XHR_SEND.apply(this, args);
  };
})();
