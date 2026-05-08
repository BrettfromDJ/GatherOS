import React from 'react';
import { Sun, Moon } from 'lucide-react';

// Local-state theme toggle. Reads the current value off the
// data-theme attribute set on <html> at boot, flips it, mirrors
// the new value to localStorage via setPref AND to the main
// process via setTheme so the next BrowserWindow that opens picks
// the right material variant.
//
// The icon-only button is styled by the consumer via `className`
// — same component used by the Sidebar footer (until Stage 4d)
// and by the Toolbar's right cluster.
export default function ThemeToggle({ className }) {
  const [theme, setTheme] = React.useState(() =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light',
  );
  async function flip() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      await Promise.all([
        window.moodmark?.settings?.setPref?.('theme', next),
        window.moodmark?.app?.setTheme?.(next),
      ]);
    } catch {
      /* best-effort — UI already reflects the swap */
    }
  }
  const isDark = theme === 'dark';
  return (
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
  );
}
