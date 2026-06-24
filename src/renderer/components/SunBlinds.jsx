import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './SunBlinds.module.css';

const SLATS = 14;
const MOTES = 70;

// Easter egg: window blinds drawn across the whole app, frosting the
// content behind them. Hovering a slat clears its blur and flips it up
// (with a little overshoot, so it has weight) to reveal a crisp band, and
// a cool shaft of light spills through wherever the cursor is. Dust motes
// drift in the light. Click anywhere (or any key) to roll the blinds up
// from the bottom and dismiss.
export default function SunBlinds({ open, onClose }) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const overlayRef = useRef(null);
  const rafRef = useRef(0);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    // Let the staggered roll-up finish before unmounting.
    setTimeout(() => onClose?.(), 950);
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      closingRef.current = false;
      setClosing(false);
      return undefined;
    }
    window.addEventListener('keydown', requestClose);
    return () => {
      window.removeEventListener('keydown', requestClose);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [open, requestClose]);

  // Track the cursor for the light spill via CSS vars (no re-render).
  const handleMove = useCallback((e) => {
    const x = e.clientX;
    const y = e.clientY;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = overlayRef.current;
      if (!el) return;
      el.style.setProperty('--spill-x', `${x}px`);
      el.style.setProperty('--spill-y', `${y}px`);
      el.style.setProperty('--spill-o', '1');
    });
  }, []);

  const handleLeave = useCallback(() => {
    overlayRef.current?.style.setProperty('--spill-o', '0');
  }, []);

  // Stable scatter for the dust motes (per mount).
  const motes = useMemo(
    () => Array.from({ length: MOTES }, () => ({
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: 1.5 + Math.random() * 3,
      dur: 9 + Math.random() * 9,
      delay: -Math.random() * 12,
      driftX: (Math.random() * 2 - 1) * 36,
    })),
    [],
  );

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className={`${styles.overlay} ${closing ? styles.closing : ''}`}
      onClick={requestClose}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      aria-hidden="true"
    >
      <div className={styles.blinds}>
        {Array.from({ length: SLATS }).map((_, i) => (
          <span key={i} className={styles.slat} style={{ '--i': i }}>
            <span className={styles.slatShadow} />
            <span className={styles.slatBlur} />
            <span className={styles.slatFace} />
          </span>
        ))}
      </div>
      <div className={styles.wash} />
      <div className={styles.spill} />
      <div className={styles.motes}>
        {motes.map((m, i) => (
          <span
            key={i}
            className={styles.mote}
            style={{
              left: `${m.left}%`,
              top: `${m.top}%`,
              width: `${m.size}px`,
              height: `${m.size}px`,
              '--dur': `${m.dur}s`,
              '--delay': `${m.delay}s`,
              '--driftX': `${m.driftX}px`,
            }}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}
