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

// The cosmos.so mark: six dots in a hexagonal ring. Fill-based; sized by CSS
// like the other source glyphs (the non-square viewBox stays undistorted via
// the default xMidYMid preserveAspectRatio).
function CosmosGlyph() {
  return (
    <svg viewBox="0 0 38 42" fill="currentColor" aria-hidden="true">
      <circle cx="19.02" cy="5.95" r="5.95" />
      <circle cx="19.02" cy="35.99" r="5.95" />
      <circle cx="5.97" cy="13.46" r="5.95" />
      <circle cx="32.08" cy="13.46" r="5.95" />
      <circle cx="5.97" cy="28.48" r="5.95" />
      <circle cx="32.08" cy="28.48" r="5.95" />
    </svg>
  );
}

// Instagram glyph — drawn stroke-based (sized by CSS like XGlyph) so an
// Instagram save's card reads as Instagram, not X.
function InstagramGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="20" x="2" y="2" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

// Live, theme-aware render of a saved tweet/post from its tweet_meta.
// Used at two sizes: 'grid' (compact, inside an ImageCard frame) and
// 'focus' (standalone card on the focused-view stage). Renders real,
// selectable text — the captured PNG is only a thumbnail/export fallback.
// `source` ('x' | 'instagram') picks the corner glyph + open label.
export default function TweetCard({
  meta, variant = 'grid', onOpenX = null, source = 'x',
  // Given a handle, filter the library to that account. Only wired where
  // the card isn't itself a click target — on a grid card the click would
  // race the card's own open-the-save handler.
  onOpenAuthor = null,
}) {
  const [avatarOk, setAvatarOk] = useState(true);
  if (!meta) return null;
  const isIg = source === 'instagram';
  const isCosmos = source === 'cosmos';
  const SourceGlyph = isCosmos ? CosmosGlyph : isIg ? InstagramGlyph : XGlyph;
  const openLabel = isCosmos ? 'Open on Cosmos' : isIg ? 'Open on Instagram' : 'Open on X';

  const name = (meta.authorName || meta.authorHandle || 'Unknown').trim();
  const handleRaw = (meta.authorHandle || '').trim();
  const handle = handleRaw ? (handleRaw.startsWith('@') ? handleRaw : `@${handleRaw}`) : '';
  const caption = meta.caption || '';
  const avatarUrl = (typeof meta.authorAvatarUrl === 'string' && /^https?:\/\//i.test(meta.authorAvatarUrl))
    ? meta.authorAvatarUrl
    : '';
  const initials = (name.replace(/^@/, '').trim().slice(0, 1) || '?').toUpperCase();
  const isThread = Array.isArray(meta.thread) && meta.thread.length > 1;
  // The grid card truncates (line-clamp + ellipsis); the focused card
  // shows everything.
  const compact = variant !== 'focus';

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
        <span
          className={`${styles.id}${onOpenAuthor && handle ? ` ${styles.idLink}` : ''}`}
          {...(onOpenAuthor && handle ? {
            role: 'button',
            tabIndex: 0,
            title: `Show everything saved from ${handle}`,
            // The name and handle stay selectable text, so only treat this
            // as a click when the user hasn't just finished a selection.
            onClick: (e) => {
              if (!window.getSelection()?.isCollapsed) return;
              e.stopPropagation();
              onOpenAuthor(handle);
            },
            onKeyDown: (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              onOpenAuthor(handle);
            },
          } : {})}
        >
          <span className={styles.name} data-tweet-selectable>{name}</span>
          {handle && <span className={styles.handle} data-tweet-selectable>{handle}</span>}
        </span>
        {onOpenX ? (
          <button type="button" className={styles.xBtn} title={openLabel} onClick={onOpenX}>
            <SourceGlyph />
          </button>
        ) : (
          <span className={styles.x} aria-hidden="true"><SourceGlyph /></span>
        )}
      </div>
      {isThread ? (
        compact ? (
          // Grid: just the thread's first tweet, clamped, with a count.
          <>
            <div className={`${styles.text} ${styles.clamp}`} data-tweet-selectable>
              {(meta.thread[0]?.text || caption || '').trim()}
            </div>
            <div className={styles.threadMore}>{`Thread · ${meta.thread.length} tweets`}</div>
          </>
        ) : (
          <div className={styles.thread}>
            {meta.thread.map((part, i) => (
              (part?.text || '').trim() ? (
                <div key={i} className={styles.threadPart} data-tweet-selectable>{part.text}</div>
              ) : null
            ))}
          </div>
        )
      ) : (
        caption && (
          <div
            className={`${styles.text}${compact ? ` ${styles.clamp}` : ''}`}
            data-tweet-selectable
          >
            {caption}
          </div>
        )
      )}
      {meta.quoted && (meta.quoted.caption || meta.quoted.authorName) && (
        <div className={styles.quoted}>
          <div className={styles.quotedHead}>
            {meta.quoted.authorName && (
              <span className={styles.quotedName} data-tweet-selectable>{meta.quoted.authorName}</span>
            )}
            {meta.quoted.authorHandle && (
              <span className={styles.quotedHandle} data-tweet-selectable>{meta.quoted.authorHandle}</span>
            )}
          </div>
          {meta.quoted.caption && (
            <div
              className={`${styles.quotedText}${compact ? ` ${styles.clamp}` : ''}`}
              data-tweet-selectable
            >
              {meta.quoted.caption}
            </div>
          )}
          {Array.isArray(meta.quoted.imageUrls) && meta.quoted.imageUrls.length > 0 && (
            <img
              className={styles.quotedImg}
              src={meta.quoted.imageUrls[0]}
              alt=""
              draggable={false}
              loading="lazy"
            />
          )}
        </div>
      )}
    </div>
  );
}
