// Zip-folder ingest. Streams entries out of a .zip with yauzl,
// filters to image extensions, and pushes each one through the same
// saveImageFromBuffer → insertSave path the rest of the app uses for
// file/url drops. Returns a summary so the renderer can show a toast
// like "Imported 12 of 14 (1 duplicate, 1 skipped)".

const path = require('node:path');
const yauzl = require('yauzl');
const { saveImageFromBuffer } = require('./storage');
const { insertSave } = require('./db');
const { notifySaved, notifyDuplicate } = require('./notify');

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.heic',
]);

function isImageEntry(name) {
  if (!name) return false;
  if (name.endsWith('/')) return false; // directory entry
  // Skip macOS .DS_Store + AppleDouble resource forks ("__MACOSX/..." or "._foo").
  const base = path.basename(name);
  if (base === '.DS_Store') return false;
  if (base.startsWith('._')) return false;
  if (name.startsWith('__MACOSX/')) return false;
  return IMAGE_EXTS.has(path.extname(name).toLowerCase());
}

function readEntryBuffer(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

function titleFromEntry(entry) {
  const base = path.basename(entry.fileName);
  const noExt = base.slice(0, base.lastIndexOf('.')) || base;
  return noExt.replace(/[-_]+/g, ' ').trim();
}

// Ingest entries sequentially so insertSave / sharp / palette work
// stay on one core and so dedup against earlier entries in the same
// archive behaves predictably.
//
// Options:
//   onInserted(record): called for each freshly-inserted save (not
//     fired for duplicates / skipped / errored entries). Used by
//     the starter-pack installer to tag each new save.
function ingestZip(zipPath, { onInserted } = {}) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const counts = { inserted: 0, duplicates: 0, skipped: 0, errors: 0 };
      let pending = Promise.resolve();
      zipfile.on('error', reject);
      zipfile.on('entry', (entry) => {
        if (!isImageEntry(entry.fileName)) {
          counts.skipped += 1;
          zipfile.readEntry();
          return;
        }
        pending = pending.then(async () => {
          try {
            const buffer = await readEntryBuffer(zipfile, entry);
            const ext = path.extname(entry.fileName).slice(1).toLowerCase();
            const imgData = await saveImageFromBuffer(buffer, ext);
            if (imgData.duplicateOf) {
              notifyDuplicate(imgData.existing);
              counts.duplicates += 1;
            } else {
              const record = insertSave({ ...imgData, title: titleFromEntry(entry) });
              notifySaved(record);
              counts.inserted += 1;
              if (typeof onInserted === 'function') {
                try { onInserted(record); } catch { /* callback failure is non-fatal */ }
              }
            }
          } catch (e) {
            console.error('[zip-import] entry failed:', entry.fileName, e?.message || e);
            counts.errors += 1;
          } finally {
            zipfile.readEntry();
          }
        });
      });
      zipfile.on('end', () => {
        pending.then(() => resolve(counts)).catch(reject);
      });
      zipfile.readEntry();
    });
  });
}

module.exports = { ingestZip };
