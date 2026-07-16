const { ipcMain, shell, dialog, BrowserWindow, nativeImage, clipboard, app, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  getAllSaves, getSave, deleteSave, restoreSave, permanentlyDeleteSave,
  emptyTrash, wipeLibrary, updateSave, insertSave,
  getSaveEmbeddingsCached, getSavesByIds, getUnindexedSaves, getUnindexedCount, getSmartViewCounts,
  filterByColor, findSimilarByPalette,
  getAllCollections, getAllCollectionsWithThumbs, getCollectionsForSave, getCollectionsContainingAll, createCollection, renameCollection, setCollectionParent,
  deleteCollection, reorderCollections, addSaveToCollection, removeSaveFromCollection,
  getAllTags, getTagsForSave, addTagToSave, removeTagFromSave,
  listBoards, listBoardsWithThumbs, getBoard, createBoard, renameBoard, deleteBoard, reorderBoards,
  getBoardItems, getBoardPreviewSaves, getBoardSaveIds, getBoardsForSave,
  upsertBoardItem, bulkUpdateBoardItems, deleteBoardItem, deleteBoardItems,
} = require('./db');
const {
  deleteImageFiles,
  saveImageFromFile,
  saveImageFromUrl,
  saveImageFromBuffer,
  composeMoodBoard,
  composeMoodBoardGif,
  getStorageUsage,
  reclaimLibraryStorage,
} = require('./storage');
const {
  startScreenshotCapture,
  captureFullscreen,
  captureWindow,
} = require('./capture');
const { notifySaved, notifyDuplicate, refreshTray } = require('./notify');
const { setToastInteractive, onToastsEmpty } = require('./toast-window');
const settings = require('./settings');
const { quitAndInstall } = require('./updater');
const { ingestZip } = require('./zipImport');
const { installStarterPack, removeStarterPack, restoreSnapshot } = require('./starterPack');
const { captureUrl } = require('./urlCapture');
const { unwrapSearchEngineUrl } = require('../shared/unwrapSearchUrl');
const {
  hasSession: hasAiSession,
  autoTagImage,
  analyzeImage,
  embedText,
  generateImagePrompt,
  getUsage: getAiUsage,
} = require('./openai');
const { detectColorName } = require('./colorNames');
const { canCreateSave } = require('./entitlement');
const { notifyNeedsUpgrade } = require('./notify');

// Free-tier save guard for IPC handlers. Returns true (and surfaces the
// upgrade prompt in the renderer) when a new save must be blocked. The
// caller returns its own needsUpgrade-shaped result so the renderer's
// call site stays happy. Fails OPEN via canCreateSave().
function blockNewSave(source) {
  if (canCreateSave()) return false;
  try { notifyNeedsUpgrade({ source: source || 'save' }); } catch { /* ignore */ }
  return true;
}

// Dot product over pre-normalized vectors (the embedding cache stores
// unit vectors) — equivalent to cosine at half the arithmetic.
function dotSim(a, b) {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) dot += a[i] * b[i];
  return dot;
}

// LRU-ish cache for embedding the current search query. Each
// keystroke goes through saves:get-all and the renderer's 180ms
// debouncer doesn't dedupe across backspace-retype or revisited
// queries — paying $0.0001 + ~150ms per repeat is wasteful when
// the vector is deterministic. Cap of 50 keeps memory negligible
// (~300KB for 50 × 1536 × 4 bytes) and the eviction insertion-order
// keeps recent queries warm without explicit LRU bookkeeping.
const QUERY_EMBEDDING_CACHE = new Map();
const QUERY_EMBEDDING_CACHE_MAX = 50;

async function embedQueryCached(queryText) {
  const key = (queryText || '').trim().toLowerCase();
  if (!key) throw new Error('Cannot embed empty text');
  if (QUERY_EMBEDDING_CACHE.has(key)) {
    // Refresh recency by re-inserting (Map iteration order = insertion).
    const cached = QUERY_EMBEDDING_CACHE.get(key);
    QUERY_EMBEDDING_CACHE.delete(key);
    QUERY_EMBEDDING_CACHE.set(key, cached);
    return cached;
  }
  const vec = await embedText(queryText);
  QUERY_EMBEDDING_CACHE.set(key, vec);
  if (QUERY_EMBEDDING_CACHE.size > QUERY_EMBEDDING_CACHE_MAX) {
    const oldest = QUERY_EMBEDDING_CACHE.keys().next().value;
    QUERY_EMBEDDING_CACHE.delete(oldest);
  }
  return vec;
}

