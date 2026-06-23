import React from 'react';
import { createPortal } from 'react-dom';
import { Sun, Moon } from 'lucide-react';

// Local-state theme toggle. Reads the current value off the data-theme
// attribute set on <html> at boot, flips it, mirrors the new value to
// localStorage via setPref AND to the main process via setTheme so the
// next BrowserWindow that opens picks the right material variant.
//
// The flip plays a glimm-style transition: a soft rainbow band sweeps
// across the window (riding the View Transitions top layer) while the
// old theme is clip-wiped away to reveal the new one underneath.
export default function ThemeToggle({ className }) {
  const [theme, setTheme] = React.useState(() =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light',
  );
  const bandRef = React.useRef(null);

  function persist(next) {
    try {
      window.moodmark?.settings?.setPref?.('theme', next);
      window.moodmark?.app?.setTheme?.(next);
    } catch {
      /* best-effort — UI already reflects the swap */
    }
  }

  function flip() {
    const next = theme === 'dark' ? 'light' : 'dark';
    persist(next);

    const root = document.documentElement;
    const band = bandRef.current;
    const supported = typeof document !== 'undefined'
      && typeof document.startViewTransition === 'function';
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (!supported || reduced || !band) {
      root.setAttribute('data-theme', next);
      setTheme(next);
      return;
    }

    // Arm the band off-screen-left WITH its view-transition-name before
    // the snapshot, so the "old" frame captures it ready to sweep.
    band.classList.add('glimm-band--armed');
    root.classList.add('theme-sweeping');

    const transition = document.startViewTransition(() => {
      // Runs between the two snapshots: swap the theme and send the band
      // off-screen-right so its group tweens all the way across.
      root.setAttribute('data-theme', next);
      band.classList.add('glimm-band--swept');
    });

    transition.ready
      .then(() => {
        // Wipe the old theme away left→right, revealing the new one
        // underneath as the band passes over the seam.
        root.animate(
          { clipPath: ['inset(0 0 0 0)', 'inset(0 0 0 100%)'] },
          {
            duration: 850,
            easing: 'cubic-bezier(0.5, 0, 0.2, 1)',
            pseudoElement: '::view-transition-old(root)',
            fill: 'forwards',
          },
        );
      })
      .catch(() => {});

    transition.finished.finally(() => {
      band.classList.remove('glimm-band--armed', 'glimm-band--swept');
      root.classList.remove('theme-sweeping');
      setTheme(next);
    });
  }

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
      {createPortal(
        <div ref={bandRef} className="glimm-band" aria-hidden="true" />,
        document.body,
      )}
    </>
  );
}
