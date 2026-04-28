import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import styles from './MilestoneToast.module.css';

// Per-milestone subline. The number itself is shown in the heading;
// the subline gives each milestone its own little voice.
const SUBLINES = {
  10: 'Off to a good start.',
  25: 'A real collection forming.',
  50: 'Halfway to a hundred.',
  75: 'Now you’re cooking.',
  100: 'You’re a real one.',
};

const COLORS = ['#34c759', '#ffcc00', '#ff9500', '#0a84ff', '#af52de', '#ff3b30', '#5ac8fa', '#ff2d55'];

function SparkleIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 1.5l1.6 4.4L16 7.5l-4.4 1.6L10 13.5l-1.6-4.4L4 7.5l4.4-1.6z" />
      <path d="M15.5 11.5l0.7 2 2 0.7-2 0.7-0.7 2-0.7-2-2-0.7 2-0.7z" opacity="0.85" />
      <path d="M4.5 13l0.5 1.5 1.5 0.5-1.5 0.5-0.5 1.5-0.5-1.5-1.5-0.5 1.5-0.5z" opacity="0.7" />
    </svg>
  );
}

export default function MilestoneToast({ count, onDone }) {
  const subline = SUBLINES[count] || 'Nice.';

  // Pre-roll a fixed set of particle vectors for this burst — kept
  // stable across re-renders so the motion is consistent for the
  // duration of the animation.
  const particles = useMemo(() => Array.from({ length: 32 }, (_, i) => {
    // Spread upward in a wide arc above the toast (-180° to 0° = up
    // half-circle). Bias the distance for a roomy fan.
    const angle = -180 + Math.random() * 180;
    const distance = 80 + Math.random() * 110;
    return {
      id: i,
      dx: Math.cos((angle * Math.PI) / 180) * distance,
      dy: Math.sin((angle * Math.PI) / 180) * distance,
      rot: Math.random() * 720 - 360,
      delay: Math.random() * 120,
      // Mix of squares and skinny rectangles for variety.
      width: 5 + Math.random() * 5,
      height: i % 3 === 0 ? 9 + Math.random() * 5 : 5 + Math.random() * 5,
      color: COLORS[i % COLORS.length],
    };
  }), []);

  useEffect(() => {
    // Toast plays in (380ms) → holds → exits at 3400ms → ends ~3720ms.
    // Unmount on the safe side so the exit transition has time to
    // finish before React strips the element.
    const t = setTimeout(onDone, 3800);
    return () => clearTimeout(t);
  }, [onDone]);

  return createPortal(
    <>
      <div className={styles.confetti} aria-hidden="true">
        {particles.map((p) => (
          <span
            key={p.id}
            className={styles.confettiPiece}
            style={{
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rot}deg`,
              '--delay': `${p.delay}ms`,
              width: `${p.width}px`,
              height: `${p.height}px`,
              background: p.color,
            }}
          />
        ))}
      </div>
      <div className={styles.toast} role="status" aria-live="polite">
        <span className={styles.icon}><SparkleIcon /></span>
        <div className={styles.body}>
          <span className={styles.heading}>{count} saves</span>
          <span className={styles.sub}>{subline}</span>
        </div>
      </div>
    </>,
    document.body,
  );
}
