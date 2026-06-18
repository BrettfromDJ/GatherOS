// Ordered media for a tweet / saved-post — shared by the focused view's
// main stage, the detail panel's thumbnail strip, and the grid card so
// their indexes always agree (index === altImageIdx).
//
// Two shapes feed this:
//
//   • Legacy / X: tweetMeta.imageUrls is a flat list of remote image
//     URLs; a video tweet stores its single video as the local primary
//     (record.file_path, kind='video') and any photos follow it.
//
//   • Rich (e.g. Instagram carousels): tweetMeta.media is an explicit
//     ordered list — [{ type:'image'|'video', url, poster }, …] — which
//     can describe MORE THAN ONE video in a single save. Item 0 is the
//     locally-downloaded primary (image or video); every other item is
//     streamed from its url so secondary videos actually play instead of
//     showing a frozen poster.
//
// Render shape returned here:
//   image: { type:'image', url, primary }
//   video: { type:'video', url|null, poster, primaryLocal }
// `primaryLocal` (or a video item with no url) means "use the on-disk
// record.file_path"; otherwise play/show from `url`.
export function tweetMediaItems(record, tweetMeta) {
  const list = Array.isArray(tweetMeta?.media) ? tweetMeta.media : null;
  if (list && list.length) {
    return list.map((m, i) => {
      if (m && m.type === 'video') {
        // Only one item is backed by the downloaded file — index 0 when
        // the save itself is a video (kind='video'). Any other video
        // streams from its remote url.
        const primaryLocal = i === 0 && record?.kind === 'video';
        return {
          type: 'video',
          url: primaryLocal ? null : (m.url || null),
          poster: m.poster || null,
          primaryLocal,
        };
      }
      const primary = i === 0 && record?.kind !== 'video';
      return { type: 'image', url: (m && m.url) || '', primary };
    });
  }

  // Legacy / X path — imageUrls only, single (local) video.
  const urls = Array.isArray(tweetMeta?.imageUrls) ? tweetMeta.imageUrls : [];
  if (record?.kind === 'video') {
    return [{ type: 'video', primaryLocal: true }, ...urls.map((url) => ({ type: 'image', url }))];
  }
  return urls.map((url, i) => ({ type: 'image', url, primary: i === 0 }));
}

// Rewrite a twimg URL to its 'large' variant for crisper display. Only
// the name= param is touched (format= is left as captured — synthesizing
// it broke non-JPEG tweets). A no-op on non-twimg / unparseable URLs.
export function twimgLarge(url) {
  try {
    const u = new URL(url);
    // Only twimg serves name= variants. Leave everything else untouched —
    // notably Instagram CDN URLs and local moodmark-file:// URLs, which an
    // appended name= param would corrupt.
    if (!/(^|\.)twimg\.com$/i.test(u.hostname)) return url;
    u.searchParams.set('name', 'large');
    return u.toString();
  } catch {
    return url;
  }
}
