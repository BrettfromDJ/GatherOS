import React, { useEffect, useRef, useState } from 'react';
import styles from './LoadingScreen.module.css';
import { fileUrl } from '../lib/fileUrl.js';

const TARGET_CARDS = 4;
// ~2.4s feel — matches the time the cards need to settle into their
// fan and the user's eye to register the count climbing.
const COUNT_DURATION_MS = 2400;
// Time the exit animation needs to finish before the overlay unmounts
// (longest card transition + its delay).
const EXIT_DURATION_MS = 760;

function PlaceholderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="1.6" fill="currentColor" stroke="none" />
      <path d="M3 17l5-5 4 4 3-3 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function LoadingScreen({ onDone }) {
  const [percent, setPercent] = useState(0);
  const [images, setImages] = useState([]);
  const [exiting, setExiting] = useState(false);
  const startedAt = useRef(performance.now());

  // Pull the four most recent saves to populate the stack. If there
  // are fewer than 4, we pad with placeholders so the silhouette is
  // intact.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await window.moodmark.saves.getAll({ sort: 'newest', view: 'all' });
        if (cancelled) return;
        setImages((data || []).slice(0, TARGET_CARDS));
      } catch {
        if (!cancelled) setImages([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Smooth 0→100 driven by rAF rather than setInterval — keeps the
  // percent in lockstep with the bar fill and stays accurate even if
  // the tab is briefly throttled.
  useEffect(() => {
    let raf = 0;
    const tick = (now) => {
      const elapsed = now - startedAt.current;
      const pct = Math.min(100, Math.round((elapsed / COUNT_DURATION_MS) * 100));
      setPercent(pct);
      if (pct < 100) {
        raf = requestAnimationFrame(tick);
      } else {
        setExiting(true);
        setTimeout(() => onDone?.(), EXIT_DURATION_MS);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  // Always render exactly TARGET_CARDS slots so the resting fan has
  // its expected silhouette.
  const slots = Array.from({ length: TARGET_CARDS }, (_, i) => images[i] || null);

  return (
    <div className={[styles.overlay, exiting && styles.exiting].filter(Boolean).join(' ')}>
      <div className={styles.stack}>
        {slots.map((s, i) => (
          <div className={styles.card} key={s?.id ?? `empty-${i}`}>
            {s ? (
              <img
                className={styles.cardImg}
                /* file_path first — the splash card is large enough that
                   the small thumb_path renders soft. Fall back to thumb
                   only if the original is missing. */
                src={fileUrl(s.file_path || s.thumb_path)}
                alt=""
                draggable={false}
              />
            ) : (
              <div className={styles.cardEmpty}>
                <PlaceholderIcon />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={styles.counter}>
        <div className={styles.percent}>
          {percent}<span className={styles.sign}>%</span>
        </div>
        <div className={styles.bar}>
          <div className={styles.barFill} style={{ width: `${percent}%` }} />
        </div>
        <div className={styles.label}>Loading your library</div>
      </div>
    </div>
  );
}
