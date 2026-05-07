import React, { useEffect, useState } from 'react';
import styles from './QuickLookOverlay.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Spacebar Quick Look — a lightweight peek of a single save without
// committing to the focused-view morph. macOS users hit space on a
// selected file in Finder and expect this exact behaviour: dim the
// background, float the image at center, dismiss with space again
// or Escape. We deliberately render a thin <img> rather than the
// full FocusedView so it stays cheap to mount/unmount on tap.
//
// `save` is the row to peek; `null` keeps the overlay unmounted.
export default function QuickLookOverlay({ save, onDismiss }) {
  // Brief, separate "open" flag so the entrance animation runs from
  // a cold mount; without this, the overlay paints in its final
  // position on the first frame and the fade reads as instant.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!save) {
      setOpen(false);
      return undefined;
    }
    // requestAnimationFrame so the .open class lands on the next
    // paint after mount, giving CSS transitions something to ease
    // from. setTimeout(0) is roughly equivalent but rAF aligns to
    // the compositor cleanly.
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, [save]);

  useEffect(() => {
    if (!save) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        onDismiss?.();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [save, onDismiss]);

  if (!save) return null;

  const src = save.file_path ? fileUrl(save.file_path) : null;

  return (
    <div
      className={`${styles.scrim} ${open ? styles.scrimOpen : ''}`}
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
      aria-label="Quick Look"
    >
      <div className={styles.frame} onClick={(e) => e.stopPropagation()}>
        {src && (
          <img
            className={styles.image}
            src={src}
            alt={save.title || ''}
            draggable={false}
          />
        )}
        {save.title && (
          <div className={styles.caption}>{save.title}</div>
        )}
      </div>
    </div>
  );
}
