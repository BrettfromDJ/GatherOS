import React from 'react';
import { createPortal } from 'react-dom';
import { Sun, Moon } from 'lucide-react';

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

    // Switch the theme straight away — no transition on the swap itself.
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    persist(next);

    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const el = bandRef.current;
    if (reduced || !el) return;

    // Sweep the rainbow shimmer band left → right across the window by
    // (re)playing the CSS animation. Clear the class and force a reflow
    // first so rapid repeated flips always restart it from the left.
    el.classList.remove('glimm-band--sweep');
    void el.offsetWidth; // reflow — restarts the animation
    el.classList.add('glimm-band--sweep');
    const done = () => el.classList.remove('glimm-band--sweep');
    el.addEventListener('animationend', done, { once: true });
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
