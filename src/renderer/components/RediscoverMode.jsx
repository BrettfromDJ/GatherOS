import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X as XIcon, Check as CheckIcon } from 'lucide-react';
import styles from './RediscoverMode.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { fuzzyMatch } from '../lib/fuzzy.js';

// Tinder-for-your-library: shuffle every save in the active library
// and walk through them one at a time, full-screen. ← trashes, →
// skips to the next, ↑ opens a small bucket picker so the user can
// file the current save away in one keystroke. Esc exits.
//
// The shuffle is captured once on open so the order doesn't reset
// when the user trashes or buckets a card mid-rotation. saves
// passed in changes (e.g. after a delete) are reflected by index
// because we resolve the current save through the props every render.

function shuffleIds(saves) {
  const ids = saves.filter((s) => !s.deleted_at).map((s) => s.id);
  // Fisher–Yates so each permutation is equally likely.
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

export default function RediscoverMode({
  open,
  saves,
  collections,
  onTrash,
  onAddToBucket,
  onClose,
}) {
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState('');
  const [pickerActiveIdx, setPickerActiveIdx] = useState(0);
  // Collections that already contain the current save. Used to mark
  // them in the picker so the user doesn't add a duplicate by
  // accident. Reloaded whenever the current save changes or the
  // picker opens.
  const [currentCollectionIds, setCurrentCollectionIds] = useState(new Set());
  // Direction of the most recent action so the card-leave animation
  // can lean the right way (left for trash, right for skip, up for
  // bucket). Cleared after the next save renders.
  const [leaving, setLeaving] = useState(null); // 'left' | 'right' | 'up' | null
  const leaveTimerRef = useRef(null);

  // Reshuffle on open. We don't reshuffle when saves changes because
  // that would jump the user mid-rotation; trashed/bucketed saves
  // are resolved-by-id below so missing rows just skip.
  useEffect(() => {
    if (!open) return;
    setQueue(shuffleIds(saves));
    setIdx(0);
    setPickerOpen(false);
    setPickerFilter('');
    setLeaving(null);
  }, [open]);

  const currentId = queue[idx] || null;
  const current = useMemo(
    () => (currentId ? saves.find((s) => s.id === currentId) : null),
    [currentId, saves],
  );

  const filteredCollections = useMemo(() => {
    const q = pickerFilter.trim().toLowerCase();
    if (!q) return collections.slice(0, 12);
    return collections
      .map((c) => ({ c, m: fuzzyMatch(q, c.name) }))
      .filter((x) => x.m)
      .sort((a, b) => a.m.score - b.m.score)
      .slice(0, 12)
      .map((x) => x.c);
  }, [collections, pickerFilter]);

  // Look up which collections currently contain this save so we can
  // mark them in the picker. Refetches whenever the current save
  // changes (so trashing / bucketing one card and moving to the
  // next gives accurate membership for the new card).
  useEffect(() => {
    if (!open || !currentId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const cols = await window.moodmark?.collections?.getForSave?.(currentId);
        if (cancelled) return;
        setCurrentCollectionIds(new Set((cols || []).map((c) => c.id)));
      } catch { /* non-fatal — picker just won't show membership */ }
    })();
    return () => { cancelled = true; };
  }, [open, currentId]);

  function advance(direction) {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    setLeaving(direction);
    leaveTimerRef.current = setTimeout(() => {
      setIdx((i) => i + 1);
      setLeaving(null);
    }, 180);
  }

  function handleTrash() {
    if (!currentId) return;
    onTrash?.(currentId);
    advance('left');
  }

  function handleSkip() {
    if (!currentId) return;
    advance('right');
  }

  function openBucketPicker() {
    if (!currentId || collections.length === 0) return;
    setPickerFilter('');
    setPickerActiveIdx(0);
    setPickerOpen(true);
  }

  function pickBucket(collectionId) {
    if (!currentId || !collectionId) return;
    onAddToBucket?.(currentId, collectionId);
    setPickerOpen(false);
    advance('up');
  }

  // Global keydown driver. We attach in capture so the focused-view
  // J/K listeners and other app shortcuts don't fight this overlay
  // for the same keys.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        if (pickerOpen) {
          e.preventDefault();
          setPickerOpen(false);
          return;
        }
        e.preventDefault();
        onClose?.();
        return;
      }
      if (pickerOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setPickerActiveIdx((i) => Math.min(i + 1, filteredCollections.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setPickerActiveIdx((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          const c = filteredCollections[pickerActiveIdx];
          if (c) {
            e.preventDefault();
            pickBucket(c.id);
          }
          return;
        }
        return;
      }
      if (!current) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleTrash();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleSkip();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        openBucketPicker();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, current, currentId, pickerOpen, filteredCollections, pickerActiveIdx]);

  useEffect(() => () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
  }, []);

  if (!open) return null;

  // Click on the scrim (NOT on any inner element) closes. e.target
  // === e.currentTarget makes sure clicks that bubbled up from the
  // card / hints / picker don't dismiss.
  const handleScrimClick = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  // Two empty states with different copy: a library that has
  // nothing to rediscover (queue never had anything in it) vs. one
  // where the user has walked through every save. No box / card —
  // text and a Done button float directly on the dark scrim.
  if (!current) {
    const neverHadAnything = queue.length === 0;
    return (
      <div className={styles.scrim} onClick={handleScrimClick} role="dialog" aria-modal="true">
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close"
        >
          <XIcon size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <div className={styles.empty}>
          {!neverHadAnything && (
            <div className={styles.emptyCheck} aria-hidden="true">
              <CheckIcon size={28} strokeWidth={2.2} />
            </div>
          )}
          <div className={styles.emptyTitle}>
            {neverHadAnything ? 'Nothing to rediscover yet' : "You've seen everything"}
          </div>
          <div className={styles.emptySub}>
            {neverHadAnything
              ? 'Save some inspiration first — drag in a screenshot, image, or URL.'
              : `${queue.length} ${queue.length === 1 ? 'save' : 'saves'} reviewed.`}
          </div>
          <button type="button" className={styles.doneBtn} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.scrim}
      onClick={handleScrimClick}
      role="dialog"
      aria-modal="true"
      aria-label="Rediscover"
    >
      <button
        type="button"
        className={styles.closeBtn}
        onClick={onClose}
        aria-label="Close rediscover"
      >
        <XIcon size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>

      <div className={styles.progress}>
        {idx + 1} <span className={styles.progressTotal}>/ {queue.length}</span>
      </div>

      <div
        key={currentId}
        className={`${styles.card} ${leaving ? styles[`leaving_${leaving}`] : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {current.kind === 'video' ? (
          // Video saves: file_path is an MP4 an <img> can't render.
          // Autoplay muted + loop so the card behaves like the rest
          // of the deck; poster shows the saved first frame.
          <video
            src={fileUrl(current.file_path)}
            poster={current.thumb_path ? fileUrl(current.thumb_path) : undefined}
            className={styles.image}
            autoPlay
            muted
            loop
            playsInline
            draggable={false}
          />
        ) : (
          <img
            src={fileUrl(current.file_path)}
            alt={current.title || ''}
            className={styles.image}
            draggable={false}
            decoding="async"
          />
        )}
        {current.title && <div className={styles.caption}>{current.title}</div>}
      </div>

      <div className={styles.hints}>
        {/* Arrow-key d-pad — mirrors the keyboard cluster so the keys
            map to their actions by position. Buttons stay clickable so
            trackpad users aren't forced onto the keyboard. */}
        <div className={styles.dpad}>
          <div className={`${styles.padCell} ${styles.padUp}`}>
            <button type="button" className={styles.padKey} onClick={openBucketPicker} aria-label="Add to collection">↑</button>
            <span className={styles.padLabel}>Collection</span>
          </div>
          <div className={`${styles.padCell} ${styles.padLeft}`}>
            <button type="button" className={styles.padKey} onClick={handleTrash} aria-label="Trash">←</button>
            <span className={styles.padLabel}>Trash</span>
          </div>
          <div className={`${styles.padCell} ${styles.padMid}`} aria-hidden="true">
            <span className={styles.padDot} />
          </div>
          <div className={`${styles.padCell} ${styles.padRight}`}>
            <button type="button" className={styles.padKey} onClick={handleSkip} aria-label="Skip">→</button>
            <span className={styles.padLabel}>Skip</span>
          </div>
        </div>
        <button type="button" className={styles.exitBtn} onClick={onClose}>
          <kbd className={styles.kbd}>Esc</kbd>
          <span>Exit</span>
        </button>
      </div>

      {pickerOpen && (
        <div
          className={styles.picker}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Choose a collection"
        >
          <input
            autoFocus
            className={styles.pickerInput}
            placeholder="Add to collection…"
            value={pickerFilter}
            onChange={(e) => { setPickerFilter(e.target.value); setPickerActiveIdx(0); }}
          />
          <div className={styles.pickerList}>
            {filteredCollections.length === 0 ? (
              <div className={styles.pickerEmpty}>
                {collections.length === 0
                  ? 'No collections yet — create one from the sidebar.'
                  : `No collection matches "${pickerFilter}".`}
              </div>
            ) : (
              filteredCollections.map((c, i) => {
                const isIn = currentCollectionIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.pickerItem} ${i === pickerActiveIdx ? styles.pickerItemActive : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); pickBucket(c.id); }}
                    onMouseEnter={() => setPickerActiveIdx(i)}
                  >
                    <span
                      className={styles.pickerDot}
                      style={{ background: c.color || 'var(--icon-blue)' }}
                    />
                    <span className={styles.pickerName}>{c.name}</span>
                    {isIn && (
                      <span className={styles.pickerInBadge} title="Already in this collection">
                        <CheckIcon size={14} strokeWidth={2.2} aria-hidden="true" />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
