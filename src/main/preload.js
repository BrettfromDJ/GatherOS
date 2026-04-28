const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('moodmark', {
  saves: {
    getAll: (opts) => ipcRenderer.invoke('saves:get-all', opts ?? {}),
    update: (payload) => ipcRenderer.invoke('saves:update', payload),
    delete: (id) => ipcRenderer.invoke('saves:delete', id),
    restore: (id) => ipcRenderer.invoke('saves:restore', id),
    permanentDelete: (id) => ipcRenderer.invoke('saves:permanent-delete', id),
    emptyTrash: () => ipcRenderer.invoke('saves:empty-trash'),
    counts: () => ipcRenderer.invoke('saves:counts'),
    exportBulk: (ids) => ipcRenderer.invoke('saves:export-bulk', ids),
    exportBulkZip: (ids) => ipcRenderer.invoke('saves:export-bulk-zip', ids),
    confirmDelete: (count) => ipcRenderer.invoke('saves:confirm-delete', count),
    dropFile: (file) => {
      // Electron 32+ removed File.path; webUtils.getPathForFile is the
      // sanctioned replacement and must be called from the preload.
      const filePath = webUtils.getPathForFile(file);
      if (!filePath) return Promise.reject(new Error('No filesystem path on dropped file'));
      return ipcRenderer.invoke('saves:drop-file', filePath);
    },
    dropUrl: (urls) =>
      ipcRenderer.invoke('saves:drop-url', {
        urls: Array.isArray(urls) ? urls : [urls],
      }),
  },
  collections: {
    getAll: () => ipcRenderer.invoke('collections:get-all'),
    getForSave: (saveId) => ipcRenderer.invoke('collections:get-for-save', saveId),
    containingAll: (saveIds) => ipcRenderer.invoke('collections:containing-all', saveIds),
    create: (payload) => ipcRenderer.invoke('collections:create', payload),
    rename: (payload) => ipcRenderer.invoke('collections:rename', payload),
    delete: (id) => ipcRenderer.invoke('collections:delete', id),
    reorder: (ids) => ipcRenderer.invoke('collections:reorder', ids),
    addSave: (payload) => ipcRenderer.invoke('collections:add-save', payload),
    removeSave: (payload) => ipcRenderer.invoke('collections:remove-save', payload),
  },
  boards: {
    // Composite-PNG export of selected saves into a moodboard image
    // (used by the multi-select bar's "Export as Moodboard" button).
    export: (saveIds) => ipcRenderer.invoke('boards:export', saveIds),
  },
  tags: {
    getAll: () => ipcRenderer.invoke('tags:get-all'),
    getForSave: (saveId) => ipcRenderer.invoke('tags:get-for-save', saveId),
    addToSave: (payload) => ipcRenderer.invoke('tags:add-to-save', payload),
    removeFromSave: (payload) => ipcRenderer.invoke('tags:remove-from-save', payload),
  },
  capture: {
    screenshot: () => ipcRenderer.invoke('capture:screenshot'),
  },
  image: {
    openInPreview: (filePath) => ipcRenderer.invoke('image:open-in-preview', filePath),
    export: (filePath, defaultName) =>
      ipcRenderer.invoke('image:export', { filePath, defaultName }),
  },
  shell: {
    openUrl: (url) => ipcRenderer.invoke('shell:open-url', url),
  },
  library: {
    exportZip: () => ipcRenderer.invoke('library:export-zip'),
    installStarter: () => ipcRenderer.invoke('library:install-starter'),
    wipeAll: () => ipcRenderer.invoke('library:wipe-all'),
  },
  drag: {
    // Fire-and-forget IPC because webContents.startDrag must run
    // synchronously off the renderer's dragstart event.
    start: (payload) => ipcRenderer.send('drag:start', payload),
  },
  settings: {
    hasOpenAIKey: () => ipcRenderer.invoke('settings:has-openai-key'),
    // Note: getter for the key itself is intentionally NOT exposed.
    setOpenAIKey: (key) => ipcRenderer.invoke('settings:set-openai-key', key),
    clearOpenAIKey: () => ipcRenderer.invoke('settings:clear-openai-key'),
    testOpenAIKey: () => ipcRenderer.invoke('settings:test-openai-key'),
    getPrefs: () => ipcRenderer.invoke('settings:get-prefs'),
    setPref: (name, value) => ipcRenderer.invoke('settings:set-pref', { name, value }),
  },
  ai: {
    autoTag: (saveId) => ipcRenderer.invoke('ai:auto-tag', saveId),
    generatePrompt: (saveId) => ipcRenderer.invoke('ai:generate-prompt', saveId),
    unindexedCount: () => ipcRenderer.invoke('ai:unindexed-count'),
    reindexLibrary: () => ipcRenderer.invoke('ai:reindex-library'),
  },
  on: (channel, listener) => {
    const allowed = new Set([
      'save:created',
      'save:updated',
      'save:indexing-start',
      'save:indexing-end',
      'update-ready',
      'ai:reindex-progress',
    ]);
    if (!allowed.has(channel)) return () => {};
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
