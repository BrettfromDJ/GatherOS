import React from 'react';
import { createPortal } from 'react-dom';
import { Sun, Moon } from 'lucide-react';

// Shimmer colourways, cycled in order so each flip filters through a
// different palette. Module-level index is shared across toggle instances
// (sidebar + toolbar) so the rotation continues no matter which is used.
const COLORWAYS = ['prism', 'berry', 'lagoon', 'citrus', 'azure', 'ember'];
let colorwayIndex = 0;

// Sweep duration — keep in sync with .glimm-band--sweep in global.css.
// The theme swap fires at the halfway point.
const SWEEP_MS = 2000;

// Local-state theme toggle. Reads the current value off the data-theme
// attribute set on <html> at boot, flips it, mirrors the new value to
// localStorage via setPref AND to the main process via setTheme so the
// next BrowserWindow that opens picks the right material variant.
//
// The flip switches the theme instantly (no animated crossfade) and
// sweeps a soft, heavily-blurred rainbow shimmer band across the window
// — the two effects are decoupled on purpose.
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
    const applyTheme = () => {
      setTheme(next);
      document.documentElement.setAttribute('data-theme', next);
      persist(next);
    };

    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const el = bandRef.current;
    if (reduced || !el) {
      applyTheme();
      return;
    }

    // Pick the next colourway in the rotation.
    const colorway = COLORWAYS[colorwayIndex % COLORWAYS.length];
    colorwayIndex += 1;

    // Sweep the shimmer band left → right across the window by (re)playing
    // the CSS animation. Clear the sweep + any prior colourway and force a
    // reflow first so rapid repeated flips always restart from the left.
    el.classList.remove('glimm-band--sweep');
    COLORWAYS.forEach((c) => el.classList.remove(`glimm-band--${c}`));
    void el.offsetWidth; // reflow — restarts the animation
    el.classList.add(`glimm-band--${colorway}`, 'glimm-band--sweep');
    const done = () => el.classList.remove('glimm-band--sweep');
    el.addEventListener('animationend', done, { once: true });

    // Flip the theme as the gradient crosses the middle of the screen, so
    // the band visually "carries" the change rather than it snapping up
    // front. SWEEP_MS mirrors the CSS animation duration.
    window.setTimeout(applyTheme, SWEEP_MS / 2);
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
