import React, { useEffect, useMemo, useRef, useState } from 'react';
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

  // Two empty states with different copy: a library that has nothing
  // to rediscover (queue never had anything in it) vs. one where the
  // user has walked through every save.
  if (!current) {
    const neverHadAnything = queue.length === 0;
    return (
      <div className={styles.scrim} onClick={onClose} role="dialog" aria-modal="true">
        <div className={styles.empty} onClick={(e) => e.stopPropagation()}>
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
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-label="Rediscover">
      <div className={styles.progress}>
        {idx + 1} <span className={styles.progressTotal}>/ {queue.length}</span>
      </div>

      <div
        key={currentId}
        className={`${styles.card} ${leaving ? styles[`leaving_${leaving}`] : ''}`}
      >
        <img
          src={fileUrl(current.file_path)}
          alt={current.title || ''}
          className={styles.image}
          draggable={false}
          decoding="async"
        />
        {current.title && <div className={styles.caption}>{current.title}</div>}
      </div>

      <div className={styles.hints}>
        <button type="button" className={styles.hintBtn} onClick={handleTrash}>
          <kbd className={styles.kbd}>←</kbd>
          <span>Trash</span>
        </button>
        <button type="button" className={styles.hintBtn} onClick={openBucketPicker}>
          <kbd className={styles.kbd}>↑</kbd>
          <span>Bucket</span>
        </button>
        <button type="button" className={styles.hintBtn} onClick={handleSkip}>
          <kbd className={styles.kbd}>→</kbd>
          <span>Skip</span>
        </button>
        <button type="button" className={`${styles.hintBtn} ${styles.hintBtnExit}`} onClick={onClose}>
          <kbd className={styles.kbd}>Esc</kbd>
          <span>Exit</span>
        </button>
      </div>

      {pickerOpen && (
        <div
          className={styles.picker}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Choose a bucket"
        >
          <input
            autoFocus
            className={styles.pickerInput}
            placeholder="Add to bucket…"
            value={pickerFilter}
            onChange={(e) => { setPickerFilter(e.target.value); setPickerActiveIdx(0); }}
          />
          <div className={styles.pickerList}>
            {filteredCollections.length === 0 ? (
              <div className={styles.pickerEmpty}>
                {collections.length === 0
                  ? 'No buckets yet — create one from the sidebar.'
                  : `No bucket matches "${pickerFilter}".`}
              </div>
            ) : (
              filteredCollections.map((c, i) => (
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
                  {c.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
