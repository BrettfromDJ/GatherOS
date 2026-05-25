import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOnboarding } from './OnboardingContext.jsx';
import styles from './OnboardingOverlay.module.css';

// Visual padding around the spotlight cutout, in CSS px.
const PAD = 6;
// Gap between the spotlight edge and the tooltip.
const GAP = 14;
// Margin from the viewport edge when the tooltip would clip.
const VIEWPORT_MARGIN = 12;

export default function OnboardingOverlay() {
  const {
    active, step, stepIndex, totalSteps, advance, exit, onChoice,
  } = useOnboarding();
  const [targetRect, setTargetRect] = useState(null);

  // Resolve + watch the target's bbox. If the target isn't in the
  // DOM yet (e.g. we're waiting for a route transition to finish),
  // poll for up to ~1s before giving up and centering the tooltip.
  useLayoutEffect(() => {
    if (!active || !step?.target) {
      setTargetRect(null);
      return undefined;
    }
    let cancelled = false;
    let raf = 0;
    let tries = 0;
    const measure = () => {
      const el = document.querySelector(step.target);
      if (!el) {
        if (tries++ < 60 && !cancelled) raf = requestAnimationFrame(measure);
        else if (!cancelled) setTargetRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setTargetRect({
        x: r.left, y: r.top, width: r.width, height: r.height,
      });
    };
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    const ro = new ResizeObserver(measure);
    if (document.body) ro.observe(document.body);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      ro.disconnect();
    };
  }, [active, step?.id, step?.target]);

  // Click gating: while active, swallow every mouse interaction
  // unless it lands on (a) the overlay's own tooltip or (b) the
  // currently-required target. Capture phase so we beat any
  // synthetic-event delegation in React.
  useEffect(() => {
    if (!active) return undefined;
    const wantsClick = step?.advance?.type === 'click';
    const targetSel = step?.target;
    const handler = (e) => {
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      // Overlay UI always passes through.
      if (t.closest(`.${styles.tooltip}`)) return;
      // Required target — allow the original click, advance after
      // any handlers it triggers have a chance to settle.
      if (targetSel && t.closest(targetSel)) {
        if (wantsClick) queueMicrotask(advance);
        return;
      }
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('click', handler, true);
    document.addEventListener('contextmenu', handler, true);
    return () => {
      document.removeEventListener('mousedown', handler, true);
      document.removeEventListener('click', handler, true);
      document.removeEventListener('contextmenu', handler, true);
    };
  }, [active, step?.target, step?.advance?.type, advance]);

  // Listen for the theme attribute flipping when a step is waiting
  // on the dark-mode toggle.
  useEffect(() => {
    if (!active) return undefined;
    if (step?.advance?.type !== 'theme') return undefined;
    const expected = step.advance.value;
    const check = () => {
      if (document.documentElement.getAttribute('data-theme') === expected) {
        advance();
      }
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => mo.disconnect();
  }, [active, step?.advance?.type, step?.advance?.value, advance]);

  if (!active || !step) return null;

  const tooltipStyle = targetRect
    ? computeTooltipStyle(targetRect, step.placement || 'bottom')
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return createPortal(
    <div className={styles.overlay} aria-live="polite">
      {/* Dim layer. pointer-events: none so the document-level
          capture handler does the gating. */}
      <div className={styles.scrim} />
      {targetRect && (
        <div
          className={styles.spotlight}
          style={{
            left: targetRect.x - PAD,
            top: targetRect.y - PAD,
            width: targetRect.width + PAD * 2,
            height: targetRect.height + PAD * 2,
          }}
        />
      )}
      <div className={styles.tooltip} style={tooltipStyle}>
        <div className={styles.tooltipHeader}>
          <span className={styles.stepCount}>
            Step {stepIndex + 1} of {totalSteps}
          </span>
          <button
            type="button"
            className={styles.exitBtn}
            onClick={exit}
            aria-label="Exit walkthrough"
          >
            Exit
          </button>
        </div>
        {step.title && <div className={styles.title}>{step.title}</div>}
        {step.body && <div className={styles.body}>{step.body}</div>}
        {step.advance?.type === 'next' && (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={advance}
          >
            {step.advance.label || 'Next'}
          </button>
        )}
        {step.advance?.type === 'choice' && (
          <div className={styles.choices}>
            {step.advance.options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={[
                  styles.primaryBtn,
                  opt.danger && styles.dangerBtn,
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  try { onChoice?.(opt.value); } catch { /* host failure shouldn't strand the overlay */ }
                  exit();
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function computeTooltipStyle(rect, placement) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  let style;
  switch (placement) {
    case 'top':
      style = { left: cx, top: rect.y - PAD - GAP, transform: 'translate(-50%, -100%)' };
      break;
    case 'left':
      style = { left: rect.x - PAD - GAP, top: cy, transform: 'translate(-100%, -50%)' };
      break;
    case 'right':
      style = { left: rect.x + rect.width + PAD + GAP, top: cy, transform: 'translate(0, -50%)' };
      break;
    case 'bottom':
    default:
      style = { left: cx, top: rect.y + rect.height + PAD + GAP, transform: 'translate(-50%, 0)' };
      break;
  }
  // Clamp the resolved left to the viewport so the tooltip doesn't
  // visually clip off a screen edge. The transform handles the
  // anchor offset; clamping the raw `left` keeps the bubble inside.
  if (typeof style.left === 'number') {
    const vw = window.innerWidth;
    if (style.left < VIEWPORT_MARGIN) style.left = VIEWPORT_MARGIN;
    if (style.left > vw - VIEWPORT_MARGIN) style.left = vw - VIEWPORT_MARGIN;
  }
  return style;
}
