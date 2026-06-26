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
  onDismiss,
}) {
  const [hoverExpand, setHoverExpand] = useState(false);
  const [dropTargetId, setDropTargetId] = useState(null);
  if (!collections || collections.length === 0) return null;

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

  // Handle artwork: the lead thumbnail of the few most-recent collections,
  // stacked, so the tab reads as "your collections live here".
  const handleThumbs = collections
    .map((c) => (Array.isArray(c.thumbs) && c.thumbs[0]) || null)
    .filter(Boolean)
    .slice(0, 3);

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
      <div className={styles.list}>
        <span className={styles.listLabel}>Collections</span>
        <div className={styles.rows}>
          {collections.map((c) => {
            const thumbs = Array.isArray(c.thumbs) ? c.thumbs.slice(0, 4) : [];
            // Already contains every dragged save → not a valid drop;
            // mark it and refuse the drop instead of silently adding a dupe.
            const already = !!(inCollectionIds && inCollectionIds.has(c.id));
            const isTarget = !already && dropTargetId === c.id;
            return (
              <div
                key={c.id}
                className={[
                  styles.row,
                  already && styles.rowIn,
                  isTarget && styles.rowTarget,
                ].filter(Boolean).join(' ')}
                onDragOver={already ? undefined : (e) => handleRowDragOver(e, c.id)}
                onDragLeave={already ? undefined : handleRowDragLeave}
                onDrop={already ? undefined : (e) => handleRowDrop(e, c.id)}
                title={already ? `${c.name} — already in this collection` : c.name}
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
                  ) : (
                    <span className={styles.rowCount}>{(c.save_count ?? 0).toLocaleString()}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.handle} aria-hidden="true">
        <span className={styles.handleStack}>
          {handleThumbs.length > 0 ? (
            handleThumbs.map((t, i) => (
              <img key={`${i}-${t}`} src={fileUrl(t)} alt="" draggable={false} />
            ))
          ) : (
            <span className={styles.handleDot} />
          )}
        </span>
      </div>
    </div>
  );
}
