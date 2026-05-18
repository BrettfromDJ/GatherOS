import React, { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import styles from './FeaturedBuckets.module.css';
import { CollectionIcon } from './Sidebar.jsx';
import { fileUrl } from '../lib/fileUrl.js';
import ContextMenu from './ContextMenu.jsx';

const PREVIEW_COUNT = 4;

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.5 2.5l2 2-7.5 7.5H4v-2z" />
      <path d="M10 4l2 2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 4h11" />
      <path d="M5.5 4V2.5a0.75 0.75 0 0 1 0.75 -0.75h3.5a0.75 0.75 0 0 1 0.75 0.75V4" />
      <path d="M3.75 4v9a0.75 0.75 0 0 0 0.75 0.75h7a0.75 0.75 0 0 0 0.75 -0.75V4" />
      <path d="M6.5 7v4M9.5 7v4" />
    </svg>
  );
}

// Featured-buckets row above the masonry. Cards flow with the
// grid — when you scroll, they go up and out of view naturally.
// MIME type the masonry cards use to advertise "I'm a drag of save
// ids" — declared at module scope so the drop handlers in this file
// can match without crossing back into App.jsx.
const SAVE_DROP_MIME = 'application/x-moodmark-save-ids';

export default function FeaturedBuckets({
  collections,
  onPickBucket,
  onRenameCollection,
  onDeleteCollection,
  onShuffleView,
  onAddSavesToBucket,
  onDropFilesToBucket,
  onSetAppDragging,
  onOpenCollectionAsSpace,
}) {
  const [previews, setPreviews] = useState({}); // { bucketId: [save, ...] }
  // Right-click context menu anchor + the bucket it targets.
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, collection }
  // Inline rename state — when set, the card's name area renders an
  // input instead of the label.
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef(null);
  // While a save card is being dragged over a folder card, this is
  // the active target. Drives the accent-ring highlight on the card.
  const [dropTargetId, setDropTargetId] = useState(null);
  // Suppress click-to-open right after a horizontal scroll fires.
  // When the user scrolls fast and hits the boundary, Chromium fires
  // a synthetic click on whichever card the pointer ends over —
  // tracking scroll timestamp + bailing on stale clicks blocks that
  // without breaking real deliberate clicks.
  const scrollerRef = useRef(null);
  const lastScrollAt = useRef(0);
  // atStart / atEnd drive the mask-image fade on the scroller so the
  // user gets a visual hint that more cards exist beyond the edge.
  // Recomputed on scroll + on resize so the fade resyncs when the
  // window width changes which side has overflow.
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    function recomputeEdges() {
      const max = el.scrollWidth - el.clientWidth;
      // 1px slack on either side so we don't blink the fade in/out
      // at the exact extrema (Chromium leaves sub-pixel drift).
      const atStart = el.scrollLeft <= 1;
      const atEnd = max <= 1 || el.scrollLeft >= max - 1;
      setEdges((prev) => (prev.start === atStart && prev.end === atEnd
        ? prev
        : { start: atStart, end: atEnd }));
    }
    function onScroll() {
      lastScrollAt.current = Date.now();
      recomputeEdges();
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    recomputeEdges();
    const ro = new ResizeObserver(recomputeEdges);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [collections.length]);

  function isSaveDrag(e) {
    return e.dataTransfer.types.includes(SAVE_DROP_MIME);
  }
  // Finder / external file-system drag — dataTransfer.types includes
  // 'Files' when the user is dragging real OS files into the window.
  function isFileDrag(e) {
    return e.dataTransfer.types.includes('Files');
  }

  function handleCardDragOver(e, bucketId) {
    if (!isSaveDrag(e) && !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (dropTargetId !== bucketId) setDropTargetId(bucketId);
    // Card owns this drop, so suppress the global "Drop to save"
    // overlay while the cursor hovers it. stopPropagation above keeps
    // the App-shell onDragOver from re-arming the overlay each move.
    onSetAppDragging?.(false);
  }

  function handleCardDragLeave(e) {
    // dragleave fires on child enter too; only reset on real exit.
    if (!e.currentTarget.contains(e.relatedTarget)) setDropTargetId(null);
  }

  async function handleCardDrop(e, bucketId) {
    if (!isSaveDrag(e) && !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    onSetAppDragging?.(false);
    // Files take priority — if the user drags both an in-app card
    // AND an OS file, only one of those branches will be true at a
    // time in practice.
    if (isFileDrag(e) && e.dataTransfer.files?.length > 0) {
      await onDropFilesToBucket?.(bucketId, e.dataTransfer.files);
      return;
    }
    let ids;
    try { ids = JSON.parse(e.dataTransfer.getData(SAVE_DROP_MIME) || '[]'); }
    catch { return; }
    if (!Array.isArray(ids) || ids.length === 0) return;
    await onAddSavesToBucket?.(bucketId, ids);
  }

  // Pre-fetch up to N preview images per bucket. One IPC per bucket;
  // fine for sidebars with a handful of buckets, would want a single
  // batch query at much larger scale.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next = {};
      await Promise.all(
        collections.map(async (c) => {
          try {
            const data = await window.moodmark.saves.getAll({ collectionId: c.id });
            next[c.id] = (data || []).slice(0, PREVIEW_COUNT);
          } catch {
            next[c.id] = [];
          }
        }),
      );
      if (!cancelled) setPreviews(next);
    }
    load();
    return () => { cancelled = true; };
  }, [collections]);

  function handleCardContextMenu(e, collection) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, collection });
  }

  function startRename(collection) {
    setRenamingId(collection.id);
    setRenameDraft(collection.name);
    requestAnimationFrame(() => renameInputRef.current?.select());
  }

  async function commitRename() {
    const next = renameDraft.trim();
    const id = renamingId;
    setRenamingId(null);
    setRenameDraft('');
    if (!id || !next) return;
    const original = collections.find((c) => c.id === id);
    if (!original || next === original.name) return;
    await onRenameCollection?.({ id, name: next });
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft('');
  }

  if (!collections || collections.length === 0) return null;

  return (
    <>
      {/* Cards row — normal flow, scrolls with content. */}
      <div className={styles.cardsRow}>
        <div
          ref={scrollerRef}
          className={[
            styles.scroller,
            edges.start && styles.scrollerAtStart,
            edges.end && styles.scrollerAtEnd,
          ].filter(Boolean).join(' ')}
          /* Opt this scroller out of the app-shell's horizontal-swipe
             navigation. Without this, swiping the cards row triggers
             the global wheel handler that flips collections. */
          data-allow-horizontal-scroll="true"
        >
          {collections.map((c) => {
            const items = previews[c.id] || [];
            const isRenaming = renamingId === c.id;
            return (
              <div
                key={c.id}
                className={`${styles.card}${dropTargetId === c.id ? ' ' + styles.cardDropTarget : ''}`}
                role="button"
                tabIndex={isRenaming ? -1 : 0}
                onClick={(e) => {
                  if (isRenaming) return;
                  // Ignore clicks that originated on the rename input
                  // (browsers re-bubble through the wrapping div).
                  if (e.target.closest(`.${styles.cardRenameInput}`)) return;
                  // Bail on clicks that arrive within ~250ms of a
                  // scroll — that's the post-momentum synthetic click
                  // Chromium fires when horizontal scroll bottoms out
                  // over a card.
                  if (Date.now() - lastScrollAt.current < 250) return;
                  onPickBucket?.(c.id);
                }}
                onKeyDown={(e) => {
                  if (isRenaming) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPickBucket?.(c.id);
                  }
                }}
                onContextMenu={(e) => handleCardContextMenu(e, c)}
                onDragOver={(e) => handleCardDragOver(e, c.id)}
                onDragLeave={handleCardDragLeave}
                onDrop={(e) => handleCardDrop(e, c.id)}
                title={c.name}
              >
                <div className={styles.stack}>
                  {items.length === 0 ? (
                    <div className={styles.stackEmpty}>
                      <span className={styles.stackEmptyIcon}>
                        <CollectionIcon />
                      </span>
                    </div>
                  ) : (
                    items.slice(0, PREVIEW_COUNT).map((s) => (
                      <img
                        key={s.id}
                        src={fileUrl(s.thumb_path || s.file_path)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                      />
                    ))
                  )}
                </div>
                <div className={styles.meta}>
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      autoFocus
                      className={styles.cardRenameInput}
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      onBlur={commitRename}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className={styles.name}>{c.name}</span>
                  )}
                  <span className={styles.count}>
                    <span className={styles.countNum}>{c.save_count}</span>
                    <span className={styles.countLabel}> {c.save_count === 1 ? 'save' : 'saves'}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            ...(typeof onShuffleView === 'function' ? [{
              label: 'Shuffle',
              icon: (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.5 4.5h2.3l6.4 7h2.3" />
                  <path d="M2.5 11.5h2.3l3-3.5" />
                  <path d="M8.2 7l3-3.5h2.3" />
                  <path d="M12 2.5l1.5 2-1.5 2" />
                  <path d="M12 9.5l1.5 2-1.5 2" />
                </svg>
              ),
              onClick: () => onShuffleView({ type: 'collection', id: ctxMenu.collection.id }),
            }] : []),
            {
              label: 'Rename',
              icon: <PencilIcon />,
              onClick: () => startRename(ctxMenu.collection),
            },
            ...(onOpenCollectionAsSpace ? [{
              label: 'Open as space',
              icon: <Layers size={14} strokeWidth={1.6} aria-hidden="true" />,
              onClick: () => onOpenCollectionAsSpace(ctxMenu.collection.id),
            }] : []),
            {
              label: 'Delete collection',
              icon: <TrashIcon />,
              danger: true,
              onClick: () => onDeleteCollection?.(ctxMenu.collection.id),
            },
          ]}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}
