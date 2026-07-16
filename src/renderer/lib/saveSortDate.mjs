export function getSaveSortDate(record, useTweetDateForXBookmarks = false) {
  const fallback = Number.isFinite(record?.created_at) ? record.created_at : 0;
  if (!useTweetDateForXBookmarks || record?.source !== 'x' || !record?.tweet_meta) {
    return fallback;
  }

  try {
    const meta = typeof record.tweet_meta === 'string'
      ? JSON.parse(record.tweet_meta)
      : record.tweet_meta;
    const tweetCreatedAt = Number(meta?.tweetCreatedAt);
    return Number.isFinite(tweetCreatedAt) && tweetCreatedAt > 0
      ? tweetCreatedAt
      : fallback;
  } catch {
    return fallback;
  }
}
