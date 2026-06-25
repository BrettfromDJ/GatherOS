import { useEffect, useRef, useState } from 'react';

// Shared eyedropper logic for any component that has an <img> ref.
// Caller is responsible for:
//   • Wiring `handleImageMouseMove` + `handleImageClick` onto the
//     image, plus a crosshair cursor while picking is true.
//   • Rendering a button (or any UI) that calls `togglePicking`.
//   • Rendering a cursor-following tooltip (with hoverHex/hoverPos)
//     using whatever style module they prefer.
//
// What the hook owns:
//   • Building a sampling canvas once when picking starts.
//   • Per-mousemove pixel reads via getImageData(1,1).
//   • Click → write hex to clipboard + flash justCopied for 900ms,
//     then auto-deactivate.
//   • Escape cancels without sampling.
//   • Resets on recordId change so a stuck-on crosshair doesn't
//     follow the user across saves.
// Half-width (in source pixels) of the square the loupe magnifies. The
// loupe shows an (2*LOUPE_RADIUS + 1) grid with the sampled pixel dead
// center, so 7 → a 15×15 neighbourhood.
const LOUPE_RADIUS = 7;

export function useEyedropper(imageRef, recordId) {
  const [picking, setPicking] = useState(false);
  const [hoverHex, setHoverHex] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [justCopied, setJustCopied] = useState(false);
  // Magnified pixel neighbourhood under the cursor: the raw ImageData
  // block + its grid size, so the consumer can paint a zoomed loupe.
  const [loupe, setLoupe] = useState(null); // { block, n }
  const canvasDataRef = useRef(null);

  useEffect(() => {
    setPicking(false);
    setHoverHex(null);
    setJustCopied(false);
    setLoupe(null);
  }, [recordId]);

  useEffect(() => {
    if (!picking) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPicking(false);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [picking]);

  useEffect(() => {
    if (!picking) {
      canvasDataRef.current = null;
      setHoverHex(null);
      setJustCopied(false);
      setLoupe(null);
    }
  }, [picking]);

  // Lazy-init the sampling canvas. We do this on first hover/click
  // rather than on mode start so we don't race the image's load —
  // by the time the user has moved the mouse to the image, we know
  // the <img>'s natural dimensions are populated.
  function ensureCanvas() {
    if (canvasDataRef.current) return canvasDataRef.current;
    const img = imageRef.current;
    if (!img) {
      console.warn('[eyedropper] no image ref');
      return null;
    }
    if (!img.naturalWidth) {
      console.warn('[eyedropper] image has no natural dimensions yet');
      return null;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      // Probe getImageData once now so a tainted-canvas SecurityError
      // surfaces in the console immediately instead of failing
      // silently on every hover via the pixelAt catch.
      try { ctx.getImageData(0, 0, 1, 1); }
      catch (err) {
        console.error('[eyedropper] canvas tainted — getImageData blocked:', err);
        return null;
      }
      canvasDataRef.current = {
        ctx,
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
      return canvasDataRef.current;
    } catch (err) {
      console.error('[eyedropper] canvas init failed:', err);
      return null;
    }
  }

  // Map a viewport cursor coord to a pixel in the source image,
  // accounting for object-fit: contain letterboxing. The previous
  // implementation scaled cursor → natural dims using the element's
  // bounding rect, which is wrong because object-fit: contain shrinks
  // the rendered image to whichever axis is more constrained and
  // centers it — so the element box has empty (letterbox) bands on
  // the other axis. Sampling at the cursor offset relative to the
  // ELEMENT was sampling the image at the wrong pixel by however
  // wide the letterbox happened to be.
  //
  // Here we compute the rendered image rect inside the element, then
  // map the cursor relative to THAT rect. Hits in the letterbox area
  // return null so the hover swatch / click sampler doesn't lie.
  function hexFromRgb(r, g, b) {
    return (
      '#' +
      [r, g, b]
        .map((c) => c.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    );
  }

  // Map a cursor coord to the source-image pixel under it, returning
  // both the hex and the integer source coords (sx, sy) so the loupe
  // can read a neighbourhood block around the same point. Null in the
  // letterbox bands so nothing lies about what's sampled.
  function sampleAt(clientX, clientY) {
    const data = ensureCanvas();
    const img = imageRef.current;
    if (!data || !img) return null;

    const rect = img.getBoundingClientRect();
    const elAspect = rect.width / rect.height;
    const imgAspect = data.width / data.height;

    let renderedW;
    let renderedH;
    if (elAspect > imgAspect) {
      // Element wider than image → letterboxed on left + right.
      renderedH = rect.height;
      renderedW = rect.height * imgAspect;
    } else {
      // Element taller than image → letterboxed on top + bottom.
      renderedW = rect.width;
      renderedH = rect.width / imgAspect;
    }
    const offsetX = (rect.width - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;

    const localX = clientX - rect.left - offsetX;
    const localY = clientY - rect.top - offsetY;
    // Outside the rendered image (in the letterbox bands) → no sample.
    if (localX < 0 || localY < 0 || localX >= renderedW || localY >= renderedH) {
      return null;
    }

    const sx = Math.floor(localX * (data.width / renderedW));
    const sy = Math.floor(localY * (data.height / renderedH));
    if (sx < 0 || sy < 0 || sx >= data.width || sy >= data.height) return null;
    try {
      const px = data.ctx.getImageData(sx, sy, 1, 1).data;
      return { hex: hexFromRgb(px[0], px[1], px[2]), sx, sy };
    } catch (err) {
      console.error('[eyedropper] sample failed:', err);
      return null;
    }
  }

  // Read the magnified neighbourhood for the loupe: an N×N block of
  // source pixels centered on (sx, sy). getImageData returns transparent
  // black for any cells that fall off the image edge, so the grid stays
  // aligned (sampled pixel always dead-center at LOUPE_RADIUS,
  // LOUPE_RADIUS) right up to the borders.
  function readLoupe(sx, sy) {
    const data = canvasDataRef.current;
    if (!data) return null;
    const n = LOUPE_RADIUS * 2 + 1;
    try {
      const block = data.ctx.getImageData(sx - LOUPE_RADIUS, sy - LOUPE_RADIUS, n, n);
      return { block, n };
    } catch (err) {
      console.error('[eyedropper] loupe read failed:', err);
      return null;
    }
  }

  function handleImageMouseMove(e) {
    if (!picking || justCopied) return;
    const sample = sampleAt(e.clientX, e.clientY);
    if (sample) {
      setHoverHex(sample.hex);
      setHoverPos({ x: e.clientX, y: e.clientY });
      setLoupe(readLoupe(sample.sx, sample.sy));
    }
  }

  async function handleImageClick(e) {
    if (!picking) return;
    const sample = sampleAt(e.clientX, e.clientY);
    if (!sample) return;
    try {
      await navigator.clipboard.writeText(sample.hex.toLowerCase());
    } catch (err) {
      console.error('Eyedropper copy failed:', err);
    }
    setHoverHex(sample.hex);
    setHoverPos({ x: e.clientX, y: e.clientY });
    setLoupe(readLoupe(sample.sx, sample.sy));
    setJustCopied(true);
    setTimeout(() => setPicking(false), 900);
  }

  return {
    picking,
    togglePicking: () => setPicking((v) => !v),
    handleImageClick,
    handleImageMouseMove,
    hoverHex,
    hoverPos,
    justCopied,
    loupe,
  };
}
