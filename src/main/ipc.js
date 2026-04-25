const { ipcMain, shell, dialog, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { getAllSaves, deleteSave, updateSave, insertSave } = require('./db');
const {
  deleteImageFiles,
  saveImageFromFile,
  saveImageFromUrl,
} = require('./storage');
const {
  handleOverlayComplete,
  handleOverlayCancel,
  startScreenshotCapture,
} = require('./capture');
const { notifySaved } = require('./notify');
const { setToastInteractive, onToastsEmpty } = require('./toast-window');

function registerIpcHandlers() {
  ipcMain.handle('saves:get-all', (_e, opts) => getAllSaves(opts));

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
    const referer = payload?.sourceUrl || null;
    if (candidates.length === 0) throw new Error('drop-url called without any URLs');

    const errors = [];
    for (const url of candidates) {
      try {
        const imgData = await saveImageFromUrl(url, { referer });
        const record = insertSave({
          ...imgData,
          sourceUrl: referer || url,
        });
        notifySaved(record);
        return record;
      } catch (err) {
        errors.push(`${url}: ${err.message}`);
      }
    }
    throw new Error(`All ${candidates.length} URL(s) failed:\n${errors.join('\n')}`);
  });

  ipcMain.handle('collections:get-all', () => []);
  ipcMain.handle('collections:create', () => ({ ok: true }));
  ipcMain.handle('collections:add-save', () => ({ ok: true }));

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

  ipcMain.handle('shell:open-external', (_e, url) => {
    if (typeof url !== 'string') return { ok: false };
    if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'invalid-protocol' };
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

  ipcMain.on('toast:set-interactive', (_e, interactive) => {
    setToastInteractive(!!interactive);
  });

  ipcMain.on('toast:empty', () => {
    onToastsEmpty();
  });
}

module.exports = { registerIpcHandlers };
