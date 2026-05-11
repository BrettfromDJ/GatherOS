import React, { useEffect, useRef, useState } from 'react';
import styles from './LoadingScreen.module.css';
import { playLoading, stopLoading } from '../lib/sounds.js';

// Total time the splash is on screen before handing off to the app.
// Slightly longer than the previous 3s feels — gives the tagline room
// to be read and the loader room to feel deliberate rather than
// flashing past.
const VISIBLE_DURATION_MS = 3000;
const EXIT_DURATION_MS = 800;

export default function LoadingScreen({ onDone }) {
  const [exiting, setExiting] = useState(false);
  const startedAt = useRef(performance.now());

  // Splash sound — fade in on mount, fade out on unmount.
  useEffect(() => {
    playLoading();
    return () => stopLoading();
  }, []);

  // Hand off to the app after the visible duration + the exit fade.
  useEffect(() => {
    const t = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDone?.(), EXIT_DURATION_MS);
    }, VISIBLE_DURATION_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  const appVersion = window.moodmark?.app?.version || '';

  return (
    <div className={[styles.overlay, exiting && styles.exiting].filter(Boolean).join(' ')}>
      {appVersion && <div className={styles.version}>v{appVersion}</div>}

      <div className={styles.heroWrap}>
        <h1 className={styles.hero}>
          The internet&rsquo;s best work, organized your way.
        </h1>
      </div>

      <div className={styles.signal} aria-live="polite">
        <span className={styles.spinner} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14">
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeDasharray="14 56"
            />
          </svg>
        </span>
        <span className={styles.signalLabel}>Loading your library…</span>
      </div>
    </div>
  );
}
