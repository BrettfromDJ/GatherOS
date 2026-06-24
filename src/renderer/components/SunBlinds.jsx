import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './SunBlinds.module.css';

const SLATS = 14;

// Easter egg: warm window blinds drawn across the whole app. The slats
// drop in, then stay up so you can peek — hovering an individual slat
// flips it up on its top hinge (3D rotateX) and lifts its warm tint
// away, leaving the app behind that band fully visible with no overlay.
// Each slat is a fixed transparent hit area wrapping a face that flips,
// so the cursor never loses the slat as it folds away (no flicker).
// Click anywhere (or press any key) to draw them back and dismiss.
export default function SunBlinds({ open, onClose }) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    // Let the fade-out play before unmounting.
    setTimeout(() => onClose?.(), 460);
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      closingRef.current = false;
      setClosing(false);
      return undefined;
    }
    window.addEventListener('keydown', requestClose);
    return () => window.removeEventListener('keydown', requestClose);
  }, [open, requestClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={`${styles.overlay} ${closing ? styles.closing : ''}`}
      onClick={requestClose}
      aria-hidden="true"
    >
      <div className={styles.blinds}>
        {Array.from({ length: SLATS }).map((_, i) => (
          <span key={i} className={styles.slat} style={{ '--i': i }}>
            <span className={styles.slatFace} />
          </span>
        ))}
      </div>
    </div>,
    document.body,
  );
}
