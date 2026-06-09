import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ImageCard.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import TweetCard from './TweetCard.jsx';

// Official-ish X glyph — used as a source badge in the bottom-left
// of cards whose save was captured via the X bookmark watcher. Same
// path the DetailPanel tweet card uses; copied here to avoid an
// import cycle / cross-component dependency for a single SVG.
function XGlyphIcon() {
  return (
    <svg
      viewBox="0 0 1200 1227"
      width="11"
      height="11"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M714 519L1161 0h-106L667 451 357 0H0l469 682L0 1226h106l410-476 327 476h357L714 519zM569 688l-47-68L144 80h163l305 436 48 68 396 567H892L569 688z" />
    </svg>
  );
}

// Two overlapping frames — "multiple images" indicator for the count
// badge on a tweet saved with more than one photo.
function CopiesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
      <path
        d="M3 7.2 L6 10 L11 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Four-corner brackets — reads as "expand to fill" / "open peek".
function PeekIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6 V3 H6" />
      <path d="M13 6 V3 H10" />
      <path d="M3 10 V13 H6" />
      <path d="M13 10 V13 H10" />
    </svg>
  );
}

export default function ImageCard({
  record,
  selected,
  selectionActive,
  onSelect,
  onOpen,
  onContextMenu,
  onDragStart,
  onHover,
  onForceClick,
  fresh,
  staggerMs = 0,
  morphSource = false,
}) {
  const src = fileUrl(record.file_path);
  const aspect =
    record.width && record.height ? record.width / record.height : 4 / 3;

  // Parse tweet_meta once: text-tweet saves (kind='tweet') render a
  // live card from it; media tweets use imageUrls only for the
  // multi-image count badge.
  const tweetMeta = (() => {
    if (!record.tweet_meta) return null;
    try { return JSON.parse(record.tweet_meta); }
    catch { return null; }
  })();
  const isTweet = record.kind === 'tweet' && !!tweetMeta;
  const tweetImageCount = Array.isArray(tweetMeta?.imageUrls) ? tweetMeta.imageUrls.length : 0;

  // Pointer-down position, captured to tell a highlight drag (the pointer
  // moves) from a click (it doesn't). On a tweet card we suppress the
  // open only when the gesture actually moved — so a lingering text
  // selection never blocks a fresh click into the card.
  const pressPosRef = useRef(null);
  const movedSincePress = (e) => {
    const p = pressPosRef.current;
    if (!p) return false;
    return Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 6;
  };

  // Capture `fresh` at mount and keep it. The parent clears the fresh
  // flag ~1.5s after a save lands; if we drove the class off the live
  // prop, removing `.fresh` would revert the card's animation to the
  // base cardIn and replay the entrance. Locking it in plays it once.
  const [enteredFresh] = useState(() => !!fresh);

  // Hover-triggered lightbox preview. Open after the user has
  // intentionally hovered the icon for OPEN_DELAY ms — keeps
  // accidental cursor passes from popping the lightbox. Once open,
  // a brief CLOSE_GRACE window lets the cursor travel from the icon
  // to the image without dismissing.
  const OPEN_DELAY = 220;
  const CLOSE_GRACE = 150;
  const [peeking, setPeeking] = useState(false);
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);

  const cancelOpen = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };
  const scheduleOpen = () => {
    cancelOpen();
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      setPeeking(true);
    }, OPEN_DELAY);
  };
  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = (delay) => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      setPeeking(false);
      closeTimerRef.current = null;
    }, delay);
  };

  useEffect(() => () => { cancelOpen(); cancelClose(); }, []);

  // Force Touch on macOS — the trackpad fires webkitmouseforceclick
  // when the user presses harder past the second click stage. React
  // doesn't have a synthetic for this WebKit-only event, so we
  // attach via ref. Treats it as a request to peek the card,
  // matching Mac convention (Force Click on Finder = Quick Look).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !onForceClick) return undefined;
    const handler = (e) => {
      e.preventDefault();
      onForceClick(record.id);
    };
    el.addEventListener('webkitmouseforceclick', handler);
    return () => el.removeEventListener('webkitmouseforceclick', handler);
  }, [onForceClick, record.id]);

  // Render windowing: hold the inner image + chrome out of the DOM
  // until the card scrolls within ~600px of the viewport. The outer
  // <button> with its aspect-ratio'd frame always renders so the
  // masonry layout doesn't reflow. Once a card has been seen, it
  // stays mounted — avoids re-mount flicker on scroll-back.
  const wrapperRef = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (inView) return undefined;
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setInView(true);
          obs.disconnect();
          return;
        }
      }
    }, { rootMargin: '600px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  // Brief "spring-back" pulse when a drag is released without a
  // successful drop. e.dataTransfer.dropEffect === 'none' on dragend
  // means the OS-level drop didn't land anywhere accepting; we
  // bounce the source card so the user feels the snap-back instead
  // of the card silently going un-changed.
  const [springback, setSpringback] = useState(false);
  const springTimerRef = useRef(null);
  useEffect(() => () => {
    if (springTimerRef.current) clearTimeout(springTimerRef.current);
  }, []);

  // Pending placeholders are read-only: no select / open / drag /
  // context menu — the card is a transient affordance, not a real
  // library entry. The id is a `pending-*` synthetic that the
  // backend doesn't know about; firing these would break.
  const isPending = !!record.__pending;
  // Pre-generate the rising-particle field for pending cards: random
  // x positions, sizes, durations, delays, and horizontal sway so
  return (
    <button
      ref={wrapperRef}
      type="button"
      data-save-id={record.id}
      data-save-title={record.title || undefined}
      draggable={!isPending && !!onDragStart}
      className={[
        styles.card,
        selected && styles.selected,
        selectionActive && styles.showSelectables,
        enteredFresh && styles.fresh,
        springback && styles.springback,
        isPending && styles.cardPending,
      ].filter(Boolean).join(' ')}
      style={staggerMs ? { '--card-stagger': `${staggerMs}ms` } : undefined}
      onClick={isPending ? undefined : (e) => {
        // The click that ends a tweet-text highlight drag must not open
        // the card — detected by pointer movement, not by selection
        // state, so a leftover highlight never blocks a fresh click.
        if (isTweet && movedSincePress(e)) return;
        onSelect(record.id, e.metaKey || e.ctrlKey || e.shiftKey);
      }}
      onDoubleClick={isPending ? undefined : () => onOpen(record)}
      onMouseEnter={isPending ? undefined : () => onHover?.(record.id)}
      onMouseLeave={isPending ? undefined : () => onHover?.(null, record.id)}
      onContextMenu={isPending ? undefined : (e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(record.id, e.clientX, e.clientY);
        }
      }}
      onMouseDown={isPending ? undefined : (e) => {
        pressPosRef.current = { x: e.clientX, y: e.clientY };
        // Tweet cards carry selectable text. A draggable element wins the
        // gesture before any selection can start, so when the press lands
        // on that text we switch the card's native drag OFF for this
        // gesture — letting the browser select text instead. Toggling the
        // DOM attribute synchronously here beats React's async re-render,
        // so it's in effect before the drag threshold fires. Pressing on
        // anything else re-arms dragging.
        const el = wrapperRef.current;
        if (el) {
          const onText = isTweet && !!e.target.closest('[data-tweet-selectable]');
          el.draggable = !onText && !!onDragStart;
        }
      }}
      onDragStart={(e) => {
        if (!onDragStart) return;
        // On a text-tweet card, a drag that begins on the selectable
        // text is the user highlighting to copy — cancel the card drag
        // so the browser does a text selection instead.
        if (isTweet && e.target.closest('[data-tweet-selectable]')) {
          e.preventDefault();
          return;
        }
        // The handler decides between HTML5 drag (in-app drops, e.g.
        // sidebar buckets) and OS drag-out (Alt-drag), and is the
        // one that calls preventDefault when needed.
        onDragStart(e, record);
      }}
      onDragEnd={(e) => {
        // dropEffect === 'none' means the user released over a
        // non-accepting target — fire the spring-back animation so
        // the source card visibly snaps back into place. A successful
        // drop sets dropEffect to 'copy' / 'move' and we leave the
        // card alone since the parent state will reflect the change.
        if (e.dataTransfer?.dropEffect === 'none') {
          setSpringback(true);
          if (springTimerRef.current) clearTimeout(springTimerRef.current);
          springTimerRef.current = setTimeout(() => setSpringback(false), 360);
        }
      }}
    >
      <div
        className={`${styles.frame}${isTweet ? ` ${styles.frameTweet}` : ''}`}
        style={isTweet ? undefined : { aspectRatio: aspect }}
      >
        {inView && (isTweet ? (
          <TweetCard meta={tweetMeta} variant="grid" />
        ) : record.kind === 'video' ? (
          // Video saves: render an inline <video> instead of an
          // <img> — the file_path is an MP4 that browsers can't
          // render as a static image. The poster attribute shows
          // the saved thumbnail (first frame) so the card looks
          // identical to an image save at rest; hover starts the
          // video silently and resets when the cursor leaves so
          // each hover plays from the start. preload="metadata"
          // means we fetch just the byte range needed to know the
          // video's dimensions — the rest only downloads if the
          // user actually hovers.
          <video
            src={fileUrl(record.file_path)}
            poster={record.thumb_path ? fileUrl(record.thumb_path) : undefined}
            className={`${styles.image}${record.__pending ? ' ' + styles.imagePending : ''}`}
            autoPlay
            muted
            loop
            playsInline
            // Autoplay muted is allowed without user gesture, so
            // every video card in the grid starts playing as soon
            // as it scrolls into view. preload="auto" lets the
            // browser fetch enough of the file to start playback
            // immediately; visibility-gated by the inView check
            // already wrapping this element, so off-screen videos
            // never start loading.
            preload="auto"
            draggable={false}
            style={morphSource ? { viewTransitionName: 'morph-image' } : undefined}
          />
        ) : src && (
          <img
            src={src}
            className={`${styles.image}${record.__pending ? ' ' + styles.imagePending : ''}`}
            alt={record.title || ''}
            loading="lazy"
            decoding="async"
            draggable={false}
            style={morphSource ? { viewTransitionName: 'morph-image' } : undefined}
          />
        ))}
        {inView && record.tweet_meta && !isTweet && (
          // Bottom-left glass badge — marks media saves captured via the
          // X bookmark watcher. Skipped for text tweets: their card
          // already shows the X glyph in its header.
          <span className={styles.sourceBadge} aria-label="From X">
            <XGlyphIcon />
          </span>
        )}
        {inView && tweetImageCount > 1 && (
          // Top-right count chip — the tweet carried several photos; the
          // thumbnail shows the first. Paging happens in the focused view.
          <span className={styles.countBadge} aria-label={`1 of ${tweetImageCount} images`}>
            <CopiesIcon />
            1/{tweetImageCount}
          </span>
        )}
        {record.__pending && (
          <div className={styles.pendingOverlay} aria-label="Generating variation">
            <div className={styles.pendingDots} aria-hidden="true" />
          </div>
        )}
        {inView && (
          <>
            <span
              role="checkbox"
              aria-checked={!!selected}
              tabIndex={-1}
              className={`${styles.checkbox} ${selected ? styles.checkboxOn : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(record.id, true);
              }}
              title={selected ? 'Deselect' : 'Select'}
            >
              {selected && <CheckIcon />}
            </span>
            {!isTweet && (
              // Peek (quick-look) only makes sense for media — a text
              // tweet has no image to enlarge, so skip it there.
              <span
                className={styles.peekBtn}
                title="Peek"
                aria-label="Peek"
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => {
                  cancelClose();
                  // If the lightbox is already open (cursor came back from
                  // the image edge), keep it open instead of waiting again.
                  if (peeking) return;
                  scheduleOpen();
                }}
                onMouseLeave={() => {
                  // Cursor left before the open delay elapsed — abort the
                  // pending open. If it's already open, give the cursor a
                  // grace window to reach the image.
                  cancelOpen();
                  if (peeking) scheduleClose(CLOSE_GRACE);
                }}
              >
                <PeekIcon />
              </span>
            )}
          </>
        )}
      </div>

      {peeking && src && createPortal(
        <div
          className={styles.lightbox}
          // Cursor can pass over the dim backdrop on its way to the
          // image without dismissing — the close decision lives on
          // the image's own enter/leave below.
          aria-hidden="true"
        >
          <img
            src={src}
            alt=""
            className={styles.lightboxImage}
            decoding="async"
            onMouseEnter={cancelClose}
            onMouseLeave={() => setPeeking(false)}
            draggable={false}
          />
        </div>,
        document.body,
      )}
    </button>
  );
}
