const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Pulled once at preload time so it's available synchronously to the
// renderer (loading screen reads it during first paint).
const appVersion = (() => {
  try { return ipcRenderer.sendSync('app:get-version'); }
  catch { return ''; }
})();

// Same pattern for the theme — applied to <html data-theme> before
// React mounts so the user never sees the wrong palette flash in.
const initialTheme = (() => {
  try { return ipcRenderer.sendSync('app:get-theme') || 'light'; }
  catch { return 'light'; }
})();

// Last view + focused save the renderer was on at quit. Sync-read
// so App.jsx can restore on first render without a flash of the
// default 'all' view.
const initialWindowState = (() => {
  try { return ipcRenderer.sendSync('app:get-window-state') || null; }
  catch { return null; }
})();

contextBridge.exposeInMainWorld('moodmark', {
  app: {
    version: appVersion,
    theme: initialTheme,
    setTheme: (theme) => ipcRenderer.invoke('app:set-theme', theme),
    windowState: initialWindowState,
    setWindowState: (state) => ipcRenderer.invoke('app:set-window-state', state),
  },
  saves: {
    getAll: (opts) => ipcRenderer.invoke('saves:get-all', opts ?? {}),
    update: (payload) => ipcRenderer.invoke('saves:update', payload),
    delete: (id) => ipcRenderer.invoke('saves:delete', id),
    restore: (id) => ipcRenderer.invoke('saves:restore', id),
    permanentDelete: (id) => ipcRenderer.invoke('saves:permanent-delete', id),
    emptyTrash: () => ipcRenderer.invoke('saves:empty-trash'),
    counts: () => ipcRenderer.invoke('saves:counts'),
    findSimilar: (saveId, limit) => ipcRenderer.invoke('saves:find-similar', saveId, limit),
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
    getAllWithThumbs: () => ipcRenderer.invoke('collections:get-all-with-thumbs'),
    getForSave: (saveId) => ipcRenderer.invoke('collections:get-for-save', saveId),
    containingAll: (saveIds) => ipcRenderer.invoke('collections:containing-all', saveIds),
    create: (payload) => ipcRenderer.invoke('collections:create', payload),
    rename: (payload) => ipcRenderer.invoke('collections:rename', payload),
    setParent: (id, parentId) => ipcRenderer.invoke('collections:set-parent', { id, parentId }),
    delete: (id) => ipcRenderer.invoke('collections:delete', id),
    reorder: (ids) => ipcRenderer.invoke('collections:reorder', ids),
    addSave: (payload) => ipcRenderer.invoke('collections:add-save', payload),
    removeSave: (payload) => ipcRenderer.invoke('collections:remove-save', payload),
  },
  boards: {
    // Composite-PNG export of selected saves into a moodboard image
    // (used by the multi-select bar's "Export as Moodboard" button).
    export: (saveIds) => ipcRenderer.invoke('boards:export', saveIds),
    // Snapshot the current board view — capturePage on a rect.
    exportPng: (payload) => ipcRenderer.invoke('boards:export-png', payload),
    // Persistent infinite-canvas boards (Miro-style).
    list: () => ipcRenderer.invoke('boards:list'),
    get: (id) => ipcRenderer.invoke('boards:get', id),
    create: (payload) => ipcRenderer.invoke('boards:create', payload ?? {}),
    rename: (payload) => ipcRenderer.invoke('boards:rename', payload),
    delete: (id) => ipcRenderer.invoke('boards:delete', id),
    getItems: (boardId) => ipcRenderer.invoke('boards:get-items', boardId),
    getPreviewSaves: (boardId, limit) => ipcRenderer.invoke('boards:get-preview-saves', boardId, limit),
    upsertItem: (payload) => ipcRenderer.invoke('boards:upsert-item', payload),
    bulkUpdateItems: (payload) => ipcRenderer.invoke('boards:bulk-update-items', payload),
    deleteItem: (payload) => ipcRenderer.invoke('boards:delete-item', payload),
    deleteItems: (payload) => ipcRenderer.invoke('boards:delete-items', payload),
  },
  tags: {
    getAll: () => ipcRenderer.invoke('tags:get-all'),
    getForSave: (saveId) => ipcRenderer.invoke('tags:get-for-save', saveId),
    addToSave: (payload) => ipcRenderer.invoke('tags:add-to-save', payload),
    removeFromSave: (payload) => ipcRenderer.invoke('tags:remove-from-save', payload),
    rename: (payload) => ipcRenderer.invoke('tags:rename', payload),
    delete: (id) => ipcRenderer.invoke('tags:delete', id),
    deleteUnused: () => ipcRenderer.invoke('tags:delete-unused'),
  },
  db: {
    integrity: () => ipcRenderer.invoke('db:integrity'),
  },
  capture: {
    screenshot: () => ipcRenderer.invoke('capture:screenshot'),
  },
  image: {
    openInPreview: (filePath) => ipcRenderer.invoke('image:open-in-preview', filePath),
    export: (filePath, defaultName) =>
      ipcRenderer.invoke('image:export', { filePath, defaultName }),
    copyToClipboard: (filePath) => ipcRenderer.invoke('image:copy-to-clipboard', filePath),
  },
  shell: {
    openUrl: (url) => ipcRenderer.invoke('shell:open-url', url),
  },
  share: {
    save: (payload) => ipcRenderer.invoke('share:save', payload),
  },
  library: {
    exportZip: () => ipcRenderer.invoke('library:export-zip'),
    installStarter: () => ipcRenderer.invoke('library:install-starter'),
    wipeAll: () => ipcRenderer.invoke('library:wipe-all'),
    revealActive: () => ipcRenderer.invoke('library:reveal-active'),
  },
  backup: {
    list: () => ipcRenderer.invoke('backup:list'),
    snapshot: () => ipcRenderer.invoke('backup:snapshot'),
    restore: (snapshotPath) => ipcRenderer.invoke('backup:restore', snapshotPath),
  },
  libraries: {
    list: () => ipcRenderer.invoke('library:list'),
    create: (name) => ipcRenderer.invoke('library:create', name),
    rename: (id, name) => ipcRenderer.invoke('library:rename', { id, name }),
    delete: (id) => ipcRenderer.invoke('library:delete', id),
    switch: (id) => ipcRenderer.invoke('library:switch', id),
    previews: (id, limit) => ipcRenderer.invoke('library:previews', { id, limit }),
  },
  drag: {
    // Fire-and-forget IPC because webContents.startDrag must run
    // synchronously off the renderer's dragstart event.
    start: (payload) => ipcRenderer.send('drag:start', payload),
  },
  settings: {
    getPrefs: () => ipcRenderer.invoke('settings:get-prefs'),
    setPref: (name, value) => ipcRenderer.invoke('settings:set-pref', { name, value }),
  },
  ai: {
    // Server-proxied AI features. The licensing session token in
    // licensing.js is what gates these — no per-feature key to manage
    // on the renderer side anymore.
    hasSession: () => ipcRenderer.invoke('ai:has-session'),
    usage: () => ipcRenderer.invoke('ai:usage'),
    autoTag: (saveId) => ipcRenderer.invoke('ai:auto-tag', saveId),
    generatePrompt: (saveId) => ipcRenderer.invoke('ai:generate-prompt', saveId),
    unindexedCount: () => ipcRenderer.invoke('ai:unindexed-count'),
    reindexLibrary: () => ipcRenderer.invoke('ai:reindex-library'),
    similarSaves: (saveId, limit) => ipcRenderer.invoke('ai:similar-saves', saveId, limit),
  },
  updater: {
    install: () => ipcRenderer.invoke('updater:install'),
  },
  licensing: {
    requestMagicLink: (email) => ipcRenderer.invoke('licensing:request-magic-link', email),
    verify: (opts) => ipcRenderer.invoke('licensing:verify', opts),
    hasSession: () => ipcRenderer.invoke('licensing:has-session'),
    signOut: () => ipcRenderer.invoke('licensing:sign-out'),
    openCustomerPortal: () => ipcRenderer.invoke('licensing:open-customer-portal'),
    openCheckout: (plan) => ipcRenderer.invoke('licensing:open-checkout', plan),
  },
  on: (channel, listener) => {
    const allowed = new Set([
      'save:created',
      'save:duplicate',
      'save:updated',
      'save:deleted',
      'focus:save',
      'save:indexing-start',
      'save:indexing-end',
      'update-ready',
      'update-error',
      'ai:reindex-progress',
      'library:switched',
      'licensing:auth-result',
      'menu:command',
    ]);
    if (!allowed.has(channel)) return () => {};
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
