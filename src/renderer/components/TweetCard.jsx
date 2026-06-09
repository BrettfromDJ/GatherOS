import React, { useState } from 'react';
import styles from './TweetCard.module.css';

// Official X glyph — same path the grid source badge + DetailPanel use.
function XGlyph() {
  return (
    <svg viewBox="0 0 1200 1227" fill="currentColor" aria-hidden="true">
      <path d="M714 519L1161 0h-106L667 451 357 0H0l469 682L0 1226h106l410-476 327 476h357L714 519zM569 688l-47-68L144 80h163l305 436 48 68 396 567H892L569 688z" />
    </svg>
  );
}

// Live, theme-aware render of a saved tweet from its tweet_meta. Used
// at two sizes: 'grid' (compact, inside an ImageCard frame) and 'focus'
// (standalone card on the focused-view stage). Renders real, selectable
// text — the captured PNG is only a thumbnail/export fallback.
export default function TweetCard({ meta, variant = 'grid', onOpenX = null }) {
  const [avatarOk, setAvatarOk] = useState(true);
  if (!meta) return null;

  const name = (meta.authorName || meta.authorHandle || 'Unknown').trim();
  const handleRaw = (meta.authorHandle || '').trim();
  const handle = handleRaw ? (handleRaw.startsWith('@') ? handleRaw : `@${handleRaw}`) : '';
  const caption = meta.caption || '';
  const avatarUrl = (typeof meta.authorAvatarUrl === 'string' && /^https?:\/\//i.test(meta.authorAvatarUrl))
    ? meta.authorAvatarUrl
    : '';
  const initials = (name.replace(/^@/, '').trim().slice(0, 1) || '?').toUpperCase();

  return (
    <div className={`${styles.card} ${variant === 'focus' ? styles.focus : styles.grid}`}>
      <div className={styles.head}>
        <span className={styles.avatar}>
          <span className={styles.initials} aria-hidden="true">{initials}</span>
          {avatarUrl && avatarOk && (
            <img
              className={styles.avatarImg}
              src={avatarUrl}
              alt=""
              draggable={false}
              onError={() => setAvatarOk(false)}
            />
          )}
        </span>
        <span className={styles.id}>
          <span className={styles.name} data-tweet-selectable>{name}</span>
          {handle && <span className={styles.handle} data-tweet-selectable>{handle}</span>}
        </span>
        {onOpenX ? (
          <button type="button" className={styles.xBtn} title="Open on X" onClick={onOpenX}>
            <XGlyph />
          </button>
        ) : (
          <span className={styles.x} aria-hidden="true"><XGlyph /></span>
        )}
      </div>
      {caption && <div className={styles.text} data-tweet-selectable>{caption}</div>}
    </div>
  );
}
