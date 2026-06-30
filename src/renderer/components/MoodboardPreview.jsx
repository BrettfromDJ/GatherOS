import React, { useEffect, useState } from 'react';
import styles from './MoodboardPreview.module.css';
import { resolveAsset } from '../lib/asset.js';

// Live, hover-only preview of the moodboard GIF. It mirrors the exported
// file exactly: a square #E2E2E0 frame, every image contained with even
// padding, and a hard cut to the next image every 0.6s (no transition —
// same as gifenc's per-frame delay). Videos are already filtered out by
// the caller, matching the export.
export default function MoodboardPreview({ saves }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
    if (saves.length <= 1) return undefined;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % saves.length);
    }, 600);
    return () => clearInterval(t);
  }, [saves.length]);

  if (saves.length === 0) return null;
  const safeIdx = Math.min(idx, saves.length - 1);

  return (
    <div className={styles.pop} aria-hidden="true">
      <div className={styles.frame}>
        {saves.map((s, i) => (
          <img
            key={s.id}
            src={resolveAsset(s, 'thumb')}
            alt=""
            draggable={false}
            className={styles.img}
            style={{ opacity: i === safeIdx ? 1 : 0 }}
          />
        ))}
        <span className={styles.dots}>
          {saves.map((s, i) => (
            <span
              key={s.id}
              className={i === safeIdx ? styles.dotOn : styles.dot}
            />
          ))}
        </span>
      </div>
      <div className={styles.caption}>{saves.length} frames · 0.6s each</div>
    </div>
  );
}
