import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './CollectionsCrate.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Collections crate — a full-screen browse mode that presents every
// collection as a record sleeve leaning in a crate: uniform rake, layered
// left to right (leftmost in front), raking light falling across each
// face, and a colored spine picked up from the artwork. Hovering (or
// keyboard-selecting) pulls a sleeve toward the viewer like drawing a book
// from a shelf; clicking a sleeve opens that collection. ← / → step through
// (Enter opens), Esc exits. The stage is deliberately dark in both themes.

const FALLBACK_SPINE = '#55555a';
const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|m4v|avi)$/i;
const isVideoSrc = (s) => !!s && VIDEO_EXT_RE.test(s);

// The full-quality cover (preview/original) for the big sleeve face —
// thumb_path is grid-tile sized and reads blurry at 320px wide.
function coverOf(c) {
  return c.cover || (Array.isArray(c.thumbs) ? c.thumbs[0] : null);
}
// A still image to poster a video cover / sample its spine from, if any.
function posterOf(c) {
  const t = Array.isArray(c.thumbs) ? c.thumbs.find((x) => !isVideoSrc(x)) : null;
  return t || null;
}

export default function CollectionsCrate({ open, collections, onOpenCollection, onCreateCollection, onClose }) {
  const rowRef = useRef(null);
  const slotRefs = useRef([]);
  const [hovIdx, setHovIdx] = useState(null);
  const [sel, setSel] = useState(0);
  const lastPoint = useRef(null);

  // Spine colors, sampled from the sleeve's own rendered <img>/<video> as
  // it loads — no second full-res fetch. Keyed by id+src so a changed
  // cover re-samples rather than reusing the old edge color.
  const [spines, setSpines] = useState({});
  const sampledRef = useRef(new Set());
  const sampleSpine = useCallback((id, src, el) => {
    const key = `${id}:${src || ''}`;
    if (!el || sampledRef.current.has(key)) return;
    sampledRef.current.add(key);
    try {
      const cv = document.createElement('canvas');
      cv.width = 8; cv.height = 8;
      const ctx = cv.getContext('2d');
      ctx.drawImage(el, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      setSpines((prev) => ({ ...prev, [id]: `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})` }));
    } catch { /* tainted/undecoded — keep the fallback spine */ sampledRef.current.delete(key); }
  }, []);

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
    // Arrow navigation hands control to the keyboard: clear the pointer
    // hover (and the stored pointer position, so the centering scroll
    // doesn't re-derive hover from a stationary cursor) so the keyboard
    // selection becomes the active sleeve. A real mouse move re-takes over.
    const toKeyboard = () => { lastPoint.current = null; setHovIdx(null); };
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        toKeyboard();
        setSel((s) => { const next = Math.max(0, s - 1); centerOn(next); return next; });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        toKeyboard();
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
  // mouseleave fires) and leaves a sleeve stuck pulled-out. A pointer
  // hover overrides the keyboard selection's active state.
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

  // The active sleeve = the hovered one if the pointer is over a sleeve,
  // otherwise the keyboard selection. So arrow keys always light exactly
  // one sleeve (and its label), and the mouse takes over when used.
  const activeIdx = hovIdx != null ? hovIdx : sel;

  return (
    <div
      className={styles.scrim}
      role="dialog"
      aria-label="Browse collections"
      /* Opt the whole crate out of the app-shell's horizontal-swipe
         navigation — without this, sideways-scrolling the sleeves trips
         the global wheel handler that flips between smart views and
         collections one by one. */
      data-allow-horizontal-scroll="true"
    >
      <div
        className={styles.row}
        ref={rowRef}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onScroll={onScroll}
      >
        {items.map((c, i) => {
          const face = coverOf(c);
          const faceIsVideo = isVideoSrc(face);
          const poster = posterOf(c);
          const cls = [
            styles.slot,
            i === activeIdx ? styles.active : '',
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
                    {faceIsVideo ? (
                      // Video cover: the #t fragment + preload="metadata"
                      // paints its first frame at rest without fetching the
                      // whole clip; the poster is a pre-decode fallback.
                      <video
                        src={`${fileUrl(face)}#t=0.001`}
                        poster={poster ? fileUrl(poster) : undefined}
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedData={(e) => sampleSpine(c.id, face, e.currentTarget)}
                      />
                    ) : face ? (
                      <img
                        src={fileUrl(face)}
                        alt=""
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                        onLoad={(e) => sampleSpine(c.id, face, e.currentTarget)}
                      />
                    ) : null}
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
              ＋ New collection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
