import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

// Pulled-out so the source rects + colors are captured BEFORE the
// underlying DOM is unmounted by the empty-trash flow. Particles
// erupt from each captured rect, swirl through quadratic bezier
// trajectories toward the toast, and dissolve into a warm glow.
//
// Pure canvas — no DOM nodes per particle, so 30 sources × 30
// particles each is cheap. The whole effect runs once and unmounts
// itself via the onDone callback.

const PARTICLES_PER_SOURCE = 32;
const TOTAL_DURATION_MS = 1700;
const GLOW_START_MS = 1050;
const GLOW_END_MS = TOTAL_DURATION_MS;

export default function CompostBurst({ sources, target, onDone }) {
  const canvasRef = useRef(null);
  // Memoize the per-particle vectors so they stay stable for the
  // animation's lifetime — recomputing on every render would jitter
  // the trajectories.
  const particles = useMemo(() => {
    const out = [];
    for (const src of sources) {
      const colors = src.colors.length > 0
        ? src.colors
        : ['#ff9500', '#ff7e5f', '#ffcc00'];
      for (let i = 0; i < PARTICLES_PER_SOURCE; i++) {
        const x0 = src.rect.x + Math.random() * src.rect.w;
        const y0 = src.rect.y + Math.random() * src.rect.h;
        // Mid-flight control point off the straight line so each
        // particle spirals rather than zooms straight in. Bigger
        // sideways offset = more dramatic swirl.
        const mx = (x0 + target.x) / 2;
        const my = (y0 + target.y) / 2;
        const swirl = 180 * (Math.random() - 0.5);
        // Perpendicular vector to the flight line (rotate 90°).
        const dx = target.x - x0;
        const dy = target.y - y0;
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len;
        const py = dx / len;
        out.push({
          x0,
          y0,
          cx: mx + px * swirl,
          cy: my + py * swirl,
          tx: target.x + (Math.random() - 0.5) * 60,
          ty: target.y + (Math.random() - 0.5) * 24,
          delay: Math.random() * 220,
          duration: 950 + Math.random() * 450,
          size: 2.5 + Math.random() * 3,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    }
    return out;
  }, [sources, target]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const startedAt = performance.now();
    let raf = 0;

    const tick = (now) => {
      const elapsed = now - startedAt;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // ── Particles ────────────────────────────────────────────
      for (const p of particles) {
        const t = (elapsed - p.delay) / p.duration;
        if (t <= 0) continue;
        if (t >= 1.15) continue; // fully faded
        const tt = Math.min(1, t);
        // easeOutQuart — particles sprint out, settle into the glow
        const ease = 1 - Math.pow(1 - tt, 4);
        // Quadratic bezier: x0 → cx → tx
        const u = 1 - ease;
        const px = u * u * p.x0 + 2 * u * ease * p.cx + ease * ease * p.tx;
        const py = u * u * p.y0 + 2 * u * ease * p.cy + ease * ease * p.ty;
        const fade = tt < 0.85 ? 1 : 1 - (tt - 0.85) / 0.15;
        const size = p.size * (1 - ease * 0.4);
        ctx.globalAlpha = fade;
        ctx.fillStyle = p.color;
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }
      ctx.globalAlpha = 1;

      // ── Warm glow at the destination ─────────────────────────
      if (elapsed >= GLOW_START_MS) {
        const gt = Math.min(1, (elapsed - GLOW_START_MS) / (GLOW_END_MS - GLOW_START_MS));
        // Ease in/out so the glow swells then settles.
        const intensity = gt < 0.45
          ? gt / 0.45
          : 1 - (gt - 0.45) / 0.55;
        const radius = 70 + gt * 90;
        const grad = ctx.createRadialGradient(
          target.x, target.y, 0,
          target.x, target.y, radius,
        );
        grad.addColorStop(0,    `rgba(255, 200, 130, ${0.55 * intensity})`);
        grad.addColorStop(0.45, `rgba(255, 150, 80,  ${0.30 * intensity})`);
        grad.addColorStop(1,    'rgba(255, 130, 60, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (elapsed < TOTAL_DURATION_MS) {
        raf = requestAnimationFrame(tick);
      } else {
        onDone?.();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [particles, target, onDone]);

  return createPortal(
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 999,
      }}
      aria-hidden="true"
    />,
    document.body,
  );
}
