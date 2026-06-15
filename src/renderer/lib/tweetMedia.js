// Ordered media for a tweet save — shared by the focused view's main
// stage and the detail panel's thumbnail strip so their indexes always
// agree (index === altImageIdx).
//
// Image tweets: the saved primary is imageUrls[0] (stored locally on
// disk); the rest are remote twimg URLs.
//
// Video tweets: the saved primary is the *video* itself
// (record.file_path, kind='video'); any photos on the tweet follow it.
// The video is NOT part of imageUrls, so it has to be prepended —
// otherwise the strip and the stage disagree and clicking a thumbnail
// can't switch off the video.
export function tweetMediaItems(record, tweetMeta) {
  const urls = Array.isArray(tweetMeta?.imageUrls) ? tweetMeta.imageUrls : [];
  if (record?.kind === 'video') {
    return [{ type: 'video' }, ...urls.map((url) => ({ type: 'image', url }))];
  }
  return urls.map((url, i) => ({ type: 'image', url, primary: i === 0 }));
}

// Rewrite a twimg URL to its 'large' variant for crisper display. Only
// the name= param is touched (format= is left as captured — synthesizing
// it broke non-JPEG tweets). A no-op on non-twimg / unparseable URLs.
export function twimgLarge(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('name', 'large');
    return u.toString();
  } catch {
    return url;
  }
}
