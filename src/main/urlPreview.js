// Lightweight URL metadata fetch for the Save-a-URL preview. Unlike
// urlCapture.js (which spins up a hidden BrowserWindow and screenshots
// the whole page), this just fetches the page's HTML head and parses the
// Open Graph / <title> / favicon tags — fast enough to run live as the
// user types a link. Returns { url, title, description, siteName, image,
// favicon }. Throws on a hard failure so the caller can fall back to a
// bare-domain preview.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024; // the <head> is all we need

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

async function fetchUrlPreview(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url) throw new Error('url required');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let base;
  try { base = new URL(url); } catch { throw new Error('invalid url'); }

  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
    });
  } catch {
    throw new Error('fetch failed');
  }
  if (!res.ok) throw new Error(`status ${res.status}`);

  // Read only enough of the body to cover <head>.
  let html = '';
  try {
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (reader) {
      const dec = new TextDecoder();
      let total = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        html += dec.decode(value, { stream: true });
        if (total >= MAX_BYTES || /<\/head>/i.test(html)) {
          try { reader.cancel(); } catch { /* ignore */ }
          break;
        }
      }
    } else {
      html = (await res.text()).slice(0, MAX_BYTES);
    }
  } catch {
    throw new Error('read failed');
  }

  let baseU;
  try { baseU = new URL(res.url || url); } catch { baseU = base; }

  const metaContent = (key) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`,
      'i',
    );
    const tag = html.match(re);
    if (!tag) return '';
    const c = tag[0].match(/content\s*=\s*["']([^"']*)["']/i);
    return c ? decodeEntities(c[1]) : '';
  };

  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title =
    metaContent('og:title')
    || (titleTag ? decodeEntities(titleTag[1]) : '')
    || baseU.hostname;
  const description = metaContent('og:description') || metaContent('description') || '';
  const siteName = metaContent('og:site_name') || baseU.hostname.replace(/^www\./, '');

  const absolute = (u) => {
    if (!u) return '';
    try { return new URL(u, baseU).toString(); } catch { return ''; }
  };

  let image = absolute(metaContent('og:image') || metaContent('twitter:image'));

  let favicon = '';
  const iconTag = html.match(/<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i);
  if (iconTag) {
    const h = iconTag[0].match(/href\s*=\s*["']([^"']+)["']/i);
    if (h) favicon = absolute(h[1]);
  }
  if (!favicon) favicon = `${baseU.origin}/favicon.ico`;

  return { url: baseU.toString(), title, description, siteName, image, favicon };
}

module.exports = { fetchUrlPreview };
