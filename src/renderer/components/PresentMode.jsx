import React, { useCallback, useEffect, useState } from 'react';
import styles from './PresentMode.module.css';
import { resolveAsset } from '../lib/asset.js';

// How many neighbours to render on each side of the active item. Kept
// small — the rest are off-screen / fully faded anyway.
const WINDOW = 4;

// Coverflow geometry (tunable). X in vw so it scales with the window; Z
// in px; angle/scale linear in the offset. Side panels rotate to face the
// centre, so they read as wrapping toward the viewer.
const BASE_VW = 46;     // x of the first neighbour
const STEP_VW = 18;     // additional x per further neighbour
const DEPTH_PX = 180;   // z recession per step
const ANGLE_DEG = 46;   // rotateY of side panels
const SCALE_STEP = 0.09;
const OPACITY_STEP = 0.2;

function transformFor(k) {
  if (k === 0) return 'translateX(0) translateZ(0) rotateY(0deg) scale(1)';
  const sign = k > 0 ? 1 : -1;
  const ak = Math.abs(k);
  const xvw = sign * (BASE_VW + (ak - 1) * STEP_VW);
  const z = -ak * DEPTH_PX;
  const ry = -sign * ANGLE_DEG; // face the centre
  const s = Math.max(0.5, 1 - ak * SCALE_STEP);
  return `translateX(${xvw}vw) translateZ(${z}px) rotateY(${ry}deg) scale(${s})`;
}

function srcFor(s, full) {
  if (!s) return '';
  // Videos/tweets have no displayable original <img>; use the poster /
  // rendered thumbnail. Images use the full original when centred.
  const isImage = s.kind !== 'video' && s.kind !== 'tweet';
  return resolveAsset(s, isImage && full ? 'original' : 'thumb');
}

export default function PresentMode({ saves, name, startIndex = 0, onClose }) {
  const items = Array.isArray(saves) ? saves : [];
  const n = items.length;
  const [active, setActive] = useState(() => Math.min(Math.max(0, startIndex), Math.max(0, n - 1)));
  const [playing, setPlaying] = useState(false);

  const go = useCallback((dir) => {
    setActive((i) => (n ? ((i + dir) % n + n) % n : 0));
  }, [n]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose?.(); }
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'p' || e.key === 'P') { setPlaying((p) => !p); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, onClose]);

  useEffect(() => {
    if (!playing || n < 2) return undefined;
    const id = setInterval(() => go(1), 3800);
    return () => clearInterval(id);
  }, [playing, go, n]);

  if (!n) return null;

  // Build the render window, choosing the nearest signed offset for each
  // image index so wrap-around stays smooth and keys stay stable (so the
  // same DOM node animates as the carousel rotates).
  const w = Math.min(WINDOW, Math.floor((n - 1) / 2));
  const byIdx = new Map();
  for (let k = -w; k <= w; k += 1) {
    const idx = ((active + k) % n + n) % n;
    if (!byIdx.has(idx) || Math.abs(k) < Math.abs(byIdx.get(idx))) byIdx.set(idx, k);
  }

  return (
    <div className={styles.scene} role="dialog" aria-label={`Presenting ${name || 'collection'}`}>
      <div className={styles.stage} aria-hidden="true" />
      <div className={styles.track}>
        {[...byIdx.entries()].map(([idx, k]) => (
          <div
            key={idx}
            className={[styles.item, k === 0 && styles.itemActive].filter(Boolean).join(' ')}
            style={{
              transform: transformFor(k),
              opacity: k === 0 ? 1 : Math.max(0, 1 - Math.abs(k) * OPACITY_STEP),
              zIndex: 100 - Math.abs(k),
            }}
            onClick={() => { if (k !== 0) setActive(idx); }}
          >
            <img src={srcFor(items[idx], Math.abs(k) <= 1)} alt="" draggable={false} />
          </div>
        ))}
      </div>

      {name && <div className={styles.title}>{name}</div>}

      <button type="button" className={styles.exit} onClick={onClose} aria-label="Exit present mode">
        Esc
      </button>

      <div className={styles.controls}>
        <button type="button" onClick={() => go(-1)} aria-label="Previous">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 5l12 7-12 7z" /></svg>
          )}
        </button>
        <button type="button" onClick={() => go(1)} aria-label="Next">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>

      <div className={styles.counter}>{active + 1} / {n}</div>
    </div>
  );
}
