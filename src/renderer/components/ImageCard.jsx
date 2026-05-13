import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ImageCard.module.css';
import { fileUrl } from '../lib/fileUrl.js';

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

  // Hover-triggered lightbox preview. Open after the user has
  // intentionally hovered the icon for OPEN_DELAY ms — keeps
  // accidental cursor passes from popping the lightbox. Once open,
  // a brief CLOSE_GRACE window lets the cursor travel from the icon
  // to the image without dismissing.
  const OPEN_DELAY = 220;
  const CLOSE_GRACE = 150;
  const [peeking, setPeeking] = useState(false);
  // Source rect captured at peek-open so the lightbox image can FLIP
  // from the card's on-screen position into the centered preview.
  const [sourceRect, setSourceRect] = useState(null);
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const peekImgRef = useRef(null);

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
      // Capture the card's on-screen rect so the lightbox image can
      // FLIP into place from where the card currently sits.
      const wrapper = wrapperRef.current;
      const inner = wrapper?.querySelector('img');
      const el = inner || wrapper;
      if (el) setSourceRect(el.getBoundingClientRect());
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
      draggable={!isPending && !!onDragStart}
      className={[
        styles.card,
        selected && styles.selected,
        selectionActive && styles.showSelectables,
        fresh && styles.fresh,
        springback && styles.springback,
        isPending && styles.cardPending,
      ].filter(Boolean).join(' ')}
      style={staggerMs ? { '--card-stagger': `${staggerMs}ms` } : undefined}
      onClick={isPending ? undefined : (e) => onSelect(record.id, e.metaKey || e.ctrlKey || e.shiftKey)}
      onDoubleClick={isPending ? undefined : () => onOpen(record)}
      onMouseEnter={isPending ? undefined : () => onHover?.(record.id)}
      onMouseLeave={isPending ? undefined : () => onHover?.(null, record.id)}
      onContextMenu={isPending ? undefined : (e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(record.id, e.clientX, e.clientY);
        }
      }}
      onDragStart={(e) => {
        if (!onDragStart) return;
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
      <div className={styles.frame} style={{ aspectRatio: aspect }}>
        {inView && src && (
          <img
            src={src}
            className={`${styles.image}${record.__pending ? ' ' + styles.imagePending : ''}`}
            alt={record.title || ''}
            loading="lazy"
            decoding="async"
            draggable={false}
            style={morphSource ? { viewTransitionName: 'morph-image' } : undefined}
          />
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
            ref={(el) => {
              peekImgRef.current = el;
              if (!el || !sourceRect) return;
              // FLIP: measure where the image WILL sit centered, then
              // apply an inverse transform that places it at the source
              // rect and animate to identity. WAAPI handles the
              // composited tween off the React thread.
              const target = el.getBoundingClientRect();
              const dx = sourceRect.left + sourceRect.width / 2 - (target.left + target.width / 2);
              const dy = sourceRect.top + sourceRect.height / 2 - (target.top + target.height / 2);
              const sx = sourceRect.width / target.width;
              const sy = sourceRect.height / target.height;
              try {
                el.animate(
                  [
                    {
                      transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
                      borderRadius: '8px',
                      opacity: 0.92,
                    },
                    {
                      transform: 'translate(0, 0) scale(1, 1)',
                      borderRadius: 'var(--radius-xl)',
                      opacity: 1,
                    },
                  ],
                  { duration: 340, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' },
                );
              } catch { /* ignore Animations API failure */ }
            }}
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
