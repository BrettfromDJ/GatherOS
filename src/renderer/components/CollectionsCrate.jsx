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
  const [sel, setSel] = useState(-1); // -1 = nothing active until hover/arrow
  const lastPoint = useRef(null);

  // Spine colors, sampled from the sleeve's own rendered <img>/<video> as
  // it loads — no second full-res fetch. Keyed by id+src so a changed
  // cover re-samples rather than reusing the old edge color.
  const [spines, setSpines] = useState({});
  const sampledRef = useRef(new Set());
  // Spine results are batched. Writing each cover's color to state the moment
  // it loaded re-rendered the whole crate once per sleeve (N covers → N full
  // renders), which is what made the page stutter as it filled in. Instead we
  // collect colors in a ref and flush them to state together, off the render
  // path, so the crate re-renders a couple of times rather than dozens.
  const pendingSpines = useRef({});
  const flushHandle = useRef(0);
  const flushSpines = useCallback(() => {
    if (flushHandle.current) return;
    const run = () => {
      flushHandle.current = 0;
      const pending = pendingSpines.current;
      pendingSpines.current = {};
      if (Object.keys(pending).length) setSpines((prev) => ({ ...prev, ...pending }));
    };
    flushHandle.current = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(run, { timeout: 500 })
      : setTimeout(run, 120);
  }, []);
  const sampleSpine = useCallback((id, src, el) => {
    const key = `${id}:${src || ''}`;
    if (!el || sampledRef.current.has(key)) return;
    sampledRef.current.add(key);
    const measure = () => {
      try {
        const S = 24;
        const cv = document.createElement('canvas');
        cv.width = S; cv.height = S;
        const ctx = cv.getContext('2d');
        ctx.drawImage(el, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data;
        // Saturation-weighted average: colorful pixels count far more than
        // the (often black) background, so the spine picks up the cover's
        // vivid color instead of a muddy overall average.
        let wr = 0, wg = 0, wb = 0, wsum = 0;
        let ar = 0, ag = 0, ab = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          ar += r; ag += g; ab += b; n += 1;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          const sat = mx === 0 ? 0 : (mx - mn) / mx;
          const w = sat * sat * (mx / 255); // vivid + bright pixels dominate
          wr += r * w; wg += g * w; wb += b * w; wsum += w;
        }
        let R, G, B;
        if (wsum > 0.4) { R = wr / wsum; G = wg / wsum; B = wb / wsum; }
        else { R = ar / n; G = ag / n; B = ab / n; } // truly mono cover → plain average
        // Mild saturation boost around luma so the edge reads as a real color.
        const l = 0.3 * R + 0.59 * G + 0.11 * B;
        const amt = 1.3;
        const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
        R = clamp(l + (R - l) * amt); G = clamp(l + (G - l) * amt); B = clamp(l + (B - l) * amt);
        pendingSpines.current[id] = `rgb(${R} ${G} ${B})`;
        flushSpines();
      } catch { /* tainted — keep the fallback spine */ sampledRef.current.delete(key); }
    };
    // Sample off the critical path: while the crate fills, the main thread is
    // busy laying out and decoding covers, so defer the canvas read to idle
    // time. decoding="async" also means the bitmap may not be ready on load,
    // so decode() first when supported (images do; <video> is frame-ready).
    const runMeasure = () => {
      if (typeof el.decode === 'function') {
        el.decode().then(measure).catch(() => { sampledRef.current.delete(key); measure(); });
      } else {
        measure();
      }
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(runMeasure, { timeout: 800 });
    else runMeasure();
  }, [flushSpines]);

  const items = Array.isArray(collections) ? collections : [];
  const N = items.length;

  // Reset per open so the entrance replays and stale hover can't linger.
  useEffect(() => {
    if (open) { setHovIdx(null); setSel(-1); lastPoint.current = null; }
  }, [open]);

  const centerOn = useCallback((i, instant) => {
    const el = slotRefs.current[i];
    if (el) el.scrollIntoView({ behavior: instant ? 'instant' : 'smooth', inline: 'center', block: 'nearest' });
  }, []);

  // The crate scrolls horizontally, but a plain mouse wheel is vertical
  // only — translate a vertical-dominant wheel into horizontal scroll so
  // mouse users can browse too. Trackpad horizontal gestures (deltaX
  // dominant) fall through to native scrolling untouched. Attached
  // non-passively so preventDefault stops the page from also scrolling.
  useEffect(() => {
    const el = rowRef.current;
    if (!open || !el) return undefined;
    const onWheel = (e) => {
      if (e.deltaY !== 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open]);

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
      role="region"
      aria-label="Collections"
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
          // Small, already-cached thumb to fill the sleeve instantly while
          // the full-quality cover decodes — the page fills at once instead
          // of dark sleeves popping to image. Only when it differs from the
          // sharp cover (a manually-set cover may not match the newest thumb).
          const base = !faceIsVideo && poster && poster !== face ? poster : null;
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
                      // Video cover: autoplay muted + loop so the sleeve is
                      // alive. The poster (placeholder thumb) shows until the
                      // first frame is ready.
                      <video
                        src={fileUrl(face)}
                        poster={poster ? fileUrl(poster) : undefined}
                        // crossOrigin so the spine sampler's canvas isn't
                        // tainted (the moodmark-file protocol is CORS-enabled
                        // for exactly this — see the eyedropper).
                        crossOrigin="anonymous"
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="auto"
                        onLoadedData={(e) => sampleSpine(c.id, face, e.currentTarget)}
                      />
                    ) : face ? (
                      <>
                        {base && (
                          <img
                            className={styles.covBase}
                            src={fileUrl(base)}
                            alt=""
                            aria-hidden="true"
                            draggable={false}
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                        <img
                          className={styles.covFull}
                          src={fileUrl(face)}
                          alt=""
                          draggable={false}
                          // crossOrigin so drawing this into the spine
                          // sampler's canvas doesn't taint it (getImageData
                          // throws on a tainted canvas). The moodmark-file
                          // protocol is CORS-enabled for this.
                          crossOrigin="anonymous"
                          loading="lazy"
                          decoding="async"
                          onLoad={(e) => {
                            e.currentTarget.classList.add(styles.loaded);
                            sampleSpine(c.id, face, e.currentTarget);
                          }}
                        />
                      </>
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
