import React, { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Image as ImageGlyph,
  Link as LinkGlyph,
} from 'lucide-react';
import styles from './AddFab.module.css';

// Floating + button anchored to the bottom-right corner of the app.
// Tapping it fans the add actions upward as labelled mini-FABs (speed
// dial) while the + rotates to a ×. Visible only when the host says so
// (library tab / inside a collection); the host wires each action into
// the active collection where relevant.
export default function AddFab({ onUpload, onSaveUrl, visible = true }) {
  const [open, setOpen] = useState(false);
  // Brief flag held for the close animation: the actions stay mounted and
  // play the reverse (slide-down + fade) before hiding. Cleared after the
  // animation so they return to the resting hidden state.
  const [closing, setClosing] = useState(false);
  const dockRef = useRef(null);
  const btnRef = useRef(null);
  const closeTimerRef = useRef(null);

  const openDock = () => {
    clearTimeout(closeTimerRef.current);
    setClosing(false);
    setOpen(true);
  };
  const closeDock = () => {
    setOpen((wasOpen) => {
      if (wasOpen) {
        setClosing(true);
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => setClosing(false), 300);
      }
      return false;
    });
  };
  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (dockRef.current && !dockRef.current.contains(e.target)) closeDock();
    }
    function onEsc(e) {
      if (e.key === 'Escape') {
        closeDock();
        // Drop focus so the trigger doesn't keep a focus-visible ring
        // after a click → Esc.
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
      closeDock();
      action?.();
    };
  }

  if (!visible) return null;

  return (
    <div
      ref={dockRef}
      className={[styles.dock, open && styles.dockOpen, closing && styles.dockClosing].filter(Boolean).join(' ')}
    >
      {/* Fanned actions — Add image sits closest to the FAB (--i:0) so
          it springs out first; Save URL follows above it. */}
      <div className={styles.actions} role="menu" aria-label="Add to library" aria-hidden={!open}>
        {onSaveUrl && (
          <div className={styles.action} style={{ '--i': 1 }}>
            <span className={styles.actionLabel}>Save URL</span>
            <button
              type="button"
              role="menuitem"
              className={styles.mini}
              onClick={go(onSaveUrl)}
              tabIndex={open ? 0 : -1}
              aria-label="Save URL"
              title="Save URL"
            >
              <LinkGlyph size={18} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </div>
        )}
        {onUpload && (
          <div className={styles.action} style={{ '--i': 0 }}>
            <span className={styles.actionLabel}>Add image</span>
            <button
              type="button"
              role="menuitem"
              className={styles.mini}
              onClick={go(onUpload)}
              tabIndex={open ? 0 : -1}
              aria-label="Add image"
              title="Add image"
            >
              <ImageGlyph size={18} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <button
        ref={btnRef}
        type="button"
        className={styles.fab}
        onClick={() => (open ? closeDock() : openDock())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to library"
        title="Add to library"
      >
        <Plus className={styles.fabPlus} size={22} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
