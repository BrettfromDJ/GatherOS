import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Image as ImageGlyph,
  Link as LinkGlyph,
} from 'lucide-react';
import styles from './AddFab.module.css';

// Floating + button anchored to the bottom-right corner of the
// app. Replaces the toolbar's "+ Add" pill — same menu, just a
// quieter resting state and a more reachable hit area.
//
// Visible only when the host says so (library tab / inside a
// collection). When clicked inside a collection, the host passes
// through the active collection id so each item (upload / URL
// save) can also wire the new save into that collection.
export default function AddFab({ onUpload, onSaveUrl, visible = true }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Menu hangs ABOVE the button (FAB is at bottom of viewport, so
    // a menu below it would clip).
    setAnchor({
      bottom: window.innerHeight - r.top + 8,
      right: window.innerWidth - r.right,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (
        popRef.current && !popRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        // Drop focus so the trigger doesn't keep a focus-visible ring
        // after a click → Esc (Esc is keyboard, so it'd light up).
        btnRef.current?.blur();
      }
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function go(action) {
    return () => {
      setOpen(false);
      action?.();
    };
  }

  if (!visible) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={styles.fab}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to library"
        title="Add to library"
      >
        <Plus size={22} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {open && anchor && createPortal(
        <div
          ref={popRef}
          role="menu"
          className={styles.menu}
          style={{ bottom: `${anchor.bottom}px`, right: `${anchor.right}px` }}
        >
          {onUpload && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={go(onUpload)}
            >
              <span className={styles.itemIcon}>
                <ImageGlyph size={16} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span className={styles.itemLabel}>Add image</span>
            </button>
          )}
          {onSaveUrl && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={go(onSaveUrl)}
            >
              <span className={styles.itemIcon}>
                <LinkGlyph size={16} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span className={styles.itemLabel}>Save URL</span>
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
