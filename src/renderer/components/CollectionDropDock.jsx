import React, { useState } from 'react';
import styles from './CollectionDropDock.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { extractDropImageUrls } from '../lib/dropUrls.js';

const SAVE_DROP_MIME = 'application/x-moodmark-save-ids';

// Edge-tab collection dock. While the grid is scrolled (toolbar hidden),
// collections tuck into a slim handle on the right edge. Hovering it — or
// dragging a save anywhere — springs out a compact floating list of drop
// targets, so you can file without scrolling back up and without an
// edge-to-edge strip. Mirrors FeaturedBuckets' drop routing (in-app
// saves, Finder files, dragged browser images).
function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export default function CollectionDropDock({
  collections,
  scrolled,
  dragging,
  inCollectionIds,
  onAddSavesToBucket,
  onDropFilesToBucket,
  onExternalDropToBucket,
  onSetAppDragging,
  onOpenCollection,
  onDismiss,
}) {
  const [hoverExpand, setHoverExpand] = useState(false);
  const [dropTargetId, setDropTargetId] = useState(null);
  if (!collections || collections.length === 0) return null;

  // Top-level collections only — child collections aren't offered here.
  // Filing into a nested collection is done from its own grid or the
  // card menu; the edge dock stays a flat list of the top level.
  const topLevel = collections.filter((c) => !c.parent_id);

  const visible = scrolled || dragging;
  const expanded = dragging || hoverExpand;

  const isSaveDrag = (e) => e.dataTransfer.types.includes(SAVE_DROP_MIME);
  const isFileDrag = (e) => e.dataTransfer.types.includes('Files');
  const isUrlDrag = (e) => {
    const t = e.dataTransfer.types;
    return t.includes('text/uri-list') || t.includes('text/html');
  };

  function handleRowDragOver(e, id) {
    if (!isSaveDrag(e) && !isFileDrag(e) && !isUrlDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (dropTargetId !== id) setDropTargetId(id);
    onSetAppDragging?.(false);
  }
  function handleRowDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setDropTargetId(null);
  }
  // Open the collection in the grid. A row serves two purposes — drop
  // target AND navigation — so a plain click (no drag) jumps to it and
  // collapses the dock. Works even for collections the dragged save is
  // already in; "already" only blocks the *drop*, not navigation.
  function handleRowClick(id) {
    onOpenCollection?.(id);
    onDismiss?.();
  }
  async function handleRowDrop(e, id) {
    if (!isSaveDrag(e) && !isFileDrag(e) && !isUrlDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    onSetAppDragging?.(false);
    const files = isFileDrag(e) ? [...e.dataTransfer.files] : [];
    const urls = isUrlDrag(e) ? extractDropImageUrls(e.dataTransfer) : [];
    if (files.length > 0 || urls.length > 0) {
      if (onExternalDropToBucket) await onExternalDropToBucket(id, { files, urls });
      else if (files.length > 0) await onDropFilesToBucket?.(id, e.dataTransfer.files);
    } else {
      let ids;
      try { ids = JSON.parse(e.dataTransfer.getData(SAVE_DROP_MIME) || '[]'); }
      catch { ids = []; }
      if (Array.isArray(ids) && ids.length > 0) await onAddSavesToBucket?.(id, ids);
    }
    onDismiss?.();
  }

  function renderRow(c) {
    const thumbs = Array.isArray(c.thumbs) ? c.thumbs.slice(0, 4) : [];
    // Already contains every dragged save → not a valid drop; mark it
    // and refuse the drop instead of silently adding a dupe.
    const already = !!(inCollectionIds && inCollectionIds.has(c.id));
    const isTarget = !already && dropTargetId === c.id;
    return (
      <div
        key={c.id}
        role="button"
        tabIndex={0}
        className={[
          styles.row,
          already && styles.rowIn,
          isTarget && styles.rowTarget,
        ].filter(Boolean).join(' ')}
        onClick={() => handleRowClick(c.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleRowClick(c.id);
          }
        }}
        onDragOver={already ? undefined : (e) => handleRowDragOver(e, c.id)}
        onDragLeave={already ? undefined : handleRowDragLeave}
        onDrop={already ? undefined : (e) => handleRowDrop(e, c.id)}
        title={already ? `${c.name} — already in this collection · click to open` : `${c.name} — click to open or drop here`}
      >
        <span className={styles.fan} aria-hidden="true">
          {thumbs.length > 0 ? (
            thumbs.map((t, i) => (
              <img key={`${i}-${t}`} src={fileUrl(t)} alt="" draggable={false} />
            ))
          ) : (
            <span className={styles.fanEmpty} />
          )}
        </span>
        <span className={styles.rowMeta}>
          <span className={styles.rowName}>{c.name}</span>
          {already ? (
            <span className={styles.rowIn_badge} title="Already added">
              <CheckGlyph />
            </span>
          ) : isTarget ? (
            // Drag-over only (isTarget is set by dragOver, never by
            // passive mouse hover) — previews the result of the drop.
            <span className={styles.rowAdd} aria-hidden="true">+1</span>
          ) : (
            <span className={styles.rowCount}>{(c.save_count ?? 0).toLocaleString()}</span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      className={[
        styles.edge,
        visible && styles.edgeVisible,
        expanded && styles.edgeExpanded,
      ].filter(Boolean).join(' ')}
      onMouseEnter={() => { if (!dragging) setHoverExpand(true); }}
      onMouseLeave={() => setHoverExpand(false)}
    >
      {/* The drawer's glass shell + flared corners, drawn as one shape
          behind the content so its outline strokes the whole silhouette
          as a single united form. */}
      <div className={styles.shell} aria-hidden="true" />
      <div className={styles.list}>
        {/* Caption only once fanned open — at rest it would leave a sliver
            of space above the deck and throw off the vertical balance. */}
        {expanded && <span className={styles.listLabel}>Collections</span>}
        <div className={styles.rows}>
          {topLevel.map((c) => renderRow(c))}
        </div>
      </div>
    </div>
  );
}
