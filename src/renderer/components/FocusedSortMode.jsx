import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './FocusedSortMode.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { flyToCollection } from '../lib/flyToCollection.js';

// Background "scatter" thumb count — kept low; many heavily-blurred
// images still chew GPU on lower-end Macs.
const BG_THUMBS = 9;

const CELEBRATION_COLORS = [
  '#34c759', '#ffcc00', '#ff9500', '#0a84ff',
  '#af52de', '#ff3b30', '#5ac8fa', '#ff2d55',
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5 L10 17.5 L19 7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export default function FocusedSortMode({ saves, collections, onAssign, onClose }) {
  // Snapshot the original list at mount so progress + the "next-up"
  // queue stay stable even though the parent's `saves` prop shrinks
  // every time the user assigns one. We look up live record data
  // from the parent on each render via savesById.
  const [pendingIds] = useState(() => saves.map((s) => s.id));
  const [completed, setCompleted] = useState(0);
  const [exiting, setExiting] = useState(false);
  // Ignore inbound key/click events during the fly + reload window
  // so a user mashing 1-2-3 doesn't trigger overlapping assignments.
  const [animating, setAnimating] = useState(false);

  const savesById = useMemo(() => {
    const m = new Map();
    for (const s of saves) m.set(s.id, s);
    return m;
  }, [saves]);

  const total = pendingIds.length;
  const currentId = pendingIds[completed] || null;
  const current = currentId ? savesById.get(currentId) : null;
  const upcomingIds = pendingIds.slice(completed + 1, completed + 1 + BG_THUMBS);
  const done = total > 0 && completed >= total;

  const handleClose = () => {
    setExiting(true);
    setTimeout(() => onClose?.(), 240);
  };

  const handleAssign = async (collectionId) => {
    if (!current || animating || done) return;
    setAnimating(true);
    flyToCollection({
      collectionId,
      items: [{ saveId: current.id, imageSrc: fileUrl(current.file_path) }],
    });
    try {
      await onAssign(current.id, collectionId);
    } catch (err) {
      console.error('Focused-sort assign failed:', err);
    }
    setCompleted((c) => c + 1);
    setAnimating(false);
  };

  // Auto-close shortly after the celebration finishes so we don't
  // strand the user on the done screen forever.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(handleClose, 2200);
    return () => clearTimeout(t);
    // handleClose is stable enough — eslint-react/exhaustive-deps complaint
    // would force a useCallback that adds noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  // Keyboard shortcuts: 1..9 assign to bucket N; Esc exits.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }
      if (done || animating || !current) return;
      const n = parseInt(e.key, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 9 && n <= collections.length) {
        e.preventDefault();
        handleAssign(collections[n - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections, current, animating, done]);

  // Per-thumb scatter coords. Memoized on pendingIds so the
  // background doesn't reshuffle on every render.
  const bgPositions = useMemo(() => pendingIds.map((_, i) => ({
    left: `${((i * 37 + 13) % 90) + 5}%`,
    top:  `${((i * 23 + 7)  % 75) + 8}%`,
    rot:  `${((i * 41) % 50) - 25}deg`,
    delay: `${(i * 1.3) % 9}s`,
  })), [pendingIds]);

  // Confetti pieces — pre-rolled when entering the done state.
  const confetti = useMemo(() => {
    if (!done) return [];
    return Array.from({ length: 36 }, (_, i) => {
      const angle = -180 + Math.random() * 180;
      const distance = 140 + Math.random() * 180;
      return {
        id: i,
        dx: Math.cos((angle * Math.PI) / 180) * distance,
        dy: Math.sin((angle * Math.PI) / 180) * distance,
        rot: Math.random() * 720 - 360,
        delay: Math.random() * 200,
        size: 5 + Math.random() * 5,
        color: CELEBRATION_COLORS[i % CELEBRATION_COLORS.length],
      };
    });
  }, [done]);

  return createPortal(
    <div className={[styles.overlay, exiting && styles.exiting].filter(Boolean).join(' ')}>
      {/* Background scatter — uses upcoming-queue thumbs so the user
          gets a sense of what's still left to triage. */}
      <div className={styles.background} aria-hidden="true">
        {upcomingIds.map((id, i) => {
          const s = savesById.get(id);
          const pos = bgPositions[completed + 1 + i] || bgPositions[i] || {};
          if (!s) return null;
          return (
            <img
              key={id}
              className={styles.bgThumb}
              src={fileUrl(s.thumb_path || s.file_path)}
              alt=""
              draggable={false}
              style={{
                left: pos.left,
                top: pos.top,
                '--rot': pos.rot,
                animationDelay: pos.delay,
              }}
            />
          );
        })}
      </div>

      <button
        type="button"
        className={styles.closeBtn}
        onClick={handleClose}
        aria-label="Exit focused sort"
      >
        <CloseIcon />
      </button>

      {!done && total > 0 && (
        <header className={styles.header}>
          <span className={styles.progress}>
            <span className={styles.progressNum}>{Math.min(completed + 1, total)}</span>
            <span className={styles.progressTotal}>/ {total}</span>
          </span>
        </header>
      )}

      {/* ── Empty state ─────────────────────────────────────────── */}
      {total === 0 && (
        <div className={styles.empty}>
          <h2>Nothing to sort.</h2>
          <p>Unsorted is already empty.</p>
        </div>
      )}

      {/* ── Sorting state ───────────────────────────────────────── */}
      {!done && current && (
        <>
          <div className={styles.focusFrame}>
            <img
              key={current.id}
              className={styles.focusImage}
              src={fileUrl(current.file_path)}
              alt=""
              draggable={false}
            />
          </div>

          <div className={styles.buckets}>
            {collections.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={styles.bucket}
                onClick={() => handleAssign(c.id)}
                disabled={animating}
              >
                {i < 9 && <span className={styles.bucketKey}>{i + 1}</span>}
                <span className={styles.bucketName}>{c.name}</span>
              </button>
            ))}
          </div>

          <div className={styles.hint}>
            <span className={styles.kbd}>1</span>–<span className={styles.kbd}>9</span> assign
            <span style={{ margin: '0 8px', opacity: 0.5 }}>·</span>
            <span className={styles.kbd}>Esc</span> exit
          </div>
        </>
      )}

      {/* ── Done state ──────────────────────────────────────────── */}
      {done && (
        <>
          <div className={styles.confetti} aria-hidden="true">
            {confetti.map((p) => (
              <span
                key={p.id}
                className={styles.confettiPiece}
                style={{
                  '--dx': `${p.dx}px`,
                  '--dy': `${p.dy}px`,
                  '--rot': `${p.rot}deg`,
                  '--delay': `${p.delay}ms`,
                  width: `${p.size}px`,
                  height: `${p.size}px`,
                  background: p.color,
                }}
              />
            ))}
          </div>
          <div className={styles.done}>
            <span className={styles.doneCheck}><CheckIcon /></span>
            <h1>All sorted.</h1>
            <p>Inbox zero. {total === 1 ? '1 save' : `${total} saves`} sorted.</p>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
