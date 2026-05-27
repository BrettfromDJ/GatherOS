// Pull every plausible image URL out of a DataTransfer. Handles
// HTML fragments (srcset, lazy-load attrs), text/uri-list, and bare
// text drops. Used by the app-level drop handler in App.jsx and the
// Sidebar's per-folder external drop handler so they share parsing.

import { unwrapSearchEngineUrl } from '../../shared/unwrapSearchUrl.js';

function pickLargestFromSrcset(srcset) {
  if (!srcset) return null;
  let best = null;
  let bestWidth = -1;
  for (const part of srcset.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [url, descriptor] = trimmed.split(/\s+/);
    const w = descriptor && descriptor.endsWith('w')
      ? parseFloat(descriptor)
      : descriptor && descriptor.endsWith('x')
        ? parseFloat(descriptor) * 1000
        : 0;
    if (url && w > bestWidth) {
      best = url;
      bestWidth = w;
    }
  }
  return best;
}

export function extractDropImageUrls(dataTransfer) {
  const seen = new Set();
  const candidates = [];
  const add = (url) => {
    if (!url) return;
    const u = url.trim();
    if (!u || seen.has(u)) return;
    if (!/^(https?:|data:)/i.test(u)) return;
    // If this looks like a Google / Bing / Yahoo image-search wrapper
    // URL, push the embedded image URL ahead of the wrapper so the
    // main process tries the real image first. The wrapper stays as
    // a fallback in case the unwrap is wrong.
    const unwrapped = unwrapSearchEngineUrl(u);
    if (unwrapped && !seen.has(unwrapped)) {
      seen.add(unwrapped);
      candidates.push(unwrapped);
    }
    seen.add(u);
    candidates.push(u);
  };

  const html = dataTransfer.getData('text/html');
  if (html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const img of doc.querySelectorAll('img')) {
        add(pickLargestFromSrcset(img.getAttribute('srcset')));
        add(img.getAttribute('src'));
        add(img.getAttribute('data-src'));
        add(img.getAttribute('data-original'));
      }
    } catch {
      const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m) add(m[1]);
    }
  }

  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList) {
    for (const line of uriList.split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith('#')) add(t);
    }
  }

  const text = dataTransfer.getData('text/plain');
  if (text) add(text);

  return candidates;
}

export function dataTransferLooksLikeImage(dataTransfer) {
  const types = dataTransfer?.types;
  if (!types) return false;
  if (Array.from(types).includes('Files')) return true;
  if (Array.from(types).includes('text/uri-list')) return true;
  if (Array.from(types).includes('text/html')) return true;
  return false;
}
