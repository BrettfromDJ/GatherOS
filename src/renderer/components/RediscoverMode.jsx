import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X as XIcon, Check as CheckIcon, Trash2, GripHorizontal,
} from 'lucide-react';
import styles from './RediscoverMode.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { fuzzyMatch } from '../lib/fuzzy.js';

// Rediscover — a tactile review deck. Every save in the active library
// is shuffled into a stack of square cards; the user flicks the top card
// to act on it: left = Trash, right = Keep (next), up = add to a
// collection (opens the picker). The arrow keys mirror the gestures
// (← / → / ↑) and the Trash / Keep zones + the ↑ hint are clickable, so
// trackpad and keyboard users get the same actions. Esc exits.
//
// The shuffle is captured once on open so the order doesn't reset when a
// card is trashed or filed mid-rotation; saves are resolved by id every
// render, so missing rows just fall through.

// Drag distances (px): ARM lights up a zone; THRESH commits on release.
const ARM = 48;
const THRESH = 115;
const FLING_MS = 240;

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

  // Live drag offset of the top card + which zone it's currently over.
  const [drag, setDrag] = useState({ x: 0, y: 0, animating: false });
  const [hotZone, setHotZone] = useState(null); // 'trash' | 'keep' | 'collection' | null
  const dragStartRef = useRef(null);
  const animatingRef = useRef(false);
  const flingTimerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQueue(shuffleIds(saves));
    setIdx(0);
    setPickerOpen(false);
    setPickerFilter('');
    setDrag({ x: 0, y: 0, animating: false });
    setHotZone(null);
    animatingRef.current = false;
  }, [open]);

  const currentId = queue[idx] || null;
  const current = useMemo(
    () => (currentId ? saves.find((s) => s.id === currentId) : null),
    [currentId, saves],
  );
  // The next two cards in the deck, shown peeking behind the top one.
  const behind = useMemo(() => {
    const out = [];
    for (let k = 1; k <= 2; k += 1) {
      const id = queue[idx + k];
      const s = id ? saves.find((x) => x.id === id) : null;
      if (s) out.push(s);
    }
    return out;
  }, [queue, idx, saves]);

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

  // ── Card motion ──────────────────────────────────────────────────
  function flingOut(dir) {
    animatingRef.current = true;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const target = dir === 'left'
      ? { x: -(W * 0.9 + 220), y: 30 }
      : dir === 'right'
        ? { x: (W * 0.9 + 220), y: 30 }
        : { x: 0, y: -(H * 0.8 + 220) };
    setDrag({ x: target.x, y: target.y, animating: true });
    if (flingTimerRef.current) clearTimeout(flingTimerRef.current);
    flingTimerRef.current = setTimeout(() => {
      setIdx((i) => i + 1);
      setDrag({ x: 0, y: 0, animating: false });
      setHotZone(null);
      animatingRef.current = false;
    }, FLING_MS);
  }

  function snapBack() {
    setHotZone(null);
    setDrag({ x: 0, y: 0, animating: true });
  }

  function handleTrash() {
    if (!currentId || animatingRef.current) return;
    onTrash?.(currentId);
    flingOut('left');
  }

  function handleSkip() {
    if (!currentId || animatingRef.current) return;
    flingOut('right');
  }

  function openBucketPicker() {
    if (!currentId || collections.length === 0) return;
    setPickerFilter('');
    setPickerActiveIdx(0);
    setPickerOpen(true);
  }

  function fileInto(collectionId) {
    if (!currentId || !collectionId || animatingRef.current) return;
    onAddToBucket?.(currentId, collectionId);
    setPickerOpen(false);
    flingOut('up');
  }

  // ── Pointer drag on the top card ─────────────────────────────────
  function zoneFor(dx, dy) {
    if (-dy > ARM && -dy > Math.abs(dx)) return 'collection';
    if (Math.abs(dx) > ARM) return dx < 0 ? 'trash' : 'keep';
    return null;
  }
  function onCardPointerDown(e) {
    if (animatingRef.current || pickerOpen || e.button !== 0) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setDrag((d) => ({ ...d, animating: false }));
  }
  function onCardPointerMove(e) {
    const s = dragStartRef.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    setDrag({ x: dx, y: dy, animating: false });
    setHotZone(zoneFor(dx, dy));
  }
  function onCardPointerUp(e) {
    const s = dragStartRef.current;
    if (!s) return;
    dragStartRef.current = null;
    try { e.currentTarget.releasePointerCapture(s.id); } catch { /* ignore */ }
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (-dy > THRESH && -dy > Math.abs(dx)) { snapBack(); openBucketPicker(); }
    else if (dx <= -THRESH) { onTrash?.(currentId); flingOut('left'); }
    else if (dx >= THRESH) { flingOut('right'); }
    else snapBack();
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
      if (!current || animatingRef.current) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); handleTrash(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); handleSkip(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); openBucketPicker(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, current, currentId, pickerOpen, filteredCollections, pickerActiveIdx]);

  useEffect(() => () => {
    if (flingTimerRef.current) clearTimeout(flingTimerRef.current);
  }, []);

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

  const cardTransform = `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x * 0.05}deg)`;

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

      {/* Add-to-collection affordance — press ↑ (or click) to open the
          collection list; dragging the card up here lights it up. */}
      {collections.length > 0 && (
        <button
          type="button"
          className={`${styles.collectHint} ${hotZone === 'collection' ? styles.collectHintHot : ''}`}
          onClick={openBucketPicker}
        >
          <kbd className={styles.kbd}>↑</kbd>
          <span>Add to collection</span>
        </button>
      )}

      {/* Trash + Keep zones flank the deck. */}
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

      {/* The deck. */}
      <div className={styles.deck} onClick={(e) => e.stopPropagation()}>
        {behind.slice().reverse().map((s, i) => {
          // behind[0] is nearer the top; render furthest first so the
          // nearer one stacks on top of it.
          const isFar = (behind.length - 1 - i) === 1;
          return (
            <div
              key={s.id}
              className={`${styles.deckCard} ${isFar ? styles.deckBehind2 : styles.deckBehind1}`}
              aria-hidden="true"
            >
              <img className={styles.deckImg} src={fileUrl(s.thumb_path || s.file_path)} alt="" draggable={false} />
            </div>
          );
        })}

        <div
          key={currentId}
          className={`${styles.deckCard} ${styles.deckTop}`}
          style={{
            transform: cardTransform,
            transition: drag.animating ? `transform ${FLING_MS}ms cubic-bezier(.4,0,.2,1)` : 'none',
          }}
          onPointerDown={onCardPointerDown}
          onPointerMove={onCardPointerMove}
          onPointerUp={onCardPointerUp}
          onPointerCancel={onCardPointerUp}
        >
          <span className={styles.deckGrip} aria-hidden="true">
            <GripHorizontal size={20} strokeWidth={1.6} />
          </span>
          {current.kind === 'video' ? (
            <video
              src={fileUrl(current.file_path)}
              poster={current.thumb_path ? fileUrl(current.thumb_path) : undefined}
              className={styles.deckImg}
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
              className={styles.deckImg}
              draggable={false}
              decoding="async"
            />
          )}
          {current.title && <div className={styles.deckCaption}>{current.title}</div>}
        </div>
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
