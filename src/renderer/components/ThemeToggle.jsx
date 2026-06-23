import React from 'react';
import { createPortal } from 'react-dom';
import { Sun, Moon } from 'lucide-react';

// Local-state theme toggle. Reads the current value off the data-theme
// attribute set on <html> at boot, flips it, mirrors the new value to
// localStorage via setPref AND to the main process via setTheme so the
// next BrowserWindow that opens picks the right material variant.
//
// The flip plays a rainbow gradient "sweep": a full-screen gradient
// wipes across to cover the window, the theme swaps underneath at the
// cover point, then it wipes away to reveal the new theme.
export default function ThemeToggle({ className }) {
  const [theme, setTheme] = React.useState(() =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light',
  );
  // Target theme while a sweep is mid-flight (null when idle).
  const [pending, setPending] = React.useState(null);
  const sweepRef = React.useRef(null);

  function persist(next) {
    try {
      window.moodmark?.settings?.setPref?.('theme', next);
      window.moodmark?.app?.setTheme?.(next);
    } catch {
      /* best-effort — UI already reflects the swap */
    }
  }

  function applyTheme(next) {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  }

  function flip() {
    const next = theme === 'dark' ? 'light' : 'dark';
    persist(next);
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Reduced motion, or a sweep already running → swap instantly.
    if (reduce || pending) {
      applyTheme(next);
      return;
    }
    setPending(next);
  }

  // Drive the rainbow sweep: wipe the gradient in to cover the window,
  // swap the theme underneath, then wipe it back out to reveal it.
  React.useEffect(() => {
    if (!pending) return undefined;
    const el = sweepRef.current;
    if (!el || typeof el.animate !== 'function') {
      applyTheme(pending);
      setPending(null);
      return undefined;
    }
    let cancelled = false;
    const ease = 'cubic-bezier(0.65, 0, 0.35, 1)';
    const wipeIn = el.animate(
      [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
      { duration: 340, easing: ease, fill: 'forwards' },
    );
    wipeIn.finished
      .then(() => {
        if (cancelled) return null;
        applyTheme(pending);
        return el.animate(
          [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }],
          { duration: 340, easing: ease, fill: 'forwards' },
        ).finished;
      })
      .then(() => { if (!cancelled) setPending(null); })
      .catch(() => { if (!cancelled) { applyTheme(pending); setPending(null); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const isDark = theme === 'dark';
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={flip}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDark
          ? <Sun strokeWidth={1.6} aria-hidden="true" />
          : <Moon strokeWidth={1.6} aria-hidden="true" />}
      </button>
      {pending && createPortal(
        <div ref={sweepRef} className="theme-sweep" aria-hidden="true" />,
        document.body,
      )}
    </>
  );
}
