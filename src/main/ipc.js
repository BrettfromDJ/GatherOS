const { ipcMain, shell } = require('electron');
const { getAllSaves, deleteSave, updateSave, insertSave } = require('./db');
const { deleteImageFiles, saveImageFromFile } = require('./storage');
const {
  handleOverlayComplete,
  handleOverlayCancel,
  startScreenshotCapture,
} = require('./capture');
const { notifySaved } = require('./notify');
const { setToastInteractive, hideToastWindow } = require('./toast-window');

function registerIpcHandlers() {
  ipcMain.handle('saves:get-all', (_e, opts) => getAllSaves(opts));

  ipcMain.handle('saves:delete', (_e, id) => {
    const result = deleteSave(id);
    if (result.ok) deleteImageFiles(result.filePath, result.thumbPath);
    return result;
  });

  ipcMain.handle('saves:update', (_e, payload) => updateSave(payload));

  ipcMain.handle('saves:drop-file', async (_e, filePath) => {
    const imgData = await saveImageFromFile(filePath);
    const record = insertSave(imgData);
    notifySaved(record);
    return record;
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

  ipcMain.on('toast:set-interactive', (_e, interactive) => {
    setToastInteractive(!!interactive);
  });

  ipcMain.on('toast:empty', () => {
    setToastInteractive(false);
    hideToastWindow();
  });
}

module.exports = { registerIpcHandlers };
