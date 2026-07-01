import React from 'react';
import { createPortal } from 'react-dom';
import { Sun, Moon } from 'lucide-react';

// Shimmer colourways, cycled in order so each flip filters through a
// different palette. Module-level index is shared across toggle instances
// (sidebar + toolbar) so the rotation continues no matter which is used.
const COLORWAYS = ['prism', 'berry', 'lagoon', 'citrus', 'azure', 'ember'];
let colorwayIndex = 0;

// Sweep duration — keep in sync with .glimm-band--sweep in global.css.
const SWEEP_MS = 2000;

// Only one mounted toggle answers the global toggle event (the command
// palette dispatches it) — if two instances both flipped, the theme
// would land back where it started.
let toggleEventClaimed = false;
// Theme crossfade duration — keep in sync with the html.theme-morph
// transition in global.css.
const MORPH_MS = 820;
// End the colour crossfade exactly when the band has finished fading out
// (i.e. at the end of the sweep). If the crossfade finished earlier, the
// text would sit fully settled while the band was still lifting off it —
// and that trailing un-cover over already-finished text read as a second
// "blink" after the rainbow. Aligning the two ends removes that gap.
const SWAP_AT = Math.max(0, SWEEP_MS - MORPH_MS);

// Local-state theme toggle. Reads the current value off the data-theme
// attribute set on <html> at boot, flips it, mirrors the new value to
// localStorage via setPref AND to the main process via setTheme so the
// next BrowserWindow that opens picks the right material variant.
//
// The flip switches the theme instantly (no animated crossfade) and
// sweeps a soft, heavily-blurred rainbow shimmer band across the window
// — the two effects are decoupled on purpose.
export default function ThemeToggle({ className, tooltipPos }) {
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

    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const applyTheme = () => {
      const root = document.documentElement;
      // Crossfade the UI's colours instead of snapping. Enable the
      // transitions, then flip data-theme in the same frame so every
      // themed property tweens from its current value to the new one.
      if (!reduced) {
        root.classList.add('theme-morph');
        // Leave a generous margin before pulling the class. If it's removed
        // while a colour is still mid-tween, the transition rule vanishes
        // and the value snaps the rest of the way (a jarring jump at the
        // end), so wait well past the transition duration.
        window.setTimeout(() => root.classList.remove('theme-morph'), MORPH_MS + 500);
      }
      setTheme(next);
      root.setAttribute('data-theme', next);
      persist(next);
    };

    const el = bandRef.current;
    if (reduced || !el) {
      applyTheme();
      return;
    }

    // The band rides on top of the whole UI, so a plain alpha overlay
    // tints the text as it passes. Blend it against the UI so it preserves
    // text luminance instead — and key the blend to the CURRENT (starting)
    // theme, since that's the background visible during most of the sweep
    // (the swap doesn't happen until SWAP_AT). On a dark background use
    // screen so the colours glow and stay obvious; on light use multiply so
    // they read against the bright backdrop. (Keying to the target theme
    // made dark→light nearly invisible — multiply over the still-dark
    // background washed the band out for most of the pass.)
    el.style.mixBlendMode = theme === 'dark' ? 'screen' : 'multiply';

    // Pick the next colourway in the rotation.
    const colorway = COLORWAYS[colorwayIndex % COLORWAYS.length];
    colorwayIndex += 1;

    // Randomise the six blob centres so the mesh never lands the same way
    // twice. Each blob is jittered within its own horizontal zone so the
    // colours stay spread across the width rather than clumping.
    const zone = 100 / 6;
    for (let i = 1; i <= 6; i += 1) {
      const x = (i - 1) * zone + Math.random() * zone;
      const y = 18 + Math.random() * 64;
      el.style.setProperty(`--b${i}x`, `${x.toFixed(1)}%`);
      el.style.setProperty(`--b${i}y`, `${y.toFixed(1)}%`);
    }

    // Sweep the shimmer band left → right across the window by (re)playing
    // the CSS animation. Clear the sweep + any prior colourway and force a
    // reflow first so rapid repeated flips always restart from the left.
    el.classList.remove('glimm-band--sweep');
    COLORWAYS.forEach((c) => el.classList.remove(`glimm-band--${c}`));
    void el.offsetWidth; // reflow — restarts the animation
    el.classList.add(`glimm-band--${colorway}`, 'glimm-band--sweep');
    const done = () => el.classList.remove('glimm-band--sweep');
    el.addEventListener('animationend', done, { once: true });

    // Start the theme crossfade so it peaks as the gradient crosses the
    // middle of the screen — the band visually "carries" the change rather
    // than it snapping up front.
    window.setTimeout(applyTheme, SWAP_AT);
  }

  // Let the command palette trigger the exact same flip (shimmer sweep
  // included) via a window event. flip closes over `theme`, so route
  // through a ref to always call the latest version.
  const flipRef = React.useRef(flip);
  flipRef.current = flip;
  React.useEffect(() => {
    if (toggleEventClaimed) return undefined;
    toggleEventClaimed = true;
    const onToggle = () => flipRef.current();
    window.addEventListener('moodmark:toggle-theme', onToggle);
    return () => {
      toggleEventClaimed = false;
      window.removeEventListener('moodmark:toggle-theme', onToggle);
    };
  }, []);

  const isDark = theme === 'dark';
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={flip}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        data-tooltip={isDark ? 'Light mode' : 'Dark mode'}
        data-tooltip-pos={tooltipPos}
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
