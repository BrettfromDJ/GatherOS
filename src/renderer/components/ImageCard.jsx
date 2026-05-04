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
  fresh,
  staggerMs = 0,
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

  return (
    <button
      type="button"
      data-save-id={record.id}
      draggable={!!onDragStart}
      className={[
        styles.card,
        selected && styles.selected,
        selectionActive && styles.showSelectables,
        fresh && styles.fresh,
      ].filter(Boolean).join(' ')}
      style={staggerMs ? { '--card-stagger': `${staggerMs}ms` } : undefined}
      onClick={(e) => onSelect(record.id, e.metaKey || e.ctrlKey || e.shiftKey)}
      onDoubleClick={() => onOpen(record)}
      onContextMenu={(e) => {
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
    >
      <div className={styles.frame} style={{ aspectRatio: aspect }}>
        {src && (
          <img
            src={src}
            className={styles.image}
            alt={record.title || ''}
            loading="lazy"
            draggable={false}
          />
        )}
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
