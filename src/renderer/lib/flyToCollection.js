// Fly-to-collection animation: clones the dragged card as a "ghost"
// element and animates it shrinking + drifting to the target sidebar
// collection row, then briefly pulses the row.
//
// Data hooks expected:
//   - source card has data-save-id="<id>"
//   - target collection row has data-collection-id="<id>"

const GHOST_DURATION = 520;
const PULSE_DURATION = 280;
const STAGGER_MS = 70;
const END_SIZE = 26;

function animateOne({ saveId, collectionId, imageSrc, fallbackBg }) {
  const cardEl = document.querySelector(`[data-save-id="${saveId}"]`);
  const targetEl = document.querySelector(`[data-collection-id="${collectionId}"]`);
  if (!cardEl || !targetEl) return;

  const srcRect = cardEl.getBoundingClientRect();
  const dstRect = targetEl.getBoundingClientRect();
  if (srcRect.width === 0 || srcRect.height === 0) return;

  const ghost = document.createElement('div');
  Object.assign(ghost.style, {
    position: 'fixed',
    top: `${srcRect.top}px`,
    left: `${srcRect.left}px`,
    width: `${srcRect.width}px`,
    height: `${srcRect.height}px`,
    borderRadius: '8px',
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08)',
    pointerEvents: 'none',
    // Max 32-bit signed int — guarantees the ghost wins against the
    // sidebar (z-index: 2), the ContextMenu portal (z-index: 9999),
    // selection bar, etc., regardless of any parent stacking context.
    zIndex: '2147483647',
    isolation: 'isolate',
    willChange: 'transform, opacity',
    backgroundColor: fallbackBg || '#FAFAF9',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    overflow: 'hidden',
  });
  if (imageSrc) ghost.style.backgroundImage = `url("${imageSrc}")`;
  document.body.appendChild(ghost);

  // End point: centered on the collection row.
  const endX = dstRect.left + dstRect.width / 2 - END_SIZE / 2 - srcRect.left;
  const endY = dstRect.top + dstRect.height / 2 - END_SIZE / 2 - srcRect.top;
  const endScale = END_SIZE / Math.max(srcRect.width, srcRect.height);

  const anim = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      {
        transform: `translate(${endX}px, ${endY}px) scale(${endScale})`,
        opacity: 0.15,
        offset: 0.92,
      },
      {
        transform: `translate(${endX}px, ${endY}px) scale(${endScale * 0.6})`,
        opacity: 0,
      },
    ],
    {
      duration: GHOST_DURATION,
      easing: 'cubic-bezier(0.45, 0, 0.4, 1)',
      fill: 'forwards',
    },
  );

  anim.onfinish = () => {
    ghost.remove();
    targetEl.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.06)' },
        { transform: 'scale(1)' },
      ],
      { duration: PULSE_DURATION, easing: 'ease-out' },
    );
  };
  anim.oncancel = () => ghost.remove();
}

// Animate one or many cards into a single collection row.
// `items` is an array of { saveId, imageSrc, fallbackBg }.
export function flyToCollection({ items, collectionId }) {
  if (!collectionId || !Array.isArray(items) || items.length === 0) return;
  // Skip animations entirely if the user has motion preferences turned off.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  items.forEach((item, i) => {
    if (i === 0) {
      animateOne({ ...item, collectionId });
    } else {
      window.setTimeout(() => animateOne({ ...item, collectionId }), i * STAGGER_MS);
    }
  });
}
