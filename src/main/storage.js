const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

function getImagesDir() {
  // Resolved per-call so library switches are picked up without
  // needing to plumb a path through every save / read code path.
  const { getActiveLibraryRoot } = require('./library-registry');
  return path.join(getActiveLibraryRoot(), 'images');
}

function getThumbsDir() {
  const { getActiveLibraryRoot } = require('./library-registry');
  return path.join(getActiveLibraryRoot(), 'thumbs');
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
  // Hash first. If the same bytes already live in the library
  // (non-trashed), short-circuit — no file writes, no palette work.
  // The caller (ipc/capture) is responsible for surfacing the
  // duplicate to the user instead of inserting a new save.
  const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
  try {
    const { findSaveByHash } = require('./db');
    const existing = findSaveByHash(contentHash);
    if (existing) {
      return { duplicateOf: existing.id, existing };
    }
  } catch (err) {
    // Pre-init or migration glitch — fall through and write as new.
    console.warn('[gatheros] dedup lookup failed, treating as new:', err.message);
  }

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
    contentHash,
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

// Download a secondary carousel asset (image or video) into the images
// dir so it survives the source CDN's signed-URL expiry. Unlike
// saveImageFromUrl / saveVideoFromUrl this writes no `saves` row, no
// thumbnail, and no palette — the file lives only inside a save's
// tweet_meta media list, referenced by its local absolute path. Returns
// { path, isVideo } or null on any failure (caller keeps the remote URL
// as a best-effort fallback).
async function saveAuxMedia(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        Accept: '*/*',
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    const ct = res.headers.get('content-type') || '';
    const isVideo = /^video\//i.test(ct) || /\.mp4(\?|$)/i.test(url);
    const ext = isVideo ? 'mp4' : (extFromMime(ct) || extFromUrl(url) || 'jpg');
    const id = crypto.randomUUID();
    const p = path.join(getImagesDir(), `${id}.${ext}`);
    fs.writeFileSync(p, buf);
    return { path: p, isVideo };
  } catch (err) {
    console.warn('[gatheros] aux media download failed:', err?.message || err);
    return null;
  }
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

  // Column width drives the resolution of every tile — wider columns mean
  // less downscaling for source images (most are already > 1200px), and
  // a print-quality canvas. 3 cols × 1200 ≈ 4900px wide, retina-friendly.
  const COL_WIDTH = 1200;
  const GAP = 32;
  const PADDING = 64;
  const BG = { r: 235, g: 235, b: 235, alpha: 1 }; // #EBEBEB — match the app surface

  const columns = Math.min(
    saves.length,
    saves.length <= 4 ? 2 : saves.length <= 9 ? 3 : 4,
  );

  // Resize each save to the column width so heights are deterministic.
  const tiles = [];
  for (const save of saves) {
    // Video saves store an MP4 at file_path that sharp can't decode.
    // Use the poster still (thumb_path) so the video lands in the
    // board as its first frame instead of being silently skipped.
    const sourcePath =
      save?.kind === 'video' && save?.thumb_path ? save.thumb_path : save?.file_path;
    if (!sourcePath || !fs.existsSync(sourcePath)) continue;
    try {
      const resized = await sharp(sourcePath)
        .resize({ width: COL_WIDTH, withoutEnlargement: false })
        .png()
        .toBuffer({ resolveWithObject: true });
      tiles.push({
        buf: resized.data,
        width: resized.info.width,
        height: resized.info.height,
      });
    } catch (err) {
      console.error('Skipping unreadable save in board:', sourcePath, err.message);
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

// Download a remote video (MP4) into the library and write a JPEG
// thumbnail from a separately-fetched poster image. Used by the
// X-bookmark capture path when the bookmarked tweet has a video
// attached but no still images.
//
// Returns the same { id, filePath, thumbPath, width, height,
// fileSize, palette, contentHash, kind } shape as
// saveImageFromUrl so the caller can spread the result into
// insertSave without special-casing. Dedups by SHA-256 of the
// video bytes — re-bookmarking the same video is a silent no-op.
async function saveVideoFromUrl(videoUrl, posterUrl) {
  if (!videoUrl) throw new Error('videoUrl required');

  const vres = await fetch(videoUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      Accept: 'video/mp4,video/*,*/*;q=0.8',
    },
  });
  if (!vres.ok) {
    throw new Error(`Failed to fetch video: ${vres.status} ${vres.statusText}`);
  }
  const videoBuffer = Buffer.from(await vres.arrayBuffer());
  if (videoBuffer.length === 0) {
    throw new Error('Empty video response');
  }

  // Dedup against the existing library before writing anything to
  // disk. Hash is over the video bytes — different bitrate variants
  // of the same tweet hash differently and would each save once
  // (acceptable; the user can't actually trigger that from the UI).
  const contentHash = crypto.createHash('sha256').update(videoBuffer).digest('hex');
  try {
    const { findSaveByHash } = require('./db');
    const existing = findSaveByHash(contentHash);
    if (existing) {
      return { duplicateOf: existing.id, existing };
    }
  } catch (err) {
    console.warn('[gatheros] video dedup lookup failed, treating as new:', err.message);
  }

  const id = crypto.randomUUID();
  const ext = (extFromUrl(videoUrl) || 'mp4').toLowerCase();
  const filePath = path.join(getImagesDir(), `${id}.${ext}`);
  fs.writeFileSync(filePath, videoBuffer);

  // Try to parse the video's pixel dimensions out of the twimg URL.
  // Twitter encodes them in the path (e.g. /vid/avc1/1280x720/...).
  // Falls through to the poster's dimensions below if the URL
  // doesn't follow that pattern (older / non-twimg sources).
  let width = null;
  let height = null;
  const urlDims = videoUrl.match(/\/(\d{2,5})x(\d{2,5})\//);
  if (urlDims) {
    width = parseInt(urlDims[1], 10);
    height = parseInt(urlDims[2], 10);
  }

  // Fetch the poster image and use it as the save's thumbnail. We
  // need sharp anyway to downscale the poster to thumb size; same
  // 400x300 cap the image pipeline uses so grid layout math stays
  // identical between image and video saves.
  let thumbPath = null;
  if (posterUrl) {
    try {
      const sharp = require('sharp');
      const pres = await fetch(posterUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      });
      if (pres.ok) {
        const pbuf = Buffer.from(await pres.arrayBuffer());
        if (pbuf.length > 0) {
          thumbPath = path.join(getThumbsDir(), `${id}.jpg`);
          await sharp(pbuf)
            .resize(400, 300, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(thumbPath);
          if (!width || !height) {
            const pmeta = await sharp(pbuf).metadata();
            width = width || pmeta.width || null;
            height = height || pmeta.height || null;
          }
        }
      }
    } catch (err) {
      console.warn('[gatheros] video poster fetch failed:', err.message);
    }
  }

  return {
    id,
    filePath,
    thumbPath,
    width,
    height,
    fileSize: videoBuffer.length,
    palette: null,
    contentHash,
    kind: 'video',
  };
}

module.exports = {
  ensureStorageDirs,
  getImagesDir,
  getThumbsDir,
  saveImageFromBase64,
  saveImageFromFile,
  saveImageFromBuffer,
  saveImageFromUrl,
  saveVideoFromUrl,
  saveAuxMedia,
  deleteImageFiles,
  composeMoodBoard,
};
