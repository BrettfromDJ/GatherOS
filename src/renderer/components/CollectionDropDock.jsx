import React, { useState } from 'react';
import styles from './CollectionDropDock.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { extractDropImageUrls } from '../lib/dropUrls.js';

const SAVE_DROP_MIME = 'application/x-moodmark-save-ids';

// Drag-activated dock: a slim strip of collection drop-targets that
// slides in under the toolbar the moment a save is picked up, so you can
// file it without scrolling back up to the featured row. Mounted (hidden)
// whenever there are collections; `visible` drives the slide + arms the
// pointer events. Mirrors FeaturedBuckets' drop routing so it accepts
// in-app saves, Finder files, and dragged browser images alike.
export default function CollectionDropDock({
  collections,
  visible,
  onAddSavesToBucket,
  onDropFilesToBucket,
  onExternalDropToBucket,
  onSetAppDragging,
  onDismiss,
}) {
  const [dropTargetId, setDropTargetId] = useState(null);
  if (!collections || collections.length === 0) return null;

  const isSaveDrag = (e) => e.dataTransfer.types.includes(SAVE_DROP_MIME);
  const isFileDrag = (e) => e.dataTransfer.types.includes('Files');
  const isUrlDrag = (e) => {
    const t = e.dataTransfer.types;
    return t.includes('text/uri-list') || t.includes('text/html');
  };

  function handleChipDragOver(e, id) {
    if (!isSaveDrag(e) && !isFileDrag(e) && !isUrlDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (dropTargetId !== id) setDropTargetId(id);
    // Suppress the full-screen "Drop to save" overlay while hovering a
    // real target — the chip's own highlight says where it lands.
    onSetAppDragging?.(false);
  }

  function handleChipDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setDropTargetId(null);
  }

  async function handleChipDrop(e, id) {
    if (!isSaveDrag(e) && !isFileDrag(e) && !isUrlDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    onSetAppDragging?.(false);
    const files = isFileDrag(e) ? [...e.dataTransfer.files] : [];
    const urls = isUrlDrag(e) ? extractDropImageUrls(e.dataTransfer) : [];
    if (files.length > 0 || urls.length > 0) {
      if (onExternalDropToBucket) {
        await onExternalDropToBucket(id, { files, urls });
      } else if (files.length > 0) {
        await onDropFilesToBucket?.(id, e.dataTransfer.files);
      }
    } else {
      let ids;
      try { ids = JSON.parse(e.dataTransfer.getData(SAVE_DROP_MIME) || '[]'); }
      catch { ids = []; }
      if (Array.isArray(ids) && ids.length > 0) await onAddSavesToBucket?.(id, ids);
    }
    onDismiss?.();
  }

  return (
    <div
      className={[styles.dock, visible && styles.visible].filter(Boolean).join(' ')}
      aria-hidden={!visible}
    >
      <span className={styles.hint}>Drop into</span>
      <div className={styles.chips}>
        {collections.map((c) => {
          const thumbs = Array.isArray(c.thumbs) ? c.thumbs.slice(0, 4) : [];
          const isTarget = dropTargetId === c.id;
          return (
            <div
              key={c.id}
              className={[styles.chip, isTarget && styles.chipTarget].filter(Boolean).join(' ')}
              onDragOver={(e) => handleChipDragOver(e, c.id)}
              onDragLeave={handleChipDragLeave}
              onDrop={(e) => handleChipDrop(e, c.id)}
              title={c.name}
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
              <span className={styles.name}>{c.name}</span>
              {isTarget && <span className={styles.plus} aria-hidden="true">+1</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
