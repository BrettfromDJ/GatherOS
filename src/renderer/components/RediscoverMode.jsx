import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X as XIcon, Check as CheckIcon, Trash2, FolderPlus, GripHorizontal,
} from 'lucide-react';
import styles from './RediscoverMode.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { fuzzyMatch } from '../lib/fuzzy.js';

// Rediscover — a tactile review deck. Every save in the active library
// is shuffled into a stack of square cards; the user flicks the top card
// to act on it: left = Trash, right = Keep (next), up = add to a
// collection (opens the picker). The arrow keys mirror the gestures and
// the three zones are clickable, so trackpad + keyboard match. Esc exits.
//
// Cards are keyed by save id and positioned purely by their offset from
// the current index (−1 = leaving, 0 = top, 1/2 = peeking behind), with
// CSS transitions — so advancing promotes a behind card to the top by
// transitioning one element (smooth rotate + lift) rather than swapping
// elements (which popped/faded).

const ARM = 48;     // drag distance that lights up a zone
const THRESH = 115; // drag distance that commits on release

const BEHIND_1 = 'rotate(3deg) translate(11px, 4px) scale(0.965)';
const BEHIND_2 = 'rotate(-5deg) translate(-14px, 9px) scale(0.93)';

function shuffleIds(saves) {
  const ids = saves.filter((s) => !s.deleted_at).map((s) => s.id);
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
  const [currentCollectionIds, setCurrentCollectionIds] = useState(new Set());

  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [lastDir, setLastDir] = useState('left'); // direction the last card left in
  const [hotZone, setHotZone] = useState(null); // 'trash' | 'keep' | 'collection' | null
  const dragStartRef = useRef(null);
  // Cache of every save we've seen so a just-trashed card can still
  // render its image while it flies off, even after the prop drops it.
  const recentRef = useRef(new Map());

  useEffect(() => {
    for (const s of saves) recentRef.current.set(s.id, s);
  }, [saves]);
  const resolve = (id) => (id
    ? (saves.find((s) => s.id === id) || recentRef.current.get(id) || null)
    : null);

  useEffect(() => {
    if (!open) return;
    setQueue(shuffleIds(saves));
    setIdx(0);
    setPickerOpen(false);
    setPickerFilter('');
    setDrag({ x: 0, y: 0 });
    setDragging(false);
    setHotZone(null);
  }, [open]);

  const currentId = queue[idx] || null;
  const current = useMemo(() => resolve(currentId), [currentId, saves]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (!open || !currentId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const cols = await window.moodmark?.collections?.getForSave?.(currentId);
        if (cancelled) return;
        setCurrentCollectionIds(new Set((cols || []).map((c) => c.id)));
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [open, currentId]);

  // ── Actions ──────────────────────────────────────────────────────
  function advance(dir) {
    setLastDir(dir);
    setDragging(false);
    setDrag({ x: 0, y: 0 });
    setHotZone(null);
    setIdx((i) => i + 1);
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
  function fileInto(collectionId) {
    if (!currentId || !collectionId) return;
    onAddToBucket?.(currentId, collectionId);
    setPickerOpen(false);
    advance('up');
  }

  // ── Pointer drag on the top card ─────────────────────────────────
  function zoneFor(dx, dy) {
    if (-dy > ARM && -dy > Math.abs(dx)) return 'collection';
    if (Math.abs(dx) > ARM) return dx < 0 ? 'trash' : 'keep';
    return null;
  }
  function onCardPointerDown(e) {
    if (pickerOpen || e.button !== 0) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setDrag({ x: 0, y: 0 });
    setDragging(true);
  }
  function onCardPointerMove(e) {
    const s = dragStartRef.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    setDrag({ x: dx, y: dy });
    setHotZone(zoneFor(dx, dy));
  }
  function onCardPointerUp(e) {
    const s = dragStartRef.current;
    if (!s) return;
    dragStartRef.current = null;
    try { e.currentTarget.releasePointerCapture(s.id); } catch { /* ignore */ }
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (-dy > THRESH && -dy > Math.abs(dx)) {
      setDragging(false); setDrag({ x: 0, y: 0 }); setHotZone(null);
      openBucketPicker();
    } else if (dx <= -THRESH) {
      onTrash?.(currentId); advance('left');
    } else if (dx >= THRESH) {
      advance('right');
    } else {
      setDragging(false); setDrag({ x: 0, y: 0 }); setHotZone(null);
    }
  }

  // ── Keyboard ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        if (pickerOpen) { e.preventDefault(); setPickerOpen(false); return; }
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
          if (c) { e.preventDefault(); fileInto(c.id); }
          return;
        }
        return;
      }
      if (!current) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); handleTrash(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); handleSkip(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); openBucketPicker(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, current, currentId, pickerOpen, filteredCollections, pickerActiveIdx]);

  if (!open) return null;

  const handleScrimClick = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  if (!current) {
    const neverHadAnything = queue.length === 0;
    return (
      <div className={styles.scrim} onClick={handleScrimClick} role="dialog" aria-modal="true">
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
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
          <button type="button" className={styles.doneBtn} onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  function offsetTransform(offset) {
    if (offset <= -1) {
      if (lastDir === 'left') return 'translateX(-210%) rotate(-16deg)';
      if (lastDir === 'right') return 'translateX(210%) rotate(16deg)';
      return 'translateY(-210%) rotate(0deg)';
    }
    if (offset === 0) return 'translate(0px, 0px) rotate(0deg)';
    if (offset === 1) return BEHIND_1;
    return BEHIND_2;
  }
  function offsetOpacity(offset) {
    if (offset <= -1) return 0;
    if (offset === 0) return 1;
    if (offset === 1) return 0.82;
    return 0.55;
  }
  function offsetZ(offset) {
    if (offset <= -1) return 40;
    if (offset === 0) return 30;
    return 20 - offset;
  }

  return (
    <div
      className={styles.scrim}
      onClick={handleScrimClick}
      role="dialog"
      aria-modal="true"
      aria-label="Rediscover"
    >
      <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close rediscover">
        <XIcon size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>

      <div className={styles.progress}>
        {idx + 1} <span className={styles.progressTotal}>/ {queue.length}</span>
      </div>

      {/* Collection zone (top) — same icon / label / keycap layout as the
          Trash + Keep zones. Drag the card up here, click it, or press ↑. */}
      {collections.length > 0 && (
        <button
          type="button"
          className={`${styles.zone} ${styles.zoneTop} ${hotZone === 'collection' ? styles.zoneHot : ''}`}
          onClick={openBucketPicker}
        >
          <span className={styles.zoneRing}><FolderPlus size={22} strokeWidth={1.7} aria-hidden="true" /></span>
          <span className={styles.zoneLabel}>Collection</span>
          <kbd className={styles.kbd}>↑</kbd>
        </button>
      )}

      <button
        type="button"
        className={`${styles.zone} ${styles.zoneTrash} ${hotZone === 'trash' ? styles.zoneHot : ''}`}
        onClick={handleTrash}
      >
        <span className={styles.zoneRing}><Trash2 size={22} strokeWidth={1.6} aria-hidden="true" /></span>
        <span className={styles.zoneLabel}>Trash</span>
        <kbd className={styles.kbd}>←</kbd>
      </button>
      <button
        type="button"
        className={`${styles.zone} ${styles.zoneKeep} ${hotZone === 'keep' ? styles.zoneHot : ''}`}
        onClick={handleSkip}
      >
        <span className={styles.zoneRing}><CheckIcon size={22} strokeWidth={1.8} aria-hidden="true" /></span>
        <span className={styles.zoneLabel}>Keep</span>
        <kbd className={styles.kbd}>→</kbd>
      </button>

      <div className={styles.deck} onClick={(e) => e.stopPropagation()}>
        {[-1, 0, 1, 2].map((offset) => {
          const id = queue[idx + offset];
          if (!id) return null;
          const save = resolve(id);
          if (!save) return null;
          const isTop = offset === 0;
          const isDragTop = isTop && dragging;
          const transform = isDragTop
            ? `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x * 0.05}deg)`
            : offsetTransform(offset);
          return (
            <div
              key={id}
              className={`${styles.deckCard} ${isTop ? styles.deckTop : ''}`}
              style={{
                transform,
                opacity: isDragTop ? 1 : offsetOpacity(offset),
                transition: isDragTop
                  ? 'none'
                  : 'transform 0.28s cubic-bezier(0.22, 0.8, 0.28, 1), opacity 0.24s ease',
                zIndex: offsetZ(offset),
              }}
              onPointerDown={isTop ? onCardPointerDown : undefined}
              onPointerMove={isTop ? onCardPointerMove : undefined}
              onPointerUp={isTop ? onCardPointerUp : undefined}
              onPointerCancel={isTop ? onCardPointerUp : undefined}
            >
              {isTop && (
                <span className={styles.deckGrip} aria-hidden="true">
                  <GripHorizontal size={20} strokeWidth={1.6} />
                </span>
              )}
              {save.kind === 'video' ? (
                <video
                  src={fileUrl(save.file_path)}
                  poster={save.thumb_path ? fileUrl(save.thumb_path) : undefined}
                  className={styles.deckImg}
                  autoPlay={isTop}
                  muted
                  loop
                  playsInline
                  draggable={false}
                />
              ) : (
                <img
                  src={fileUrl(isTop ? save.file_path : (save.thumb_path || save.file_path))}
                  alt=""
                  className={styles.deckImg}
                  draggable={false}
                  decoding="async"
                />
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.hintLine}>
        Drag a card, or use <kbd className={styles.kbd}>←</kbd>
        <kbd className={styles.kbd}>↑</kbd>
        <kbd className={styles.kbd}>→</kbd>
        <span className={styles.hintSep}>·</span>
        <kbd className={styles.kbd}>Esc</kbd> exit
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
                    onMouseDown={(e) => { e.preventDefault(); fileInto(c.id); }}
                    onMouseEnter={() => setPickerActiveIdx(i)}
                  >
                    <span className={styles.pickerDot} style={{ background: c.color || 'var(--icon-blue)' }} />
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
