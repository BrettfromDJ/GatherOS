import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './SunBlinds.module.css';

const SLATS = 14;
const MOTES = 55;

// Easter egg: window blinds drawn across the whole app, frosting the
// content behind them. Hovering a slat clears its blur and flips it up
// (with a little overshoot, so it has weight) to reveal a crisp band.
// Dust motes drift through the air the whole time. Click anywhere (or any
// key) to roll the blinds up from the bottom and dismiss.
export default function SunBlinds({ open, onClose }) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

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
    return () => window.removeEventListener('keydown', requestClose);
  }, [open, requestClose]);

  // Stable scatter for the dust motes (per mount).
  const motes = useMemo(
    () => Array.from({ length: MOTES }, () => ({
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: 1.5 + Math.random() * 3,
      dur: 7 + Math.random() * 10,
      delay: -Math.random() * 16,
      driftX: (Math.random() * 2 - 1) * 48,
    })),
    [],
  );

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
            <span className={styles.slatShadow} />
            <span className={styles.slatBlur} />
            <span className={styles.slatFace} />
          </span>
        ))}
      </div>
      <div className={styles.wash} />
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
