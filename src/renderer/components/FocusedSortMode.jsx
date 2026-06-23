import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './FocusedSortMode.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { resolveAsset } from '../lib/asset.js';
import { flyToCollection } from '../lib/flyToCollection.js';

// Background "scatter" thumb count — kept low; many heavily-blurred
// images still chew GPU on lower-end Macs.
const BG_THUMBS = 9;


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
  // How many were actually filed (vs. skipped). Drives the done copy.
  const [assignedCount, setAssignedCount] = useState(0);
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
    setAssignedCount((a) => a + 1);
    setCompleted((c) => c + 1);
    setAnimating(false);
  };

  // Skip: advance without filing. The save stays in Unsorted so it can
  // be triaged later. Bound to the left/right arrow keys.
  const handleSkip = () => {
    if (!current || animating || done) return;
    setCompleted((c) => c + 1);
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
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        handleSkip();
        return;
      }
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
              src={resolveAsset(s, 'thumb')}
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
            {current.kind === 'video' ? (
              // Video saves: file_path is an MP4 that an <img> can't
              // render. Autoplay muted + loop so triage feels like
              // glancing at a GIF; poster shows the saved first frame
              // before playback kicks in.
              <video
                key={current.id}
                className={styles.focusImage}
                src={fileUrl(current.file_path)}
                poster={current.thumb_path ? fileUrl(current.thumb_path) : undefined}
                autoPlay
                muted
                loop
                playsInline
                draggable={false}
              />
            ) : (
              <img
                key={current.id}
                className={styles.focusImage}
                src={fileUrl(current.file_path)}
                alt=""
                draggable={false}
              />
            )}
          </div>

          <div className={styles.buckets}>
            {collections.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.bucket}${i >= 9 ? ` ${styles.bucketNoKey}` : ''}`}
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
            <span className={styles.kbd}>←</span><span className={styles.kbd}>→</span> skip
            <span style={{ margin: '0 8px', opacity: 0.5 }}>·</span>
            <span className={styles.kbd}>Esc</span> exit
          </div>
        </>
      )}

      {/* ── Done state ──────────────────────────────────────────── */}
      {done && (
        <div className={styles.done}>
          <h1 className={styles.doneTitle}>All sorted</h1>
          <p className={styles.doneSub}>
            {assignedCount === 0
              ? 'Everything skipped — nothing filed.'
              : `${assignedCount === 1 ? '1 save' : `${assignedCount} saves`} filed into ${assignedCount === 1 ? 'its collection' : 'their collections'}.`}
            {assignedCount > 0 && total - assignedCount > 0
              ? ` ${total - assignedCount} skipped.`
              : ''}
          </p>
        </div>
      )}
    </div>,
    document.body,
  );
}
