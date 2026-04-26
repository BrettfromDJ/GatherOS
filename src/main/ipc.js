const { ipcMain, shell, dialog, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  getAllSaves, getSave, deleteSave, updateSave, insertSave,
  getSaveEmbeddings, getSavesByIds,
  getAllCollections, getCollectionsForSave, createCollection, renameCollection,
  deleteCollection, reorderCollections, addSaveToCollection, removeSaveFromCollection,
  getAllTags, getTagsForSave, addTagToSave, removeTagFromSave,
} = require('./db');
const {
  deleteImageFiles,
  saveImageFromFile,
  saveImageFromUrl,
  composeMoodBoard,
} = require('./storage');
const {
  handleOverlayComplete,
  handleOverlayCancel,
  startScreenshotCapture,
} = require('./capture');
const { notifySaved } = require('./notify');
const { setToastInteractive, onToastsEmpty } = require('./toast-window');
const settings = require('./settings');
const { testApiKey, autoTagImage, embedText } = require('./openai');

// Cosine similarity over Float32 BLOBs from SQLite. ~1 ms per save at
// 1536 dims; fine up to a few thousand records before we'd want a
// proper vector index.
function cosineSim(a, b, len) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function bufferToFloat32(buf) {
  // SQLite returns a Buffer; reinterpret as Float32Array without copying.
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function registerIpcHandlers() {
  ipcMain.handle('saves:get-all', async (_e, opts = {}) => {
    const semanticEnabled = settings.getPref('semanticSearch', false);
    const haveKey = settings.hasOpenAIKey();
    const queryText = (opts.search || '').trim();

    // Falls back to the regular LIKE path if semantic search isn't
    // configured, isn't on, or there's no actual query to embed.
    if (!semanticEnabled || !haveKey || !queryText) {
      return getAllSaves(opts);
    }

    try {
      const queryVec = await embedText(settings.getOpenAIKey(), queryText);
      const queryF32 = new Float32Array(queryVec);
      const dim = queryF32.length;

      // Cosine threshold tuned for text-embedding-3-small with the
      // image-description prompts produced by analyzeImage. Below ~0.30
      // results read as "noise" — keeps the search bar from returning
      // every embedded save when the query only matches a handful well.
      const MIN_SCORE = 0.3;
      // Plus a relative cap: drop anything below 55% of the top score so
      // a strong match doesn't drag along marginal ones.
      const RELATIVE_CUTOFF = 0.55;

      const rows = getSaveEmbeddings();
      const scored = rows
        .map((row) => {
          const v = bufferToFloat32(row.embedding);
          return { id: row.id, score: cosineSim(queryF32, v, dim) };
        })
        .filter((r) => r.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) return [];

      const relativeFloor = scored[0].score * RELATIVE_CUTOFF;
      const ranked = scored.filter((r) => r.score >= relativeFloor);

      const topIds = ranked.slice(0, 80).map((r) => r.id);
      const candidates = getSavesByIds(topIds);
      const orderById = new Map(topIds.map((id, i) => [id, i]));
      candidates.sort((a, b) => orderById.get(a.id) - orderById.get(b.id));

      // Apply the same filters as the LIKE path so view/collection
      // toggles still work in semantic mode.
      const filter = opts.filter || 'all';
      const collectionId = opts.collectionId || null;
      const collectionMembers = collectionId
        ? new Set(
            getAllSaves({ collectionId }).map((s) => s.id),
          )
        : null;
      const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

      return candidates.filter((s) => {
        if (filter === 'favorites' && !s.favorited) return false;
        if (filter === 'recent' && s.created_at <= recentCutoff) return false;
        if (collectionId && !collectionMembers.has(s.id)) return false;
        return true;
      });
    } catch (err) {
      console.error('Semantic search failed, falling back to LIKE:', err.message);
      return getAllSaves(opts);
    }
  });

  ipcMain.handle('saves:delete', (_e, id) => {
    const result = deleteSave(id);
    if (result.ok) deleteImageFiles(result.filePath, result.thumbPath);
    return result;
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
    const imgData = await saveImageFromFile(filePath);
    const record = insertSave(imgData);
    notifySaved(record);
    return record;
  });

  ipcMain.handle('saves:drop-url', async (_e, payload) => {
    const candidates = Array.isArray(payload?.urls)
      ? payload.urls
      : Array.isArray(payload)
        ? payload
        : [typeof payload === 'string' ? payload : payload?.url].filter(Boolean);
    if (candidates.length === 0) throw new Error('drop-url called without any URLs');

    const errors = [];
    for (const url of candidates) {
      try {
        const imgData = await saveImageFromUrl(url);
        const record = insertSave(imgData);
        notifySaved(record);
        return record;
      } catch (err) {
        errors.push(`${url}: ${err.message}`);
      }
    }
    throw new Error(`All ${candidates.length} URL(s) failed:\n${errors.join('\n')}`);
  });

  ipcMain.handle('collections:get-all', () => getAllCollections());
  ipcMain.handle('collections:get-for-save', (_e, saveId) => getCollectionsForSave(saveId));
  ipcMain.handle('collections:create', (_e, payload) => createCollection(payload));
  ipcMain.handle('collections:rename', (_e, payload) => renameCollection(payload));
  ipcMain.handle('collections:delete', (_e, id) => deleteCollection(id));
  ipcMain.handle('collections:reorder', (_e, ids) => reorderCollections(ids));
  ipcMain.handle('collections:add-save', (_e, payload) => addSaveToCollection(payload));
  ipcMain.handle('collections:remove-save', (_e, payload) => removeSaveFromCollection(payload));

  ipcMain.handle('tags:get-all', () => getAllTags());
  ipcMain.handle('tags:get-for-save', (_e, saveId) => getTagsForSave(saveId));
  ipcMain.handle('tags:add-to-save', (_e, payload) => addTagToSave(payload));
  ipcMain.handle('tags:remove-from-save', (_e, payload) => removeTagFromSave(payload));

  ipcMain.handle('capture:screenshot', () => {
    startScreenshotCapture();
    return { ok: true };
  });

  ipcMain.handle('overlay:complete', (_e, payload) => {
    handleOverlayComplete(payload);
    return { ok: true };
  });

  ipcMain.handle('overlay:cancel', () => {
    handleOverlayCancel();
    return { ok: true };
  });

  ipcMain.handle('image:open-in-preview', (_e, filePath) => {
    shell.openPath(filePath);
    return { ok: true };
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

  ipcMain.handle('boards:export', async (e, saveIds) => {
    if (!Array.isArray(saveIds) || saveIds.length === 0) {
      return { ok: false, reason: 'no-ids' };
    }
    const saves = saveIds.map(getSave).filter(Boolean);
    if (saves.length === 0) return { ok: false, reason: 'no-saves' };

    const owner = BrowserWindow.fromWebContents(e.sender);
    const stamp = new Date().toISOString().slice(0, 10);
    const dialogResult = await dialog.showSaveDialog(owner ?? undefined, {
      defaultPath: `moodmark-board-${stamp}.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (dialogResult.canceled || !dialogResult.filePath) {
      return { ok: false, canceled: true };
    }
    try {
      const meta = await composeMoodBoard(saves, dialogResult.filePath);
      // Pop the file in Finder so the user can immediately see / drag it.
      shell.showItemInFolder(dialogResult.filePath);
      return { ok: true, savedPath: dialogResult.filePath, ...meta };
    } catch (err) {
      console.error('Board export failed:', err);
      return { ok: false, error: err.message };
    }
  });

  // ── Settings: BYOK OpenAI key ──────────────────────────────────────────
  // The plaintext key never crosses IPC outbound — the renderer can only
  // ask whether one is configured, set a new one, clear it, or test it.
  ipcMain.handle('settings:has-openai-key', () => settings.hasOpenAIKey());

  ipcMain.handle('settings:set-openai-key', async (_e, key) => {
    if (typeof key !== 'string' || !/^sk-/.test(key.trim())) {
      return { ok: false, reason: 'invalid-format' };
    }
    // Test before persisting — refuse a key that doesn't authenticate.
    const test = await testApiKey(key.trim());
    if (!test.ok) return { ok: false, reason: test.reason || 'test-failed' };
    return settings.setOpenAIKey(key);
  });

  ipcMain.handle('settings:clear-openai-key', () => settings.clearOpenAIKey());

  ipcMain.handle('settings:test-openai-key', async () => {
    const key = settings.getOpenAIKey();
    if (!key) return { ok: false, reason: 'no-key' };
    return testApiKey(key);
  });

  ipcMain.handle('settings:get-prefs', () => settings.getPrefs());

  ipcMain.handle('settings:set-pref', (_e, payload = {}) => {
    if (!payload.name) return { ok: false, reason: 'no-name' };
    return settings.setPref(payload.name, payload.value);
  });

  // ── AI: auto-tag a save ─────────────────────────────────────────────────
  ipcMain.handle('ai:auto-tag', async (_e, saveId) => {
    if (!saveId) return { ok: false, reason: 'no-save-id' };
    const key = settings.getOpenAIKey();
    if (!key) return { ok: false, reason: 'no-key' };
    const save = getSave(saveId);
    if (!save) return { ok: false, reason: 'save-not-found' };
    try {
      const tags = await autoTagImage(key, save.file_path);
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
      return { ok: false, reason: 'api-error', detail: err.message };
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
}

module.exports = { registerIpcHandlers };
