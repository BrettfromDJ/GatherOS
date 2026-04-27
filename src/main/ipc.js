const { ipcMain, shell, dialog, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {
  getAllSaves, getSave, deleteSave, updateSave, insertSave,
  getSaveEmbeddings, getSavesByIds, getUnindexedSaves, getUnindexedCount,
  filterByColor,
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
const {
  testApiKey, autoTagImage, analyzeImage, embedText, generateImagePrompt,
} = require('./openai');
const { detectColorName } = require('./colorNames');

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
  // Merges saves whose extracted palette is perceptually similar to a
  // named color in the query (e.g. "orange", "navy") into the existing
  // result set. Same view filters (favorites/recent/collection/explicit
  // colorHex) get applied so semantic + LIKE + name-color-match all
  // honor the active context.
  function mergeColorNameMatches(results, opts, queryText) {
    const detectedHex = detectColorName(queryText);
    if (!detectedHex) return results;
    // Get every save that already passes the user's other filters
    // (LIKE-irrelevant pieces of the query stripped out — we only want
    // the view scoping here, not text matching).
    const filteredSet = getAllSaves({
      filter: opts.filter,
      collectionId: opts.collectionId,
      colorHex: opts.colorHex || undefined,
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
    const semanticEnabled = settings.getPref('semanticSearch', false);
    const haveKey = settings.hasOpenAIKey();
    const queryText = (opts.search || '').trim();

    // Falls back to the regular LIKE path if semantic search isn't
    // configured, isn't on, or there's no actual query to embed.
    if (!semanticEnabled || !haveKey || !queryText) {
      return mergeColorNameMatches(getAllSaves(opts), opts, queryText);
    }

    try {
      const apiKey = settings.getOpenAIKey();
      // Single embedding call drives the cosine ranker. Query
      // expansion + LLM rerank were tried but each added 500-1500 ms
      // of latency to a search bar that needs to feel near-instant.
      // The hybrid LIKE pass below is the recall safety net for
      // narrow queries; threshold + relative cap below is the
      // precision filter.
      const queryVec = await embedText(apiKey, queryText);
      const queryF32 = new Float32Array(queryVec);
      const dim = queryF32.length;

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

      const rows = getSaveEmbeddings();
      const scored = rows
        .map((row) => {
          const v = bufferToFloat32(row.embedding);
          return { id: row.id, score: cosineSim(queryF32, v, dim) };
        })
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

      // Apply the same filters as the LIKE path so view/collection
      // toggles still work in semantic mode. (LIKE matches are already
      // filtered, but semantic candidates aren't.)
      const filter = opts.filter || 'all';
      const collectionId = opts.collectionId || null;
      const collectionMembers = collectionId
        ? new Set(
            getAllSaves({ collectionId }).map((s) => s.id),
          )
        : null;
      const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

      let filtered = merged.filter((s) => {
        if (filter === 'favorites' && !s.favorited) return false;
        if (filter === 'recent' && s.created_at <= recentCutoff) return false;
        if (collectionId && !collectionMembers.has(s.id)) return false;
        return true;
      });
      // Apply the color filter to semantic candidates too — getAllSaves
      // already handled it for the LIKE matches, but the embedding-only
      // hits never went through it.
      if (opts.colorHex) {
        filtered = filterByColor(filtered, opts.colorHex);
      }
      return mergeColorNameMatches(filtered, opts, queryText);
    } catch (err) {
      console.error('Semantic search failed, falling back to LIKE:', err.message);
      return mergeColorNameMatches(getAllSaves(opts), opts, queryText);
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
  ipcMain.handle('ai:unindexed-count', () => getUnindexedCount());

  // Backfill: process every save that has no embedding yet through the
  // analyze + embed pipeline. Emits ai:reindex-progress events so the
  // UI can show "Indexing N of M" in real time. Sequential to keep
  // memory bounded and to be polite to the API.
  ipcMain.handle('ai:reindex-library', async (event) => {
    if (!settings.hasOpenAIKey()) return { ok: false, reason: 'no-key' };
    const key = settings.getOpenAIKey();
    const targets = getUnindexedSaves();
    const total = targets.length;

    let processed = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i += 1) {
      const row = targets[i];
      event.sender.send('save:indexing-start', row.id);
      try {
        const { title, description, text } = await analyzeImage(key, row.file_path);
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
          const vec = await embedText(key, embedSource);
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
    if (!settings.hasOpenAIKey()) return { ok: false, reason: 'no-key' };
    const save = getSave(saveId);
    if (!save) return { ok: false, reason: 'save-not-found' };

    event.sender.send('save:indexing-start', saveId);
    try {
      const prompt = await generateImagePrompt(settings.getOpenAIKey(), save.file_path);
      if (!prompt) return { ok: false, reason: 'empty-response' };
      updateSave({ id: saveId, aiPrompt: prompt });
      const updated = getSave(saveId);
      event.sender.send('save:updated', updated);
      return { ok: true, prompt };
    } catch (err) {
      console.error('Generate prompt failed:', err.message);
      return { ok: false, reason: 'api-error', detail: err.message };
    } finally {
      event.sender.send('save:indexing-end', saveId);
    }
  });

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