function registerIpcHandlers({ socialImportState = null } = {}) {
  ipcMain.handle('social-import:get', () => socialImportState?.get?.() || null);
  ipcMain.handle('social-import:cancel', (_event, runId) => (
    socialImportState?.cancel?.(runId) || { ok: false, error: 'social import unavailable' }
  ));
  ipcMain.handle('social-import:dismiss', (_event, runId) => (
    socialImportState?.dismiss?.(runId) || { ok: false, error: 'social import unavailable' }
  ));
  // Merges saves whose extracted palette is perceptually similar to a
  // named color in the query (e.g. "orange", "navy") into the existing
  // result set. Same view filters (collection/explicit colorHex) get
  // applied so semantic + LIKE + name-color-match all honor the active
  // context.
  function mergeColorNameMatches(results, opts, queryText) {
    const detectedHex = detectColorName(queryText);
    if (!detectedHex) return results;
    // Get every save that already passes the user's other filters
    // (view, collection, plus any tag:/bucket:/before:/etc. tokens
    // sitting in opts.search). Pass only the structural tokens —
    // free text would re-restrict the set we're trying to broaden
    // via implicit color-name detection.
    const structuralTokens = (opts.search || '')
      .match(/(\w+:"[^"]*"|\w+:\S+|\S+)/g) || [];
    const filterOnly = structuralTokens.filter((t) => /^\w+:/.test(t)).join(' ');
    const filteredSet = getAllSaves({
      filter: opts.filter,
      collectionId: opts.collectionId,
      colorHex: opts.colorHex || undefined,
      search: filterOnly,
    });
    // Strict: ΔE 16 ("clearly the same color") + only the top 3 most
    // vibrant swatches per save (Vibrant / LightVibrant / DarkVibrant
    // from node-vibrant) so a stray dark-blue shadow on a red image
    // doesn't surface as a "blue" match.
    const colorMatches = filterByColor(filteredSet, detectedHex, 16, 3);
    if (colorMatches.length === 0) return results;
    const seen = new Set(results.map((s) => s.id));
    const merged = [...results];
    for (const m of colorMatches) {
      if (!seen.has(m.id)) {
        merged.push(m);
        seen.add(m.id);
      }
    }
    return merged;
  }

  ipcMain.handle('saves:get-all', async (_e, opts = {}) => {
    const semanticEnabled = settings.getPref('semanticSearch', true);
    const haveAi = hasAiSession();
    const rawSearch = (opts.search || '').trim();

    // Pull out any tag:/bucket:/color:/before: etc. filters so the
    // embedding query runs only against the user's free text, and so
    // semantic candidates can be intersected with the structurally-
    // filtered set below. parseSearchQuery is also called inside
    // getAllSaves; doing it here too is cheap (regex tokenisation).
    const { parseSearchQuery } = require('./searchQuery');
    const parsed = parseSearchQuery(rawSearch);
    const queryText = parsed.text;

    // Falls back to the regular LIKE path if semantic search isn't
    // configured, isn't on, or there's no actual free text to embed
    // (a query of just `tag:foo` doesn't need embeddings).
    if (!semanticEnabled || !haveAi || !queryText) {
      return mergeColorNameMatches(getAllSaves(opts), opts, queryText);
    }

    try {
      // Single embedding call drives the cosine ranker. Query
      // expansion + LLM rerank were tried but each added 500-1500 ms
      // of latency to a search bar that needs to feel near-instant.
      // The hybrid LIKE pass below is the recall safety net for
      // narrow queries; threshold + relative cap below is the
      // precision filter.
      const queryVec = await embedQueryCached(queryText);
      // Normalize the query once; cached doc vectors are pre-normalized,
      // so scoring is a plain dot product.
      const queryF32 = new Float32Array(queryVec);
      let qn = 0;
      for (let i = 0; i < queryF32.length; i += 1) qn += queryF32[i] * queryF32[i];
      qn = Math.sqrt(qn) || 1;
      for (let i = 0; i < queryF32.length; i += 1) queryF32[i] /= qn;

      // Cosine threshold tuned for text-embedding-3-small over the
      // analyzeImage description format. Below ~0.26 reads as noise;
      // the hybrid LIKE pass over title + tags catches literal keyword
      // matches as a safety net.
      const MIN_SCORE = 0.26;
      // Tighter relative cap so marginal matches don't ride along with
      // a strong top result. With ~rich descriptions the model groups
      // many images at moderate similarity, and 0.55 was lenient
      // enough to drag most of them in. 0.72 keeps only the genuinely
      // close cluster around the top.
      const RELATIVE_CUTOFF = 0.72;

      const scored = getSaveEmbeddingsCached()
        .map(({ id, vec }) => ({ id, score: dotSim(queryF32, vec) }))
        .filter((r) => r.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score);

      let candidates = [];
      if (scored.length > 0) {
        const relativeFloor = scored[0].score * RELATIVE_CUTOFF;
        const ranked = scored.filter((r) => r.score >= relativeFloor);
        const topIds = ranked.slice(0, 80).map((r) => r.id);
        candidates = getSavesByIds(topIds);
        const orderById = new Map(topIds.map((id, i) => [id, i]));
        candidates.sort((a, b) => orderById.get(a.id) - orderById.get(b.id));
      }

      // Hybrid pass: also pull the substring-LIKE matches against
      // title / ai_description / tag names. This catches the mountain
      // vs mountains case where a single character shifts the cosine
      // just under the threshold but the word actually appears in the
      // description. Semantic results lead, then any LIKE-only matches
      // append in their natural recency order.
      const likeMatches = getAllSaves(opts);
      const seen = new Set(candidates.map((s) => s.id));
      const merged = [...candidates];
      for (const s of likeMatches) {
        if (!seen.has(s.id)) {
          merged.push(s);
          seen.add(s.id);
        }
      }

      // Constrain semantic candidates to the structurally-filtered
      // set (view / collection / tag: / bucket: / is:untagged /
      // before: / after:). LIKE matches already obey these because
      // getAllSaves ran with the full opts. The structural set is
      // the same opts but with the free text stripped — text
      // matching is what the embeddings do.
      const structuralTokens = (rawSearch.match(/(\w+:"[^"]*"|\w+:\S+|\S+)/g) || [])
        .filter((t) => /^\w+:/.test(t))
        .join(' ');
      const structuralOpts = { ...opts, search: structuralTokens };
      const structuralIds = new Set(getAllSaves(structuralOpts).map((s) => s.id));
      let filtered = merged.filter((s) => structuralIds.has(s.id));
      if (parsed.colorHex || opts.colorHex) {
        filtered = filterByColor(filtered, parsed.colorHex || opts.colorHex);
      }
      return mergeColorNameMatches(filtered, opts, queryText);
    } catch (err) {
      console.error('Semantic search failed, falling back to LIKE:', err.message);
      return mergeColorNameMatches(getAllSaves(opts), opts, queryText);
    }
  });

  // Broadcast helper for save lifecycle events the renderer cares
  // about. Boards listen so they can drop any items referencing a
  // trashed/deleted save without the user having to reload the
  // board view.
  function broadcastSavesDeleted(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('save:deleted', { ids }); }
      catch { /* renderer may be tearing down */ }
    }
  }

  // Soft delete — sends the save to Trash. Files stay on disk until the
  // user permanently deletes or empties Trash.
  ipcMain.handle('saves:delete', (_e, id) => {
    const r = deleteSave(id);
    if (r?.ok) broadcastSavesDeleted([id]);
    refreshTray();
    return r;
  });

  ipcMain.handle('saves:restore', (_e, id) => {
    const r = restoreSave(id);
    refreshTray();
    return r;
  });

  // View bump for the "Most viewed" sort. Fire-and-forget; no event
  // emitted (see db.markSaveViewed).
  ipcMain.handle('saves:mark-viewed', (_e, id) => {
    const { markSaveViewed } = require('./db');
    markSaveViewed(id);
    return { ok: true };
  });
  ipcMain.handle('saves:recently-viewed', (_e, limit) => {
    const { getRecentlyViewed } = require('./db');
    return getRecentlyViewed(limit);
  });

  // Hard delete from Trash: also removes the underlying image + thumb.
  ipcMain.handle('saves:permanent-delete', (_e, id) => {
    const result = permanentlyDeleteSave(id);
    if (result.ok) {
      deleteImageFiles(result.filePath, result.thumbPath);
      broadcastSavesDeleted([id]);
    }
    refreshTray();
    return result;
  });

  ipcMain.handle('saves:empty-trash', () => {
    const result = emptyTrash();
    if (result.ok) {
      for (const f of result.files) deleteImageFiles(f.filePath, f.thumbPath);
      if (result.ids?.length) broadcastSavesDeleted(result.ids);
    }
    refreshTray();
    return { ok: true, count: result.files.length };
  });

  ipcMain.handle('saves:counts', () => getSmartViewCounts());

  // Open the OS file manager with the save's file selected. Returns
  // { ok: false } when the path is missing or can't be resolved so the
  // renderer can show a generic "couldn't reveal" toast.
  ipcMain.handle('saves:reveal-in-finder', (_e, filePath) => {
    if (!filePath || typeof filePath !== 'string') return { ok: false };
    try {
      shell.showItemInFolder(filePath);
      return { ok: true };
    } catch (err) {
      console.error('reveal-in-finder failed:', err);
      return { ok: false };
    }
  });

  ipcMain.handle('saves:confirm-delete', async (e, count) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    const n = Math.max(1, Number(count) || 1);
    const result = await dialog.showMessageBox(owner ?? undefined, {
      type: 'warning',
      buttons: ['Cancel', n === 1 ? 'Delete' : `Delete ${n} Saves`],
      defaultId: 1,
      cancelId: 0,
      title: n === 1 ? 'Delete save?' : `Delete ${n} saves?`,
      message:
        n === 1
          ? 'Are you sure you want to delete this save?'
          : `Are you sure you want to delete these ${n} saves?`,
      detail: 'The image files will be permanently removed from your library.',
    });
    return result.response === 1;
  });

  ipcMain.handle('saves:update', (_e, payload) => updateSave(payload));

  ipcMain.handle('saves:drop-file', async (_e, filePath) => {
    if (blockNewSave('save')) return { needsUpgrade: true };
    const imgData = await saveImageFromFile(filePath);
    if (imgData.duplicateOf) {
      notifyDuplicate(imgData.existing);
      return imgData.existing;
    }
    const record = insertSave(imgData);
    notifySaved(record);
    return record;
  });

  // Import an image from raw clipboard bytes. A pasted image has no
  // filesystem path, so it can't go through saves:drop-file — the
  // renderer hands us the bytes and we run them through the same
  // saveImageFromBuffer → insertSave pipeline (dedup, palette, etc.).
  ipcMain.handle('saves:paste-image', async (_e, payload) => {
    if (blockNewSave('save')) return { needsUpgrade: true };
    const { bytes, ext } = payload || {};
    if (!bytes || !bytes.length) throw new Error('paste-image called without image bytes');
    const buffer = Buffer.from(bytes);
    const safeExt = typeof ext === 'string' && /^[a-z0-9]+$/i.test(ext)
      ? ext.toLowerCase()
      : 'png';
    const imgData = await saveImageFromBuffer(buffer, safeExt);
    if (imgData.duplicateOf) {
      notifyDuplicate(imgData.existing);
      return imgData.existing;
    }
    const record = insertSave(imgData);
    notifySaved(record);
    return record;
  });

  ipcMain.handle('saves:drop-zip', async (_e, zipPath) => {
    if (blockNewSave('save')) return { ok: false, needsUpgrade: true };
    if (!zipPath) throw new Error('drop-zip called without a path');
    try {
      const counts = await ingestZip(zipPath);
      return { ok: true, ...counts };
    } catch (err) {
      console.error('[saves:drop-zip] failed:', err?.message || err);
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Onboarding starter-pack: install bundled images on walkthrough
  // start, remove them if the user picks "start fresh" at the end.
  ipcMain.handle('onboarding:install-starter-pack', () => installStarterPack());
  ipcMain.handle('onboarding:remove-starter-pack', () => removeStarterPack());
  ipcMain.handle('onboarding:restore-snapshot', () => restoreSnapshot());

  // URL-kind saves: take a page URL, screenshot it via a hidden
  // BrowserWindow, insert a save row with kind='url' so the
  // FocusedView knows to swap the image for a live webview at
  // view time. Distinct from saves:drop-url, which treats the URL
  // as a direct image-file URL and downloads it.
  // Live preview for the Save-a-URL panel — fetch title/favicon/cover
  // without screenshotting. No entitlement gate (it's just a preview,
  // not a save).
  ipcMain.handle('saves:preview-url', async (_e, url) => {
    if (typeof url !== 'string' || !url.trim()) return { ok: false, error: 'missing_url' };
    try {
      const { fetchUrlPreview } = require('./urlPreview');
      return { ok: true, preview: await fetchUrlPreview(url.trim()) };
    } catch (err) {
      return { ok: false, error: err?.message || 'preview failed' };
    }
  });

  // Current in-app announcement (remote, no entitlement gate). Returns
  // the announcement object or null. Fail-silent — see announcement.js.
  ipcMain.handle('announcement:get', async () => {
    try {
      const { fetchAnnouncement } = require('./announcement');
      return { ok: true, announcement: await fetchAnnouncement() };
    } catch {
      return { ok: true, announcement: null };
    }
  });

  ipcMain.handle('saves:capture-url', async (_e, url) => {
    if (blockNewSave('save')) return { ok: false, needsUpgrade: true };
    if (typeof url !== 'string' || !url.trim()) {
      return { ok: false, error: 'missing_url' };
    }
    try {
      const captured = await captureUrl(url.trim());
      if (captured.duplicateOf) {
        notifyDuplicate(captured.existing);
        return { ok: true, record: captured.existing, duplicate: true };
      }
      const record = insertSave({
        ...captured,
        sourceUrl: url.trim(),
        kind: 'url',
      });
      notifySaved(record);
      return { ok: true, record };
    } catch (err) {
      console.error('[saves:capture-url] failed:', err?.message || err);
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('saves:drop-url', async (_e, payload) => {
    if (blockNewSave('save')) return { needsUpgrade: true };
    const candidates = Array.isArray(payload?.urls)
      ? payload.urls
      : Array.isArray(payload)
        ? payload
        : [typeof payload === 'string' ? payload : payload?.url].filter(Boolean);
    if (candidates.length === 0) throw new Error('drop-url called without any URLs');

    // Expand search-engine wrapper URLs (Google /imgres?imgurl=…)
    // ahead of their wrapper so we try the real image URL first.
    // Already done by the renderer's extractDropImageUrls for drops
    // that go through it, but Dock-drop and direct callers don't,
    // and double-unwrapping is harmless because seen prevents dups.
    const expanded = [];
    const seen = new Set();
    for (const c of candidates) {
      const unwrapped = unwrapSearchEngineUrl(c);
      if (unwrapped && !seen.has(unwrapped)) {
        expanded.push(unwrapped);
        seen.add(unwrapped);
      }
      if (!seen.has(c)) {
        expanded.push(c);
        seen.add(c);
      }
    }

    const errors = [];
    let sawHtmlResponse = false;
    for (const url of expanded) {
      try {
        const imgData = await saveImageFromUrl(url);
        if (imgData.duplicateOf) {
          notifyDuplicate(imgData.existing);
          return imgData.existing;
        }
        const record = insertSave(imgData);
        notifySaved(record);
        return record;
      } catch (err) {
        if (/not an image/i.test(String(err?.message || err))) {
          sawHtmlResponse = true;
        }
        errors.push(`${url}: ${err.message}`);
      }
    }

    // Safari drops the surrounding page URL (HTML) rather than the
    // image URL like Chrome does. If every candidate fetched as
    // HTML, fall back to a URL-kind save: screenshot the first
    // candidate page and store it the same way the toolbar
    // "Save URL…" flow does. The result is a save the user can open
    // in the live webview, which is at least as useful as the image
    // they'd have expected.
    if (sawHtmlResponse) {
      const url = candidates[0];
      try {
        console.log('[saves:drop-url] all URLs returned HTML — falling back to URL-kind capture:', url);
        const captured = await captureUrl(url);
        if (captured.duplicateOf) {
          notifyDuplicate(captured.existing);
          return captured.existing;
        }
        const record = insertSave({ ...captured, sourceUrl: url, kind: 'url' });
        notifySaved(record);
        return record;
      } catch (err) {
        errors.push(`${url} (URL-kind fallback): ${err.message}`);
      }
    }

    throw new Error(`All ${candidates.length} URL(s) failed:\n${errors.join('\n')}`);
  });

  ipcMain.handle('collections:get-all', () => getAllCollections());
  ipcMain.handle('collections:get-all-with-thumbs', () => getAllCollectionsWithThumbs());
  ipcMain.handle('collections:get-for-save', (_e, saveId) => getCollectionsForSave(saveId));
  ipcMain.handle('collections:containing-all', (_e, saveIds) => getCollectionsContainingAll(saveIds));
  ipcMain.handle('collections:create', (_e, payload) => createCollection(payload));
  ipcMain.handle('collections:rename', (_e, payload) => renameCollection(payload));
  ipcMain.handle('collections:set-parent', (_e, payload) => setCollectionParent(payload));
  ipcMain.handle('collections:delete', (_e, id) => deleteCollection(id));
  ipcMain.handle('collections:reorder', (_e, ids) => reorderCollections(ids));
  ipcMain.handle('collections:add-save', (_e, payload) => addSaveToCollection(payload));
  ipcMain.handle('collections:remove-save', (_e, payload) => removeSaveFromCollection(payload));

  ipcMain.handle('boards:list', () => listBoards());
  ipcMain.handle('boards:list-with-thumbs', () => listBoardsWithThumbs());
  ipcMain.handle('boards:get', (_e, id) => getBoard(id));
  ipcMain.handle('boards:create', (_e, payload) => createBoard(payload));
  ipcMain.handle('boards:rename', (_e, payload) => renameBoard(payload));
  ipcMain.handle('boards:delete', (_e, id) => deleteBoard(id));
  ipcMain.handle('boards:reorder', (_e, ids) => reorderBoards(ids));
  ipcMain.handle('boards:get-items', (_e, boardId) => getBoardItems(boardId));
  ipcMain.handle('boards:get-preview-saves', (_e, boardId, limit) =>
    getBoardPreviewSaves(boardId, typeof limit === 'number' ? limit : 4),
  );
  ipcMain.handle('boards:get-save-ids', (_e, boardId) => getBoardSaveIds(boardId));
  ipcMain.handle('boards:get-for-save', (_e, saveId) => getBoardsForSave(saveId));
  ipcMain.handle('boards:upsert-item', (_e, payload) => upsertBoardItem(payload));
  ipcMain.handle('boards:bulk-update-items', (_e, payload) => bulkUpdateBoardItems(payload));
  ipcMain.handle('boards:delete-item', (_e, payload) => deleteBoardItem(payload));
  ipcMain.handle('boards:delete-items', (_e, payload) => deleteBoardItems(payload));

  ipcMain.handle('tags:get-all', () => getAllTags());
  ipcMain.handle('tags:get-for-save', (_e, saveId) => getTagsForSave(saveId));
  ipcMain.handle('tags:add-to-save', (_e, payload) => addTagToSave(payload));
  ipcMain.handle('tags:remove-from-save', (_e, payload) => removeTagFromSave(payload));
  ipcMain.handle('tags:rename', (_e, payload) => {
    const { renameTag } = require('./db');
    return renameTag(payload);
  });
  ipcMain.handle('tags:delete', (_e, id) => {
    const { deleteTag } = require('./db');
    return deleteTag(id);
  });
  ipcMain.handle('tags:delete-unused', () => {
    const { deleteUnusedTags } = require('./db');
    return deleteUnusedTags();
  });

  ipcMain.handle('capture:screenshot', () => {
    startScreenshotCapture();
    return { ok: true };
  });

  // Dialog-free Screen Recording status for the onboarding capture
  // step — lets the renderer frame the macOS permission ask up front.
  ipcMain.handle('capture:permission-status', () => {
    const { getScreenPermissionStatus } = require('./capture');
    return getScreenPermissionStatus();
  });

  ipcMain.handle('capture:fullscreen', () => {
    captureFullscreen();
    return { ok: true };
  });

  // Window full-screen toggle, used by the Present button on Spaces.
  // Operates on the focused window (which in normal use is the only
  // BrowserWindow — toast / overlay windows can't take focus).
  ipcMain.handle('window:set-fullscreen', (e, on) => {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return { ok: false };
    win.setFullScreen(!!on);
    return { ok: true, fullscreen: win.isFullScreen() };
  });
  ipcMain.handle('window:toggle-fullscreen', (e) => {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return { ok: false };
    win.setFullScreen(!win.isFullScreen());
    return { ok: true, fullscreen: win.isFullScreen() };
  });
  ipcMain.handle('window:is-fullscreen', (e) => {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return false;
    return win.isFullScreen();
  });
  ipcMain.handle('capture:window', () => {
    captureWindow();
    return { ok: true };
  });

  ipcMain.handle('image:open-in-preview', (_e, filePath) => {
    shell.openPath(filePath);
    return { ok: true };
  });

  // Native macOS Share sheet for a single save. Builds an Electron
  // native menu containing the system share submenu (role:'shareMenu'
  // with sharingItem) and pops it at the cursor. The user gets the
  // standard AirDrop / Messages / Mail / Notes / Photos / Reminders
  // / Add to Reading List etc. options the OS provides for whatever
  // types we hand it.
  ipcMain.handle('share:save', (event, payload = {}) => {
    if (process.platform !== 'darwin') return { ok: false, reason: 'macos_only' };
    const filePath = typeof payload.filePath === 'string' ? payload.filePath : null;
    const sourceUrl = typeof payload.sourceUrl === 'string' ? payload.sourceUrl : null;
    if (!filePath && !sourceUrl) return { ok: false, reason: 'nothing_to_share' };
    const sharingItem = {};
    if (filePath) sharingItem.filePaths = [filePath];
    if (sourceUrl) sharingItem.urls = [sourceUrl];
    const menu = Menu.buildFromTemplate([
      { role: 'shareMenu', label: 'Share', sharingItem },
    ]);
    const win = BrowserWindow.fromWebContents(event.sender) || undefined;
    menu.popup({
      window: win,
      x: typeof payload.x === 'number' ? Math.round(payload.x) : undefined,
      y: typeof payload.y === 'number' ? Math.round(payload.y) : undefined,
    });
    return { ok: true };
  });

  // Write the actual image bytes to the system clipboard so the user
  // can paste into Figma, Slack, Mail, etc. Uses nativeImage rather
  // than a file URL — most apps treat that as a real image paste,
  // not a link. Returns { ok: false } silently on missing files so
  // a stale UI doesn't crash the renderer.
  ipcMain.handle('image:copy-to-clipboard', (_e, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, reason: 'file-missing' };
      }
      const img = nativeImage.createFromPath(filePath);
      if (img.isEmpty()) {
        return { ok: false, reason: 'unreadable' };
      }
      clipboard.writeImage(img);
      return { ok: true };
    } catch (err) {
      console.error('[gatheros] copy-to-clipboard failed:', err);
      return { ok: false, reason: err?.message || String(err) };
    }
  });

  ipcMain.handle('shell:open-url', (_e, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { ok: false, reason: 'invalid-url' };
    }
    shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('image:export', async (e, { filePath, defaultName } = {}) => {
    if (!filePath) return { ok: false, reason: 'no-path' };
    const owner = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showSaveDialog(owner ?? undefined, {
      defaultPath: defaultName || path.basename(filePath),
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      await fs.promises.copyFile(filePath, result.filePath);
      return { ok: true, savedPath: result.filePath };
    } catch (err) {
      console.error('export failed:', err);
      return { ok: false, error: err.message };
    }
  });

  // Bulk file export: pick a folder, copy each selected save's
  // underlying image into it. Names collide with `name (1).png`,
  // `name (2).png`, ... so nothing in the destination gets overwritten.
  ipcMain.handle('saves:export-bulk', async (e, ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return { ok: false, reason: 'no-ids' };
    const records = ids.map(getSave).filter(Boolean);
    if (records.length === 0) return { ok: false, reason: 'no-saves' };

    const owner = BrowserWindow.fromWebContents(e.sender);
    const dlg = await dialog.showOpenDialog(owner ?? undefined, {
      title: 'Export images to…',
      buttonLabel: 'Export',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (dlg.canceled || !dlg.filePaths?.[0]) return { ok: false, canceled: true };
    const targetDir = dlg.filePaths[0];

    const fileExists = async (p) => {
      try { await fs.promises.access(p); return true; } catch { return false; }
    };
    const safeName = (s) => (s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'image';

    let count = 0;
    for (const r of records) {
      if (!r.file_path) continue;
      const ext = (path.extname(r.file_path) || '.png');
      const stem = safeName(r.title) || safeName(path.basename(r.file_path, path.extname(r.file_path)));
      let candidate = path.join(targetDir, `${stem}${ext}`);
      let n = 1;
      while (await fileExists(candidate)) {
        candidate = path.join(targetDir, `${stem} (${n})${ext}`);
        n++;
      }
      try {
        await fs.promises.copyFile(r.file_path, candidate);
        count++;
      } catch (err) {
        console.error('Bulk export failed for', r.id, err);
      }
    }
    return { ok: true, count, targetDir };
  });

  // Same as saves:export-bulk but bundles into a single zip instead of
  // copying loose files. Uses macOS's `zip` CLI with -j so the archive
  // is flat (no source paths) and -X to drop extra macOS attrs.
  ipcMain.handle('saves:export-bulk-zip', async (e, ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return { ok: false, reason: 'no-ids' };
    const records = ids.map(getSave).filter(Boolean);
    if (records.length === 0) return { ok: false, reason: 'no-saves' };

    const owner = BrowserWindow.fromWebContents(e.sender);
    const stamp = new Date().toISOString().slice(0, 10);
    const dlg = await dialog.showSaveDialog(owner ?? undefined, {
      title: 'Export selection as zip',
      buttonLabel: 'Export',
      defaultPath: `moodmark-export-${stamp}.zip`,
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (dlg.canceled || !dlg.filePath) return { ok: false, canceled: true };

    // Stage in a temp dir so we control filenames and dedupe
    // collisions before handing them to `zip`.
    const tmpDir = await fs.promises.mkdtemp(path.join(require('os').tmpdir(), 'moodmark-export-'));
    const safeName = (s) => (s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'image';

    let count = 0;
    try {
      for (const r of records) {
        if (!r.file_path) continue;
        const ext = (path.extname(r.file_path) || '.png');
        const stem = safeName(r.title) || safeName(path.basename(r.file_path, path.extname(r.file_path)));
        let candidate = path.join(tmpDir, `${stem}${ext}`);
        let n = 1;
        while (fs.existsSync(candidate)) {
          candidate = path.join(tmpDir, `${stem} (${n})${ext}`);
          n++;
        }
        await fs.promises.copyFile(r.file_path, candidate);
        count++;
      }
      const result = await new Promise((resolve) => {
        const args = ['-jXq', dlg.filePath, ...fs.readdirSync(tmpDir).map((f) => path.join(tmpDir, f))];
        const proc = spawn('zip', args);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          if (code === 0) resolve({ ok: true, savedPath: dlg.filePath, count });
          else resolve({ ok: false, error: `zip exited with code ${code}: ${stderr.trim()}` });
        });
        proc.on('error', (err) => resolve({ ok: false, error: err.message }));
      });
      return result;
    } finally {
      // Best-effort cleanup of the staging dir.
      try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  // Local DB-only backup snapshots. Powers Settings → Data → Backups.
  ipcMain.handle('backup:list', () => {
    const { listSnapshots } = require('./backup');
    return listSnapshots();
  });
  ipcMain.handle('backup:snapshot', () => {
    const { snapshotLibraryDb } = require('./backup');
    return snapshotLibraryDb();
  });
  ipcMain.handle('backup:restore', (_e, snapshotPath) => {
    const { restoreFromSnapshot } = require('./backup');
    const result = restoreFromSnapshot(snapshotPath);
    if (result?.ok) {
      // Same renderer-refresh handshake we use for library:switch —
      // every cached collection / save needs to refetch from the
      // rolled-back DB.
      try {
        const { BrowserWindow } = require('electron');
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('library:switched', { reason: 'restore' });
          }
        }
      } catch {}
    }
    return result;
  });

  // Full library backup as a single .zip — includes the SQLite DB,
  // images/, and thumbs/. Uses the macOS `zip` CLI (built in) so no
  // new node deps. Returns { ok, savedPath, count? } or { canceled }.
  ipcMain.handle('library:export-zip', async (e) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    const stamp = new Date().toISOString().slice(0, 10);
    const dlg = await dialog.showSaveDialog(owner ?? undefined, {
      title: 'Export GatherOS library',
      buttonLabel: 'Export',
      defaultPath: `moodmark-backup-${stamp}.zip`,
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (dlg.canceled || !dlg.filePath) return { ok: false, canceled: true };

    // Flush the WAL into the main db file so the zipped moodmark.db is a
    // complete, self-consistent snapshot (writes can live in -wal until a
    // checkpoint). Best-effort — we still include the sidecars below.
    try {
      const { getDatabase } = require('./db');
      getDatabase().pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      console.warn('[export-zip] wal checkpoint failed (continuing):', err?.message || err);
    }

    // The library lives under its own root now —
    // userData/libraries/library_<id>/{moodmark.db,images,thumbs} — not
    // the userData root (that's why this used to find nothing and bail).
    const { getActiveLibraryRoot } = require('./library-registry');
    const libRoot = getActiveLibraryRoot();
    if (!libRoot) return { ok: false, reason: 'no-active-library' };
    // Whitelist what we ship; include the db sidecars so the restore is
    // consistent even if the checkpoint above couldn't run.
    const includes = ['moodmark.db', 'moodmark.db-wal', 'moodmark.db-shm', 'images', 'thumbs'];
    const present = includes.filter((p) => fs.existsSync(path.join(libRoot, p)));
    if (!present.includes('moodmark.db')) return { ok: false, reason: 'nothing-to-export' };

    return new Promise((resolve) => {
      // -r recursive, -X drop extra macOS attrs, -q quiet.
      const args = ['-rXq', dlg.filePath, ...present, '-x', '*.DS_Store'];
      const proc = spawn('zip', args, { cwd: libRoot });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve({ ok: true, savedPath: dlg.filePath });
        else resolve({ ok: false, error: `zip exited with code ${code}: ${stderr.trim()}` });
      });
      proc.on('error', (err) => resolve({ ok: false, error: err.message }));
    });
  });

  // Triggered by the in-app "Restart to update" pill. Closes the
  // window cleanly and relaunches into the freshly-installed version.
  ipcMain.handle('updater:install', () => {
    quitAndInstall();
    return { ok: true };
  });

  // Nuclear "Erase Library" — guarded by a native confirm dialog
  // because there's no undo. Wipes every save / bucket / tag, then
  // unlinks the underlying image and thumbnail files off disk.
  ipcMain.handle('library:wipe-all', async (e) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    const dlg = await dialog.showMessageBox(owner ?? undefined, {
      type: 'warning',
      buttons: ['Cancel', 'Erase Library'],
      defaultId: 0,
      cancelId: 0,
      title: 'Erase Library',
      message: 'Erase your entire library?',
      detail: 'Every save, bucket, and tag will be permanently deleted. This cannot be undone.',
    });
    if (dlg.response !== 1) return { ok: false, canceled: true };
    const result = wipeLibrary();
    for (const f of result.files) deleteImageFiles(f.filePath, f.thumbPath);
    return { ok: true, removed: result.files.length };
  });

  // PNG snapshot of the current board view. Renderer measures the
  // canvas DOM rect (with the user's current pan/zoom + items in
  // view) and hands us those coords; we pass them to capturePage so
  // chrome (toolbar / sidebar / detail panel) is excluded.
  ipcMain.handle('boards:export-png', async (event, payload = {}) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) return { ok: false, reason: 'no_window' };
    const { rect, defaultName } = payload;
    if (!rect || typeof rect.width !== 'number' || typeof rect.height !== 'number') {
      return { ok: false, reason: 'no_rect' };
    }

    const dlg = await dialog.showSaveDialog(owner, {
      title: 'Export board as PNG',
      buttonLabel: 'Export',
      defaultPath: defaultName || 'board.png',
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (dlg.canceled || !dlg.filePath) return { ok: false, canceled: true };

    try {
      const image = await event.sender.capturePage({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      await fs.promises.writeFile(dlg.filePath, image.toPNG());
      return { ok: true, savedPath: dlg.filePath };
    } catch (err) {
      console.error('[boards:export-png] failed:', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('boards:export', async (e, saveIds) => {
    if (!Array.isArray(saveIds) || saveIds.length === 0) {
      return { ok: false, reason: 'no-ids' };
    }
    const saves = saveIds.map(getSave).filter(Boolean);
    if (saves.length === 0) return { ok: false, reason: 'no-saves' };

    const owner = BrowserWindow.fromWebContents(e.sender);
    const stamp = new Date().toISOString().slice(0, 10);
    const dialogResult = await dialog.showSaveDialog(owner ?? undefined, {
      defaultPath: `moodmark-board-${stamp}.gif`,
      filters: [{ name: 'Animated GIF', extensions: ['gif'] }],
    });
    if (dialogResult.canceled || !dialogResult.filePath) {
      return { ok: false, canceled: true };
    }
    try {
      const meta = await composeMoodBoardGif(saves, dialogResult.filePath);
      // Pop the file in Finder so the user can immediately see / drag it.
      shell.showItemInFolder(dialogResult.filePath);
      return { ok: true, savedPath: dialogResult.filePath, ...meta };
    } catch (err) {
      console.error('Board export failed:', err);
      return { ok: false, error: err.message };
    }
  });

  // ── AI entitlement + monthly usage ────────────────────────────────────
  // BYOK was retired — the licensing Worker proxies OpenAI calls on
  // behalf of any signed-in user. The renderer just needs to know
  // whether a session is present and what the monthly counter looks
  // like so it can show "AI features unlocked" + remaining quota.
  ipcMain.handle('ai:has-session', () => hasAiSession());

  ipcMain.handle('ai:usage', async () => {
    const usage = await getAiUsage();
    return usage || { ok: false };
  });

  ipcMain.handle('settings:get-prefs', () => settings.getPrefs());

  ipcMain.handle('settings:set-pref', (_e, payload = {}) => {
    if (!payload.name) return { ok: false, reason: 'no-name' };
    const result = settings.setPref(payload.name, payload.value);
    // Side-effects: a couple of prefs need to push their new value to
    // wherever it's consumed in the main process (the renderer's
    // pref read happens on next mount, which is fine for everything
    // else).
    try {
      if (payload.name === 'captureShortcut') {
        const capture = require('./capture');
        capture.applyShortcut?.(payload.value);
      } else if (payload.name === 'updatesAuto' || payload.name === 'updatesChannel') {
        const updater = require('./updater');
        updater.applyPrefs?.();
      }
    } catch (err) {
      console.warn('[settings] pref side-effect failed:', err.message);
    }
    return result;
  });

  // Native folder picker — used by the Capture settings page to set
  // the drop-folder where screenshots also land as files.
  ipcMain.handle('settings:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Choose folder',
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return { path: result.filePaths[0] };
  });

  // Manual "Check for updates" trigger from the Updates settings page.
  // Returns a coarse status so the UI can show feedback immediately
  // (background download events come through the existing update-ready
  // / update-error channels).
  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) return { unsupported: true };
    try {
      const updater = require('./updater');
      return await updater.checkNow();
    } catch (err) {
      return { error: err?.message || String(err) };
    }
  });

  // ── AI: auto-tag a save ─────────────────────────────────────────────────
  ipcMain.handle('ai:unindexed-count', () => getUnindexedCount());

  // Returns up to `limit` saves visually most similar to `saveId`,
  // ranked by cosine over their existing embeddings. No-op (returns
  // []) if the anchor itself isn't indexed yet — calling code can
  // skip rendering the section in that case. Trashed saves are
  // filtered out so the user doesn't get suggestions from the bin.
  // Right-click "Find similar" — works without an OpenAI key. Tries
  // embedding cosine similarity first when both the anchor and at
  // least one other save have embeddings; otherwise falls back to
  // palette ΔE distance over the swatches we already extract on save.
  // Returns full save records sorted by similarity, anchor excluded.
  ipcMain.handle('saves:find-similar', (_e, saveId, limit = 24) => {
    if (!saveId) return [];
    const cap = Math.max(1, Math.min(Number(limit) || 24, 60));

    const rows = getSaveEmbeddingsCached();
    const anchor = rows.find((r) => r.id === saveId);
    if (anchor && rows.length >= 2) {
      const scored = rows
        .filter((r) => r.id !== saveId)
        .map(({ id, vec }) => ({ id, score: dotSim(anchor.vec, vec) }))
        .filter((r) => r.score >= 0.30)
        .sort((a, b) => b.score - a.score)
        .slice(0, cap);
      if (scored.length > 0) {
        const ids = scored.map((s) => s.id);
        const records = getSavesByIds(ids).filter((r) => !r.deleted_at);
        const orderById = new Map(ids.map((id, i) => [id, i]));
        records.sort((a, b) => orderById.get(a.id) - orderById.get(b.id));
        return records;
      }
    }

    // Embedding path empty (no key, no anchor embedding, or below
    // the relevance cutoff) — fall back to the palette path.
    return findSimilarByPalette(saveId, cap);
  });

  ipcMain.handle('ai:similar-saves', (_e, saveId, limit = 5) => {
    if (!saveId) return [];
    const rows = getSaveEmbeddingsCached();
    const anchor = rows.find((r) => r.id === saveId);
    if (!anchor) return [];
    const scored = rows
      .filter((r) => r.id !== saveId)
      .map(({ id, vec }) => ({ id, score: dotSim(anchor.vec, vec) }))
      // 0.30 cutoff — below that the suggestions read as random,
      // and the calling UI is happier rendering nothing than a row
      // of unrelated thumbs.
      .filter((r) => r.score >= 0.30)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 12)));
    if (scored.length === 0) return [];
    const ids = scored.map((s) => s.id);
    const records = getSavesByIds(ids).filter((r) => !r.deleted_at);
    const orderById = new Map(ids.map((id, i) => [id, i]));
    records.sort((a, b) => orderById.get(a.id) - orderById.get(b.id));
    return records;
  });

  // Backfill: process every save that has no embedding yet through the
  // analyze + embed pipeline. Emits ai:reindex-progress events so the
  // UI can show "Indexing N of M" in real time. Sequential to keep
  // memory bounded and to be polite to the API.
  // Settings → Storage. Usage readout + the opt-in reclaim sweep.
  ipcMain.handle('storage:get-usage', () => getStorageUsage());
  ipcMain.handle('storage:reclaim', async (event) =>
    reclaimLibraryStorage({
      onProgress: (p) => event.sender.send('storage:reclaim-progress', p),
      // Patch each repointed save into the live grid so a reclaimed
      // image opens from its new path without a full reload.
      onUpdated: (rec) => { if (rec) event.sender.send('save:updated', rec); },
    }),
  );

  ipcMain.handle('ai:reindex-library', async (event) => {
    if (!hasAiSession()) return { ok: false, reason: 'no-session' };
    const targets = getUnindexedSaves();
    const total = targets.length;

    let processed = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i += 1) {
      const row = targets[i];
      event.sender.send('save:indexing-start', row.id);
      try {
        const { title, description, text } = await analyzeImage(row.file_path);
        const updates = { id: row.id };
        if (description) updates.aiDescription = description;
        // Always set ocr_text (empty string for no text) so the
        // unindexed sweep stops picking the row up.
        updates.ocrText = text || '';
        // Don't overwrite a title the user already supplied.
        if (title && !row.title) updates.title = title;

        const tags = getTagsForSave(row.id).map((t) => t.name).join(', ');
        const ocrSnippet = text ? text.slice(0, 300) : '';
        const embedSource = [title, description, ocrSnippet, tags].filter(Boolean).join('. ');
        if (embedSource) {
          const vec = await embedText(embedSource);
          updates.embedding = Buffer.from(new Float32Array(vec).buffer);
        }

        if (Object.keys(updates).length > 1) {
          updateSave(updates);
          const updated = getSave(row.id);
          event.sender.send('save:updated', updated);
        }
        processed += 1;
      } catch (err) {
        console.error('Reindex failed for save', row.id, '-', err.message);
        failed += 1;
      } finally {
        event.sender.send('save:indexing-end', row.id);
      }
      event.sender.send('ai:reindex-progress', {
        processed: i + 1,
        total,
        failed,
      });
    }
    return { ok: true, processed, failed, total };
  });

  // Generate an image-generation prompt (Midjourney / DALL-E / SD)
  // that recreates the focused save. Persists onto saves.ai_prompt and
  // emits save:updated so the renderer's local copy patches in place.
  ipcMain.handle('ai:generate-prompt', async (event, saveId) => {
    if (!saveId) return { ok: false, reason: 'no-save-id' };
    if (!hasAiSession()) return { ok: false, reason: 'no-session' };
    const save = getSave(saveId);
    if (!save) return { ok: false, reason: 'save-not-found' };

    event.sender.send('save:indexing-start', saveId);
    try {
      const prompt = await generateImagePrompt(save.file_path);
      if (!prompt) return { ok: false, reason: 'empty-response' };
      updateSave({ id: saveId, aiPrompt: prompt });
      const updated = getSave(saveId);
      event.sender.send('save:updated', updated);
      return { ok: true, prompt };
    } catch (err) {
      console.error('Generate prompt failed:', err.message);
      return { ok: false, reason: err.code || "api-error", detail: err.message };
    } finally {
      event.sender.send('save:indexing-end', saveId);
    }
  });


  ipcMain.handle('ai:auto-tag', async (_e, saveId) => {
    if (!saveId) return { ok: false, reason: 'no-save-id' };
    if (!hasAiSession()) return { ok: false, reason: 'no-session' };
    const save = getSave(saveId);
    if (!save) return { ok: false, reason: 'save-not-found' };
    try {
      const tags = await autoTagImage(save.file_path);
      // Persist via the existing tag pipeline so dedupe + creation
      // semantics match the manual flow.
      const added = [];
      for (const name of tags) {
        const result = addTagToSave({ saveId, name });
        if (result.ok && result.tag) added.push(result.tag);
      }
      return { ok: true, tags: added };
    } catch (err) {
      console.error('Auto-tag failed:', err.message);
      return { ok: false, reason: err.code || "api-error", detail: err.message };
    }
  });

  // Drag-out: forwards from a renderer dragstart into the OS drag layer
  // via webContents.startDrag. macOS requires a non-empty icon, so we
  // build one from the thumb (or fall back to the source file) and
  // resize it to a reasonable drag-icon size.
  ipcMain.on('drag:start', (event, payload = {}) => {
    const files = Array.isArray(payload.files) ? payload.files.filter(Boolean) : [];
    if (files.length === 0) return;

    let icon = null;
    try {
      const iconSource = payload.thumbPath || files[0];
      const img = nativeImage.createFromPath(iconSource);
      if (!img.isEmpty()) {
        icon = img.resize({ width: 80, quality: 'best' });
      } else {
        // Thumb missing/unreadable — fall back to the original file.
        const fallback = nativeImage.createFromPath(files[0]);
        if (!fallback.isEmpty()) icon = fallback.resize({ width: 80, quality: 'best' });
      }
    } catch (err) {
      console.error('Drag icon load failed:', err);
    }
    if (!icon) icon = nativeImage.createEmpty();

    try {
      if (files.length === 1) {
        event.sender.startDrag({ file: files[0], icon });
      } else {
        event.sender.startDrag({ files, icon });
      }
    } catch (err) {
      console.error('startDrag failed:', err);
    }
  });

  ipcMain.on('toast:set-interactive', (_e, interactive) => {
    setToastInteractive(!!interactive);
  });

  ipcMain.on('toast:empty', () => {
    onToastsEmpty();
  });

  // Undo from the save toast — soft-delete the records that were just
  // saved in this toast session. Mirrors saves:delete (Trash, not a
  // hard delete; files stay on disk) and broadcasts so the open grid
  // drops the cards immediately.
  ipcMain.handle('toast:undo-saves', (_e, ids) => {
    const list = Array.isArray(ids) ? ids.filter((id) => id != null) : [];
    const removed = [];
    for (const id of list) {
      try {
        if (deleteSave(id)?.ok) removed.push(id);
      } catch (err) {
        console.error('[gatheros] toast undo failed for', id, err);
      }
    }
    if (removed.length) broadcastSavesDeleted(removed);
    refreshTray();
    return { ok: true, count: removed.length };
  });

  // ─── Licensing ──────────────────────────────────────────────
  // Renderer asks for the entitlement state on launch + on every
  // window focus; main process owns the session token + cache.
  const licensing = require('./licensing');
  ipcMain.handle('licensing:request-magic-link', (_e, email) =>
    licensing.requestMagicLink(email),
  );
  ipcMain.handle('licensing:verify', (_e, opts) =>
    licensing.verifyLicense(opts || {}),
  );
  ipcMain.handle('licensing:has-session', () => licensing.hasSession());
  ipcMain.handle('licensing:sign-out', () => licensing.signOut());

  // Exchange a magic-link token directly for a session. The gatheros://
  // deep link only resolves in the packaged app (its Info.plist registers
  // the scheme), so under `npm run dev` the email link goes nowhere —
  // paste the token here from DevTools instead:
  //   await window.moodmark.licensing.exchange("<token-from-the-email-link>")
  // Persists the session and fires the same auth-result the deep-link
  // handler does, so the UI signs in. Harmless in production: it still
  // requires a valid, single-use token only the user's email provides.
  ipcMain.handle('licensing:exchange', async (e, token) => {
    const result = await licensing.exchangeMagicToken(token);
    try { e.sender.send('licensing:auth-result', result); } catch { /* ignore */ }
    return result;
  });

  // Combined entitlement (local trial + server subscription) the renderer
  // uses to show the trial countdown / free-tier meter and to know when to
  // surface upgrade prompts.
  ipcMain.handle('entitlement:get', () => require('./entitlement').getEntitlement());
  // Mints a customer-portal URL and opens it in the user's default
  // browser. Renderer doesn't need to handle the URL itself — we open
  // it in main so the user lands on the secure session without us
  // ever exposing the URL to the page context.
  ipcMain.handle('licensing:open-customer-portal', async () => {
    const result = await licensing.customerPortal();
    if (result?.ok && result.url) {
      try { await shell.openExternal(result.url); } catch (err) {
        return { ok: false, error: 'open_failed' };
      }
      return { ok: true };
    }
    return { ok: false, error: result?.error || 'unknown' };
  });
  // Mints a Lemon Squeezy checkout URL for the chosen plan and opens
  // it externally. The same shell.openExternal pattern works on both
  // localhost dev (renderer talks to our worker) and the packaged
  // file:// app (no domain-whitelist gymnastics).
  ipcMain.handle('licensing:open-checkout', async (_e, plan) => {
    const result = await licensing.createCheckout(plan);
    if (result?.ok && result.url) {
      try { await shell.openExternal(result.url); } catch (err) {
        return { ok: false, error: 'open_failed' };
      }
      return { ok: true };
    }
    return { ok: false, error: result?.error || 'unknown' };
  });
}

module.exports = { registerIpcHandlers };
