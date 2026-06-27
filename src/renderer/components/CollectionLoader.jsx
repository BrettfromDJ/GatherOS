import React, { useMemo } from 'react';
import styles from './CollectionLoader.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Brief opening flourish when you enter a collection: its images wrap into
// a 3D ring that slowly rotates, then the overlay fades to reveal the grid.
// Purely decorative — the grid is ready underneath the whole time.
//
// The ring is always the same size (RING_SIZE cards) regardless of how many
// images the collection has — small collections repeat their images in
// order to fill the band; large ones just use the first RING_SIZE.
const RING_SIZE = 12;

export default function CollectionLoader({ thumbs = [], name, fading = false }) {
  const cards = useMemo(() => {
    // Distinct source images (so repeats are spaced evenly), then cycle to
    // always fill a fixed-size ring.
    const seen = new Set();
    const src = [];
    for (const t of thumbs || []) {
      if (t && !seen.has(t)) { seen.add(t); src.push(t); }
    }
    if (src.length === 0) return [];
    return Array.from({ length: RING_SIZE }, (_, i) => src[i % src.length]);
  }, [thumbs]);

  if (cards.length === 0) return null;

  const n = cards.length;
  const cardW = 78;
  // Radius that seats N cards of width cardW evenly around the ring with a
  // little breathing room.
  const radius = Math.round((cardW * 1.18) / (2 * Math.tan(Math.PI / n)));

  return (
    <div className={`${styles.overlay}${fading ? ` ${styles.out}` : ''}`} aria-hidden="true">
      <div className={styles.scene}>
        {/* Tilt + push-back live on the wrapper (dynamic radius); the ring
            child just spins, so the animation never fights the transform. */}
        <div
          className={styles.tilt}
          style={{ transform: `rotateX(-14deg) translateZ(${-radius}px)` }}
        >
          <div className={styles.ring}>
            {cards.map((t, i) => (
              <div
                key={i}
                className={styles.card}
                style={{ transform: `rotateY(${(360 / n) * i}deg) translateZ(${radius}px)` }}
              >
                <img src={fileUrl(t)} alt="" draggable={false} />
              </div>
            ))}
          </div>
        </div>
      </div>
      {name && <div className={styles.label}>{name}</div>}
    </div>
  );
}
