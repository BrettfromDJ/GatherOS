const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('moodmark', {
  saves: {
    getAll: (opts) => ipcRenderer.invoke('saves:get-all', opts ?? {}),
    update: (payload) => ipcRenderer.invoke('saves:update', payload),
    delete: (id) => ipcRenderer.invoke('saves:delete', id),
    confirmDelete: (count) => ipcRenderer.invoke('saves:confirm-delete', count),
    dropFile: (file) => {
      // Electron 32+ removed File.path; webUtils.getPathForFile is the
      // sanctioned replacement and must be called from the preload.
      const filePath = webUtils.getPathForFile(file);
      if (!filePath) return Promise.reject(new Error('No filesystem path on dropped file'));
      return ipcRenderer.invoke('saves:drop-file', filePath);
    },
    dropUrl: (urls, sourceUrl) =>
      ipcRenderer.invoke('saves:drop-url', {
        urls: Array.isArray(urls) ? urls : [urls],
        sourceUrl,
      }),
  },
  collections: {
    getAll: () => ipcRenderer.invoke('collections:get-all'),
    create: (payload) => ipcRenderer.invoke('collections:create', payload),
    addSave: (payload) => ipcRenderer.invoke('collections:add-save', payload),
  },
  capture: {
    screenshot: () => ipcRenderer.invoke('capture:screenshot'),
  },
  image: {
    openInPreview: (filePath) => ipcRenderer.invoke('image:open-in-preview', filePath),
    export: (filePath, defaultName) =>
      ipcRenderer.invoke('image:export', { filePath, defaultName }),
  },
  on: (channel, listener) => {
    const allowed = new Set(['save:created', 'update-ready']);
    if (!allowed.has(channel)) return () => {};
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
