// Derive a bookmark's tweet type from its stored tweet_meta JSON.
// Bookmarks are X saves that carry tweet_meta: text-only tweets are
// saved as kind='tweet', while image / video tweets carry an imageUrls
// array or a videoUrl. We key purely off the meta so the three types
// stay consistent regardless of how the underlying media was stored.
//
// Returns 'text' | 'image' | 'video', or null when the save isn't a
// tweet (no tweet_meta) — callers use that to skip non-bookmark saves.
export function tweetTypeOf(record) {
  if (!record || !record.tweet_meta) return null;
  let meta;
  try { meta = JSON.parse(record.tweet_meta); }
  catch { return null; }
  if (!meta || typeof meta !== 'object') return null;
  if (meta.videoUrl) return 'video';
  if (Array.isArray(meta.imageUrls) && meta.imageUrls.length > 0) return 'image';
  return 'text';
}

// Segments for the Bookmarks type filter, in display order. 'all' is
// the no-op default; the rest map 1:1 to tweetTypeOf's return values.
export const TWEET_TYPES = [
  { id: 'all', label: 'All' },
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
];
