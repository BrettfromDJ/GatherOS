import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X as XIcon,
  SquareLibrary as LibraryIcon,
  Folder as FolderIcon,
  Eclipse as LayersIcon,
} from 'lucide-react';
import { useOnboarding } from './OnboardingContext.jsx';
import styles from './OnboardingOverlay.module.css';

// Map the step's `icon` string to the same lucide glyph the
// toolbar's mode pill uses — keeps the walkthrough's visual
// vocabulary aligned with the live UI it's pointing at.
const STEP_ICONS = {
  library: LibraryIcon,
  collections: FolderIcon,
  spaces: LayersIcon,
};

// Visual padding around the spotlight ring, in CSS px.
const PAD = 6;

export default function OnboardingOverlay() {
  const {
    active, step, stepIndex, totalSteps, advance, back, exit,
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
      // Programmatic clicks the overlay dispatches itself (onEnter
      // navigation, clickBefore actions) carry isTrusted=false.
      // Let those through unconditionally so the walkthrough can
      // drive the app even on steps with no spotlight target.
      if (e.isTrusted === false) return;
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

  // Steps can declare an `onEnter` action — either a single
  // selector or an array of selectors — that the overlay clicks
  // for the user on entry from any direction. Used to normalize
  // app state so backward navigation lands in the UI forward
  // navigation set up. Array items run one per animation frame so
  // the DOM settles between clicks (switching modes before
  // clicking something that only exists in the new mode).
  useEffect(() => {
    if (!active) return undefined;
    const enter = step?.onEnter;
    if (!enter) return undefined;
    const list = Array.isArray(enter) ? enter : [enter];
    let cancelled = false;
    let raf = 0;
    let i = 0;
    const tick = () => {
      if (cancelled || i >= list.length) return;
      raf = requestAnimationFrame(() => {
        if (cancelled) return;
        const sel = list[i++];
        const el = sel ? document.querySelector(sel) : null;
        if (el && typeof el.click === 'function') el.click();
        tick();
      });
    };
    tick();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [active, step?.id, step?.onEnter]);

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

  // Watch for a step that advances when a selector appears in the
  // DOM — used by 'pick-image' to wait until the detail panel
  // actually mounts, regardless of how the user opened it
  // (double-click, keyboard, etc).
  useEffect(() => {
    if (!active) return undefined;
    if (step?.advance?.type !== 'appears') return undefined;
    const sel = step.advance.selector;
    if (!sel) return undefined;
    if (document.querySelector(sel)) { advance(); return undefined; }
    const mo = new MutationObserver(() => {
      if (document.querySelector(sel)) advance();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [active, step?.advance?.type, step?.advance?.selector, advance]);

  if (!active || !step) return null;

  return createPortal(
    <div className={styles.overlay} aria-live="polite">
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
      <div className={styles.tooltip}>
        <div className={styles.tooltipHeader}>
          <span className={styles.stepCount}>{stepIndex + 1}/{totalSteps}</span>
          <button
            type="button"
            className={styles.exitBtn}
            onClick={exit}
            aria-label="Exit walkthrough"
            title="Exit walkthrough"
          >
            <XIcon size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {step.title && (
          <div className={styles.title}>
            {step.icon && STEP_ICONS[step.icon] && (
              React.createElement(STEP_ICONS[step.icon], {
                size: 14,
                strokeWidth: 2,
                'aria-hidden': true,
                className: styles.titleIcon,
              })
            )}
            <span>{step.title}</span>
          </div>
        )}
        {step.body && <div className={styles.body}>{step.body}</div>}
        <div className={styles.footer}>
          {stepIndex > 0 && !step.noBack && (
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={back}
            >
              Previous
            </button>
          )}
          {step.advance?.type === 'next' && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                // Some steps need to nudge the app state before
                // advancing (e.g. opening a save's detail panel or
                // closing it). clickBefore can be a single
                // selector or an array — we try each in order and
                // fire on the first match.
                const sels = step.advance?.clickBefore;
                if (sels) {
                  const list = Array.isArray(sels) ? sels : [sels];
                  for (const sel of list) {
                    const el = document.querySelector(sel);
                    if (el && typeof el.click === 'function') {
                      el.click();
                      break;
                    }
                  }
                }
                advance();
              }}
            >
              {step.advance.label || 'Next'}
            </button>
          )}
          {step.advance?.type === 'choice' && step.advance.options.map((opt, i, arr) => (
            <button
              key={opt.value}
              type="button"
              // Last option in the array renders as the primary
              // CTA (filled pill on the right); everything before
              // it is a ghost button to its left.
              className={i === arr.length - 1 ? styles.primaryBtn : styles.ghostBtn}
              onClick={async () => {
                if (opt.action === 'remove-starter-pack') {
                  try {
                    await window.moodmark?.onboarding?.removeStarterPack?.();
                  } catch { /* non-fatal — overlay still closes */ }
                }
                advance();
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
