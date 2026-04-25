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
    palette = await extractPalette(buffer, sharp, 8);
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

// Get up to 6 semantically-named swatches (Vibrant / Muted / DarkVibrant /
// DarkMuted / LightVibrant / LightMuted) from node-vibrant, then top up
// with frequency-based bins so the result is balanced rather than
// dominated by whatever neutral background occupies the most pixels.
async function extractPalette(buffer, sharp, maxColors = 8) {
  const out = [];
  const pickedRgb = [];
  const seen = new Set();

  const tryPush = (hex, rgb) => {
    if (!hex) return false;
    const lower = hex.toLowerCase();
    if (seen.has(lower)) return false;
    if (rgb && tooSimilarToAny(rgb, pickedRgb)) return false;
    seen.add(lower);
    if (rgb) pickedRgb.push(rgb);
    out.push(lower);
    return true;
  };

  // 1) node-vibrant — covers the dominant + accent + light/dark variants.
  try {
    const { Vibrant } = require('node-vibrant/node');
    const palette = await Vibrant.from(buffer).getPalette();
    const order = ['Vibrant', 'LightVibrant', 'DarkVibrant', 'Muted', 'LightMuted', 'DarkMuted'];
    for (const key of order) {
      const sw = palette?.[key];
      if (!sw) continue;
      const [r, g, b] = sw.rgb || [];
      tryPush(sw.hex, { r, g, b });
      if (out.length >= maxColors) break;
    }
  } catch (err) {
    console.error('Vibrant extraction failed:', err);
  }

  // 2) Histogram top-up to fill any remaining slots with the most
  //    populous bins not already represented.
  if (out.length < maxColors) {
    const extras = await histogramPalette(buffer, sharp, maxColors - out.length, pickedRgb);
    for (const e of extras) {
      tryPush(e.hex, e.rgb);
      if (out.length >= maxColors) break;
    }
  }

  return out;
}

function tooSimilarToAny(rgb, picked, threshold = 60) {
  return picked.some(
    (c) => Math.abs(c.r - rgb.r) + Math.abs(c.g - rgb.g) + Math.abs(c.b - rgb.b) < threshold,
  );
}

// 5-bit-per-channel histogram (32^3 = 32k buckets). Returns sorted
// entries already filtered against alreadyPicked.
async function histogramPalette(buffer, sharp, want, alreadyPicked = []) {
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
  const picked = [...alreadyPicked];

  for (const [key] of sorted) {
    const r = ((key >> 10) & 0x1f) << 3;
    const g = ((key >> 5) & 0x1f) << 3;
    const b = (key & 0x1f) << 3;
    if (tooSimilarToAny({ r, g, b }, picked)) continue;
    picked.push({ r, g, b });
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    out.push({ hex, rgb: { r, g, b } });
    if (out.length >= want) break;
  }
  return out;
}

function deleteImageFiles(filePath, thumbPath) {
  try { fs.unlinkSync(filePath); } catch {}
  try { fs.unlinkSync(thumbPath); } catch {}
}

// Compose a multi-image mood board PNG. Greedy-packs into N columns
// (column count scales with selection size) — each new tile lands in
// whichever column is currently shortest, mirroring the in-app
// masonry's visual but balanced for height.
async function composeMoodBoard(saves, outputPath) {
  if (!Array.isArray(saves) || saves.length === 0) {
    throw new Error('composeMoodBoard called without any saves');
  }
  const sharp = require('sharp');

  const COL_WIDTH = 500;
  const GAP = 16;
  const PADDING = 32;
  const BG = { r: 250, g: 250, b: 249, alpha: 1 }; // #FAFAF9 — match the app surface

  const columns = Math.min(
    saves.length,
    saves.length <= 4 ? 2 : saves.length <= 9 ? 3 : 4,
  );

  // Resize each save to the column width so heights are deterministic.
  const tiles = [];
  for (const save of saves) {
    if (!save?.file_path || !fs.existsSync(save.file_path)) continue;
    try {
      const resized = await sharp(save.file_path)
        .resize({ width: COL_WIDTH, withoutEnlargement: false })
        .png()
        .toBuffer({ resolveWithObject: true });
      tiles.push({
        buf: resized.data,
        width: resized.info.width,
        height: resized.info.height,
      });
    } catch (err) {
      console.error('Skipping unreadable save in board:', save.file_path, err.message);
    }
  }
  if (tiles.length === 0) throw new Error('No readable images to compose');

  // Greedy: each tile drops into the currently shortest column.
  const colHeights = Array(columns).fill(0);
  const colCounts = Array(columns).fill(0);
  const placements = [];
  for (const tile of tiles) {
    let shortest = 0;
    for (let i = 1; i < columns; i += 1) {
      if (colHeights[i] < colHeights[shortest]) shortest = i;
    }
    const isFirstInCol = colCounts[shortest] === 0;
    const top = colHeights[shortest] + (isFirstInCol ? 0 : GAP);
    const left = shortest * (COL_WIDTH + GAP);
    placements.push({ buf: tile.buf, top, left });
    colHeights[shortest] = top + tile.height;
    colCounts[shortest] += 1;
  }

  const totalWidth = columns * COL_WIDTH + (columns - 1) * GAP + PADDING * 2;
  const totalHeight = Math.max(...colHeights) + PADDING * 2;

  await sharp({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 4,
      background: BG,
    },
  })
    .composite(
      placements.map((p) => ({
        input: p.buf,
        top: PADDING + p.top,
        left: PADDING + p.left,
      })),
    )
    .png()
    .toFile(outputPath);

  return { width: totalWidth, height: totalHeight, count: tiles.length };
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
  composeMoodBoard,
};
