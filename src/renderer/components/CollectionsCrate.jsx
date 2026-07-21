import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './CollectionsCrate.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Collections crate — a full-screen browse mode that presents every
// collection as a record sleeve leaning in a crate: uniform rake, layered
// left to right (leftmost in front), raking light falling across each
// face, and a colored spine picked up from the artwork. Hovering pulls a
// sleeve toward the viewer like drawing a book from a shelf; clicking a
// sleeve opens that collection. ← / → step through (Enter opens), Esc
// exits. The stage is deliberately dark in both themes — it's a
// theatre-style browse mode, not a document surface.

const FALLBACK_SPINE = '#55555a';

// Average color of a collection's first thumbnail → its sleeve spine.
// Sampled through a tiny canvas; wrapped in try/catch so a tainted canvas
// (or unreadable file) just keeps the neutral fallback.
function useSpineColors(collections, open) {
  const [colors, setColors] = useState({});
  const done = useRef(new Set());
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    for (const c of collections) {
      const src = Array.isArray(c.thumbs) ? c.thumbs[0] : null;
      if (!src || done.current.has(c.id)) continue;
      done.current.add(c.id);
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        try {
          const cv = document.createElement('canvas');
          cv.width = 8; cv.height = 8;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, 8, 8);
          const d = ctx.getImageData(0, 0, 8, 8).data;
          let r = 0, g = 0, b = 0;
          for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
          const n = d.length / 4;
          setColors((prev) => ({
            ...prev,
            [c.id]: `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`,
          }));
        } catch { /* tainted canvas — keep the fallback spine */ }
      };
      img.src = fileUrl(src);
    }
    return () => { alive = false; };
  }, [collections, open]);
  return colors;
}

export default function CollectionsCrate({ open, collections, onOpenCollection, onCreateCollection, onClose }) {
  const rowRef = useRef(null);
  const slotRefs = useRef([]);
  const [hovIdx, setHovIdx] = useState(null);
  const [sel, setSel] = useState(0);
  const lastPoint = useRef(null);
  const spines = useSpineColors(collections || [], open);

  const items = Array.isArray(collections) ? collections : [];
  const N = items.length;

  // Reset per open so the entrance replays and stale hover can't linger.
  useEffect(() => {
    if (open) { setHovIdx(null); setSel(0); lastPoint.current = null; }
  }, [open]);

  const centerOn = useCallback((i, instant) => {
    const el = slotRefs.current[i];
    if (el) el.scrollIntoView({ behavior: instant ? 'instant' : 'smooth', inline: 'center', block: 'nearest' });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSel((s) => { const next = Math.max(0, s - 1); centerOn(next); return next; });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSel((s) => { const next = Math.min(N - 1, s + 1); centerOn(next); return next; });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const c = items[sel];
        if (c) onOpenCollection?.(c.id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, N, sel, items, onClose, onOpenCollection, centerOn]);

  // Hover is derived from the pointer's slot column — never CSS :hover,
  // which goes stale when the row scrolls under a stationary mouse (no
  // mouseleave fires) and leaves a sleeve stuck pulled-out. Re-derived on
  // every mousemove AND every scroll.
  const hovFromPoint = useCallback((x, y) => {
    const el = document.elementFromPoint(x, y);
    const slot = el ? el.closest(`.${styles.slot}`) : null;
    setHovIdx(slot ? Number(slot.dataset.idx) : null);
  }, []);
  const onMouseMove = useCallback((e) => {
    lastPoint.current = [e.clientX, e.clientY];
    const slot = e.target.closest ? e.target.closest(`.${styles.slot}`) : null;
    setHovIdx(slot ? Number(slot.dataset.idx) : null);
  }, []);
  const onMouseLeave = useCallback(() => { lastPoint.current = null; setHovIdx(null); }, []);
  const onScroll = useCallback(() => {
    if (lastPoint.current) hovFromPoint(lastPoint.current[0], lastPoint.current[1]);
  }, [hovFromPoint]);

  if (!open) return null;

  return (
    <div className={styles.scrim} role="dialog" aria-label="Browse collections">
      <div
        className={styles.row}
        ref={rowRef}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onScroll={onScroll}
      >
        {items.map((c, i) => {
          // Full-quality cover (preview/original) for the big sleeve face —
          // thumb_path is grid-tile sized and reads blurry at 320px wide.
          const face = c.cover || (Array.isArray(c.thumbs) ? c.thumbs[0] : null);
          const cls = [
            styles.slot,
            i === hovIdx ? styles.hov : '',
            i === sel ? styles.sel : '',
          ].filter(Boolean).join(' ');
          return (
            <div
              key={c.id}
              ref={(el) => { slotRefs.current[i] = el; }}
              className={cls}
              data-idx={i}
              style={{
                '--i': Math.min(i, 14),
                '--spine': spines[c.id] || FALLBACK_SPINE,
                zIndex: 10 + (N - i), // leftmost sleeve always in front
              }}
              onClick={() => { setSel(i); onOpenCollection?.(c.id); }}
            >
              <div className={styles.lab}>
                <div className={styles.labName}>{c.name}</div>
                <div className={styles.labMeta}>{(c.save_count ?? 0).toLocaleString()} saves</div>
                <div className={styles.labTick}>▸</div>
              </div>
              <div className={styles.covw}>
                <div className={styles.c3d}>
                  <div className={styles.cov}>
                    {face ? (
                      <img src={fileUrl(face)} alt="" draggable={false} />
                    ) : (
                      <span className={styles.letter}>{(c.name || '?').trim().charAt(0).toUpperCase()}</span>
                    )}
                    <i className={styles.shade} />
                  </div>
                  <div className={styles.edge} />
                </div>
              </div>
            </div>
          );
        })}
        {N === 0 && <div className={styles.empty}>No collections yet</div>}
      </div>
      <div className={styles.deck}>
        <div className={styles.hintRow}>
          <div className={styles.hint}>
            {onClose
              ? '← → to browse · click a sleeve to open · esc to close'
              : '← → to browse · click a sleeve to open'}
          </div>
          {onCreateCollection && (
            <button type="button" className={styles.hintBtn} onClick={onCreateCollection}>
              ＋ new collection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
