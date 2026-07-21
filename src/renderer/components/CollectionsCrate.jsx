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

// Ambient dust — slow, warm motes drifting up through the stage light, so
// flipping through sleeves feels like leafing through canvases in a quiet
// studio. Rendered on a canvas (cheap for many soft points). Two instances
// are layered — a dense field behind the sleeves and a sparse, larger one
// in front — for depth. Honors prefers-reduced-motion (draws a still field).
function DustField({ count, near = false, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rand = (a, b) => a + Math.random() * (b - a);
    let w = 0, h = 0, raf = 0;
    const parts = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth || window.innerWidth;
      h = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function seed() {
      parts.length = 0;
      for (let i = 0; i < count; i += 1) {
        // ~30% sit out of focus (larger, dim, soft); the rest are crisp,
        // bright specks — that mix is what reads as dust in a light beam.
        const soft = Math.random() < 0.3;
        parts.push({
          x: rand(0, w), y: rand(0, h),
          r: soft
            ? (near ? rand(2.6, 4.4) : rand(1.6, 3))
            : (near ? rand(0.7, 1.5) : rand(0.4, 1)),
          vx: rand(-0.05, 0.05) * (near ? 1.5 : 1),
          vy: rand(-0.13, -0.03) * (near ? 1.5 : 1), // slow upward drift
          baseA: soft
            ? (near ? rand(0.06, 0.14) : rand(0.04, 0.09))
            : (near ? rand(0.5, 0.95) : rand(0.28, 0.6)),
          soft,
          tw: rand(0, Math.PI * 2),
          tws: rand(0.008, 0.03),
        });
      }
    }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        // Sharp specks flicker as they catch the light; soft ones barely pulse.
        const a = p.baseA * (p.soft ? 0.75 + 0.25 * Math.sin(p.tw) : 0.4 + 0.6 * Math.sin(p.tw));
        if (a <= 0.003) continue;
        if (p.soft) {
          const rr = p.r * 2.2;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
          g.addColorStop(0, `rgba(255,247,232,${a.toFixed(3)})`);
          g.addColorStop(1, 'rgba(255,247,232,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill();
        } else {
          // Faint glow (light caught around the speck) + a crisp bright core.
          const halo = p.r * 3;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, halo);
          g.addColorStop(0, `rgba(255,247,232,${(a * 0.3).toFixed(3)})`);
          g.addColorStop(1, 'rgba(255,247,232,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, halo, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(255,251,242,${Math.min(1, a).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    function step() {
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.tw += p.tws;
        if (p.y < -4) { p.y = h + 4; p.x = rand(0, w); }
        if (p.x < -4) p.x = w + 4; else if (p.x > w + 4) p.x = -4;
      }
      draw();
      raf = requestAnimationFrame(step);
    }

    resize(); seed();
    if (reduce) draw();
    else raf = requestAnimationFrame(step);
    const onResize = () => { resize(); seed(); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [count, near]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
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
    const measure = () => {
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
      } catch { /* tainted — keep the fallback spine */ sampledRef.current.delete(key); }
    };
    // decoding="async" means load can fire before the bitmap is ready, so
    // drawImage would throw; decode() first when the element supports it
    // (images do, <video> doesn't — it's already frame-ready on loadeddata).
    if (typeof el.decode === 'function') {
      el.decode().then(measure).catch(() => { sampledRef.current.delete(key); measure(); });
    } else {
      measure();
    }
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
      <DustField count={70} className={styles.dustFar} />
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
                      // Video cover: autoplay muted + loop so the sleeve is
                      // alive. The poster (placeholder thumb) shows until the
                      // first frame is ready.
                      <video
                        src={fileUrl(face)}
                        poster={poster ? fileUrl(poster) : undefined}
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
      <DustField count={18} near className={styles.dustNear} />
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
