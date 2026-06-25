import { useEffect, useRef, useState } from 'react';

// Returns true for a short window whenever `signature` changes — used to
// replay a "reshuffle" animation on a collection cover when its newest
// saves change (e.g. a save was just added, so the cover's 4-newest
// collage re-deals). Skips the first run so mounting/navigating never
// triggers a phantom shuffle.
export function useReshuffle(signature, ms = 560) {
  const [shuffling, setShuffling] = useState(false);
  const prev = useRef(signature);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      prev.current = signature;
      return undefined;
    }
    if (signature === prev.current) return undefined;
    prev.current = signature;
    // Nothing to animate into an empty cover.
    if (!signature) return undefined;
    // Re-trigger cleanly even if a previous shuffle is mid-flight.
    setShuffling(false);
    const raf = requestAnimationFrame(() => setShuffling(true));
    const done = setTimeout(() => setShuffling(false), ms + 32);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [signature, ms]);

  return shuffling;
}
