const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

function getImagesDir() {
  return path.join(app.getPath('userData'), 'images');
}

function getThumbsDir() {
  return path.join(app.getPath('userData'), 'thumbs');
}

function ensureStorageDirs() {
  for (const dir of [getImagesDir(), getThumbsDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function saveImageFromBase64(dataUrl) {
  const sharp = require('sharp');
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/s);
  if (!match) throw new Error('Invalid image data URL');

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  return _writeImageFiles(buffer, ext, sharp);
}

async function saveImageFromFile(sourcePath) {
  const sharp = require('sharp');
  const ext = path.extname(sourcePath).slice(1).toLowerCase() || 'png';
  const buffer = fs.readFileSync(sourcePath);
  return _writeImageFiles(buffer, ext, sharp);
}

async function saveImageFromBuffer(buffer, ext = 'png') {
  const sharp = require('sharp');
  return _writeImageFiles(buffer, ext, sharp);
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']);

function extFromMime(mime) {
  if (!mime) return null;
  const m = mime.toLowerCase().match(/^image\/([\w+.-]+)/);
  if (!m) return null;
  let ext = m[1];
  if (ext === 'jpeg') ext = 'jpg';
  if (ext.includes('+')) ext = ext.split('+')[0];
  return IMAGE_EXTS.has(ext) ? ext : null;
}

function extFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot < 0) return null;
    let ext = last.slice(dot + 1).toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    return IMAGE_EXTS.has(ext) ? ext : null;
  } catch {
    return null;
  }
}

async function saveImageFromUrl(url) {
  const sharp = require('sharp');

  if (url.startsWith('data:')) {
    return saveImageFromBase64(url);
  }
  if (url.startsWith('blob:')) {
    throw new Error('Blob URLs only exist inside the browser; drag the image directly instead.');
  }

  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/') && !extFromUrl(url)) {
    throw new Error(`Response is not an image: ${contentType || 'unknown'}`);
  }
  const ext = extFromMime(contentType) || extFromUrl(url) || 'png';
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error('Empty image response');
  }
  return _writeImageFiles(buffer, ext, sharp);
}

async function _writeImageFiles(buffer, ext, sharp) {
  const id = crypto.randomUUID();
  const filePath = path.join(getImagesDir(), `${id}.${ext}`);
  const thumbPath = path.join(getThumbsDir(), `${id}.jpg`);

  fs.writeFileSync(filePath, buffer);

  const meta = await sharp(buffer).metadata();
  await sharp(buffer)
    .resize(400, 300, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(thumbPath);

  let palette = null;
  try {
    palette = await extractPalette(buffer, sharp, 6);
  } catch (err) {
    console.error('Palette extraction failed:', err);
  }

  return {
    id,
    filePath,
    thumbPath,
    width: meta.width || null,
    height: meta.height || null,
    fileSize: buffer.length,
    palette,
  };
}

// Quantize to a 5-bit-per-channel histogram (32^3 = 32k buckets), pick
// the most populated buckets while filtering out near-duplicates.
async function extractPalette(buffer, sharp, maxColors = 6) {
  const { data, info } = await sharp(buffer)
    .resize(64, 64, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bins = new Map();
  const channels = info.channels || 3;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i] >> 3;
    const g = data[i + 1] >> 3;
    const b = data[i + 2] >> 3;
    const key = (r << 10) | (g << 5) | b;
    bins.set(key, (bins.get(key) || 0) + 1);
  }

  const sorted = [...bins.entries()].sort((a, b) => b[1] - a[1]);
  const out = [];
  const picked = [];
  const SIMILARITY_THRESHOLD = 60;

  for (const [key] of sorted) {
    const r = ((key >> 10) & 0x1f) << 3;
    const g = ((key >> 5) & 0x1f) << 3;
    const b = (key & 0x1f) << 3;

    const tooSimilar = picked.some(
      (c) => Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b) < SIMILARITY_THRESHOLD,
    );
    if (tooSimilar) continue;

    picked.push({ r, g, b });
    out.push(
      '#' +
        [r, g, b]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join(''),
    );
    if (out.length >= maxColors) break;
  }
  return out;
}

function deleteImageFiles(filePath, thumbPath) {
  try { fs.unlinkSync(filePath); } catch {}
  try { fs.unlinkSync(thumbPath); } catch {}
}

module.exports = {
  ensureStorageDirs,
  getImagesDir,
  getThumbsDir,
  saveImageFromBase64,
  saveImageFromFile,
  saveImageFromBuffer,
  saveImageFromUrl,
  deleteImageFiles,
};
