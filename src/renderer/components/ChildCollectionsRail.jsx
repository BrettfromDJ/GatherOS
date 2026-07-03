import React, { useState } from 'react';
import { FolderClosed, Plus } from 'lucide-react';
import { fileUrl } from '../lib/fileUrl.js';
import { extractDropImageUrls } from '../lib/dropUrls.js';
import styles from './ChildCollectionsRail.module.css';

// MIME the masonry cards use to advertise "I'm a drag of save ids".
// Keep in sync with FeaturedBuckets / CollectionDropDock.
const SAVE_DROP_MIME = 'application/x-moodmark-save-ids';

// Drill-in nesting, the calm half: the top-level collection displays
// never change — children only surface HERE, as a compact rail above a
// parent collection's saves. One level deep by design (the DB enforces
// it), so this rail never recurses.
//
// Cards are full drop targets with the same contract as FeaturedBuckets:
// internal card drags (save ids), Finder files, and browser image URLs
// all file into the child. The natural gesture — dragging one of the
// parent's saves onto a child card — must just work.
export default function ChildCollectionsRail({
  childCollections = [],
  onPick,
  onCreateChild,
  onAddSavesToBucket,
  onDropFilesToBucket,
  onExternalDropToBucket,
  onSetAppDragging,
}) {
  const [dropTargetId, setDropTargetId] = useState(null);
  // Render even with zero children so the create card is always
  // discoverable — this rail is the natural place to start nesting.
  // Without a create handler there'd be nothing to show, so bail.
  if (!childCollections.length && !onCreateChild) return null;

  const isSaveDrag = (e) => e.dataTransfer.types.includes(SAVE_DROP_MIME);
  const isFileDrag = (e) => e.dataTransfer.types.includes('Files');
  const isUrlDrag = (e) => {
    const t = e.dataTransfer.types;
    return t.includes('text/uri-list') || t.includes('text/html');
  };

  const handleDragOver = (e, id) => {
    if (!isSaveDrag(e) && !isFileDrag(e) && !isUrlDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (dropTargetId !== id) setDropTargetId(id);
    // The card owns this drop — suppress the global "Drop to save"
    // overlay while the cursor hovers it.
    onSetAppDragging?.(false);
  };

  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDropTargetId(null);
  };

  const handleDrop = async (e, id) => {
    if (!isSaveDrag(e) && !isFileDrag(e) && !isUrlDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    onSetAppDragging?.(false);
    // External drops (Finder files + browser URLs) first — prefer the
    // URL when the browser supplies both, matching FeaturedBuckets.
    const files = isFileDrag(e) ? [...e.dataTransfer.files] : [];
    const urls = isUrlDrag(e) ? extractDropImageUrls(e.dataTransfer) : [];
    if (files.length > 0 || urls.length > 0) {
      if (onExternalDropToBucket) {
        await onExternalDropToBucket(id, { files, urls });
      } else if (files.length > 0) {
        await onDropFilesToBucket?.(id, e.dataTransfer.files);
      }
      return;
    }
    let ids;
    try { ids = JSON.parse(e.dataTransfer.getData(SAVE_DROP_MIME) || '[]'); }
    catch { return; }
    if (!Array.isArray(ids) || ids.length === 0) return;
    await onAddSavesToBucket?.(id, ids);
  };

  return (
    <section className={styles.rail} aria-label="Collections inside this collection">
      <div className={styles.label}>Inside this collection</div>
      <div className={styles.row}>
        {childCollections.map((c) => {
          const cover = Array.isArray(c.thumbs) && c.thumbs.length > 0 ? c.thumbs[0] : null;
          const count = c.save_count || 0;
          return (
            <button
              key={c.id}
              type="button"
              className={[styles.card, dropTargetId === c.id && styles.cardDropTarget]
                .filter(Boolean).join(' ')}
              onClick={() => onPick?.(c.id)}
              onDragOver={(e) => handleDragOver(e, c.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, c.id)}
            >
              {cover ? (
                <img className={styles.cover} src={fileUrl(cover)} alt="" draggable={false} loading="lazy" />
              ) : (
                <span className={`${styles.cover} ${styles.coverEmpty}`} aria-hidden="true">
                  <FolderClosed size={18} strokeWidth={1.5} />
                </span>
              )}
              <span className={styles.meta}>
                <span className={styles.name}>{c.name}</span>
                <span className={styles.count}>
                  {count} {count === 1 ? 'save' : 'saves'}
                  {dropTargetId === c.id && (
                    <span className={styles.countAdd} aria-hidden="true"> +1</span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
        {onCreateChild && (
          <button
            type="button"
            className={`${styles.card} ${styles.cardNew}`}
            onClick={onCreateChild}
          >
            <span className={`${styles.cover} ${styles.coverEmpty}`} aria-hidden="true">
              <Plus size={16} strokeWidth={1.6} />
            </span>
            <span className={styles.meta}>
              <span className={`${styles.name} ${styles.nameMuted}`}>New collection</span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
