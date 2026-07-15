const X_SNOWFLAKE_EPOCH_MS = 1288834974657n;

function deriveXTweetCreatedAt(pageUrl) {
  if (typeof pageUrl !== 'string') return null;
  const match = pageUrl.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/(\d+)(?:[/?#]|$)/i);
  if (!match) return null;
  try {
    const timestamp = Number((BigInt(match[1]) >> 22n) + X_SNOWFLAKE_EPOCH_MS);
    return Number.isSafeInteger(timestamp) && timestamp > Number(X_SNOWFLAKE_EPOCH_MS)
      ? timestamp
      : null;
  } catch {
    return null;
  }
}

module.exports = { deriveXTweetCreatedAt };
