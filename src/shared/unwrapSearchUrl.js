// Pull a real image URL out of a search-engine viewer URL. Used by
// the renderer's drop extractor AND the main-process Dock-drop /
// saves:drop-url handlers — Safari attaches the surrounding viewer
// URL on drag rather than the image src like Chrome does, so the
// receiver gets back HTML and bails. Unwrapping the embedded URL
// (imgurl on Google, mediaurl on Bing, etc.) lets the same drag
// land as an image save instead of a URL-kind capture.
//
// CommonJS so main + renderer can both consume it. Vite + Electron
// both transparently handle `require` on this file.

function unwrapSearchEngineUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    // Google Images (/imgres?imgurl=…&imgrefurl=…)
    if (/(^|\.)google\./i.test(u.hostname) && /\/imgres/.test(u.pathname)) {
      const imgurl = u.searchParams.get('imgurl');
      if (imgurl) return imgurl;
    }
    // Bing Images (/images/search?…&mediaurl=…)
    if (/(^|\.)bing\./i.test(u.hostname) && /\/images\//.test(u.pathname)) {
      const mediaurl = u.searchParams.get('mediaurl');
      if (mediaurl) return mediaurl;
    }
    // Yahoo Image Search
    if (/(^|\.)yahoo\./i.test(u.hostname)) {
      const imgurl = u.searchParams.get('imgurl');
      if (imgurl) return imgurl;
    }
  } catch { /* invalid URL — fall through */ }
  return null;
}

module.exports = { unwrapSearchEngineUrl };
