const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  nativeTheme,
  protocol,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const {
  initDatabase, closeDatabase, insertSave, getSave, updateSave, getTagsForSave,
} = require('./db');
const { hasOpenAIKey, getOpenAIKey, getPref } = require('./settings');
const { analyzeImage, embedText } = require('./openai');

// Float32Array <-> Buffer plumbing for storing embeddings as SQLite BLOBs.
function vectorToBuffer(arr) {
  return Buffer.from(new Float32Array(arr).buffer);
}
const { ensureStorageDirs, saveImageFromFile } = require('./storage');
const { registerIpcHandlers } = require('./ipc');
const {
  registerCaptureHotkey,
  unregisterCaptureHotkey,
  startScreenshotCapture,
  captureFullscreen,
  captureWindow,
} = require('./capture');
const { showToast, destroyToastWindow } = require('./toast-window');
const { setSaveNotifier, setDuplicateNotifier, setTrayRefresher } = require('./notify');
const { initUpdater } = require('./updater');
const { getInitialOptions: getWindowInitialOptions, track: trackWindowState } = require('./window-state');
const libraryRegistry = require('./library-registry');
const { reopenDatabase } = require('./db');

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

let mainWindow = null;
let tray = null;

// Custom file protocol so renderers loaded over http://localhost (and the
// packaged app loaded from file://) can both read images out of the userData
// directory by absolute path.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'moodmark-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

function registerMoodmarkFileProtocol() {
  protocol.handle('moodmark-file', async (req) => {
    const url = new URL(req.url);
    // URL shape: moodmark-file://local/<URI-encoded-absolute-path>
    // Stored as one opaque pathname segment so "/Users" isn't mistaken
    // for the authority in Chromium's URL parser.
    const encoded = url.pathname.replace(/^\/+/, '');
    const abs = decodeURIComponent(encoded);

    if (!fs.existsSync(abs)) {
      console.error('[moodmark-file] not found:', abs);
      return new Response(null, { status: 404 });
    }

    const ext = path.extname(abs).slice(1).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    return new Response(Readable.toWeb(fs.createReadStream(abs)), {
      headers: { 'Content-Type': contentType },
    });
  });
}

function notifySaved(record) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('save:created', record);
  }
  showToast(record);
  // Refresh the tray's recent-saves block so a fresh capture/drop
  // appears under the menu bar icon without a manual relaunch.
  rebuildTrayMenu();
  // Background AI pipeline — runs only if the user opted in to at least
  // one feature and a key is configured. Errors are swallowed so the
  // save flow never blocks on it.
  maybeAIIndexInBackground(record);
}

// Surface a duplicate-on-save event to the renderer so it can show a
// toast that links to the existing entry. Stays out of showToast and
// the AI pipeline — nothing was actually saved.
function notifyDuplicateInRenderer(existing) {
  if (!existing) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('save:duplicate', existing);
  }
}

// One vision call yields title + description. The description (plus
// title and any tags) feeds a single embedding call. Whichever fields
// the user opted into get persisted; the rest are skipped to save cost.
async function maybeAIIndexInBackground(record) {
  if (!record?.id || !record.file_path) return;
  if (!hasOpenAIKey()) return;

  const wantName = getPref('autoNameOnSave', true) && !(record.title && record.title.trim());
  const wantSemantic = getPref('semanticSearch', false);
  if (!wantName && !wantSemantic) return;

  const key = getOpenAIKey();
  if (!key) return;

  // Tell the renderer this save is being processed so the UI can show
  // a loading indicator. Mirrored on completion / failure in the
  // finally block below.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('save:indexing-start', record.id);
  }

  try {
    const { title, description, text } = await analyzeImage(key, record.file_path);

    const updates = { id: record.id };
    // Re-fetch before writing the AI title — the user may have typed
    // their own name in the Name field while the API was in flight.
    // Don't overwrite it.
    if (wantName && title) {
      const fresh = getSave(record.id);
      if (!fresh?.title || !fresh.title.trim()) {
        updates.title = title;
      }
    }
    if (wantSemantic && description) updates.aiDescription = description;
    // OCR runs on the same vision call regardless of pref. Always
    // persist (empty string when nothing was found) so the unindexed
    // sweep doesn't keep retrying the same row forever.
    updates.ocrText = text || '';

    if (wantSemantic) {
      const tags = getTagsForSave(record.id).map((t) => t.name).join(', ');
      // Cap the OCR slice so a text-heavy screenshot doesn't dilute
      // the embedding. 300 chars ≈ ~75 tokens, plenty to surface key
      // headlines / labels semantically.
      const ocrSnippet = text ? text.slice(0, 300) : '';
      const embedSource = [title, description, ocrSnippet, tags].filter(Boolean).join('. ');
      if (embedSource) {
        try {
          const vec = await embedText(key, embedSource);
          updates.embedding = vectorToBuffer(vec);
        } catch (err) {
          console.error('Embed failed:', err.message);
        }
      }
    }

    if (Object.keys(updates).length > 1) {
      updateSave(updates);
      const updated = getSave(record.id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('save:updated', updated);
      }
    }
  } catch (err) {
    console.error('AI index failed:', err.message);
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('save:indexing-end', record.id);
    }
  }
}

function createMainWindow() {
  const winState = getWindowInitialOptions();
  mainWindow = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hiddenInset',
    // Aligned vertically with the 28px toolbar icons
    // (10px padding-top + 14px half-icon = center at y ≈ 24).
    trafficLightPosition: { x: 22, y: 18 },
    backgroundColor: '#EBEBEB',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Re-apply maximized / fullscreen flags after construction (they
  // can't be passed to the BrowserWindow constructor on macOS).
  if (winState.isFullScreen) mainWindow.setFullScreen(true);
  else if (winState.isMaximized) mainWindow.maximize();

  trackWindowState(mainWindow);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'),
    );
  }

  return mainWindow;
}

function buildTrayIcon() {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    console.error('Tray icon not found at', iconPath);
  }
  return icon;
}

// Click handler for a recent-save tray entry: bring the main window
// forward (creating it if needed) and ask the renderer to open the
// focused view on that save.
function openSaveFromTray(saveId) {
  if (!saveId) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
  // The window may still be loading on first launch; give it a beat
  // before pinging the renderer so the listener is wired up.
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('focus:save', saveId);
    }
  };
  if (mainWindow && mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

// Resize a thumb on disk to a menu-friendly icon. Returns null if the
// file is missing so we can fall back to a label-only entry.
function trayIconFromThumb(thumbPath) {
  try {
    if (!thumbPath || !fs.existsSync(thumbPath)) return null;
    const img = nativeImage.createFromPath(thumbPath);
    if (img.isEmpty()) return null;
    return img.resize({ height: 16, quality: 'good' });
  } catch {
    return null;
  }
}

function buildTrayMenuTemplate() {
  // Pull the latest saves directly from the DB. Lazy-required so the
  // tray creation path doesn't tangle with init order.
  let recents = [];
  try {
    const { getAllSaves } = require('./db');
    recents = getAllSaves({ search: '', sort: 'newest', view: 'all' }).slice(0, 13);
  } catch {
    recents = [];
  }

  const visible = recents.slice(0, 3);
  const overflow = recents.slice(3, 13);

  const recentItems = visible.map((s) => ({
    label: s.title || 'Untitled',
    icon: trayIconFromThumb(s.thumb_path) || undefined,
    click: () => openSaveFromTray(s.id),
  }));

  const overflowSubmenu = overflow.length > 0
    ? [{
        label: 'Recently saved',
        submenu: overflow.map((s) => ({
          label: s.title || 'Untitled',
          icon: trayIconFromThumb(s.thumb_path) || undefined,
          click: () => openSaveFromTray(s.id),
        })),
      }]
    : [];

  const recentBlock = recentItems.length > 0
    ? [...recentItems, ...overflowSubmenu, { type: 'separator' }]
    : [];

  return [
    { label: 'Open GatherOS', click: () => {
      if (mainWindow) mainWindow.focus();
      else createMainWindow();
    }},
    { type: 'separator' },
    ...recentBlock,
    { label: 'Capture Area  ⌘⇧S', click: startScreenshotCapture },
    { label: 'Capture Fullscreen', click: captureFullscreen },
    { label: 'Capture Window…', click: captureWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];
}

function rebuildTrayMenu() {
  if (!tray) return;
  try {
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate()));
  } catch (err) {
    console.error('[gatheros] rebuildTrayMenu failed:', err);
  }
}

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('GatherOS');
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate()));

  tray.on('click', () => {
    if (mainWindow) mainWindow.focus();
    else createMainWindow();
  });

  tray.on('drop-files', async (_e, files) => {
    for (const file of files) {
      try {
        const imgData = await saveImageFromFile(file);
        if (imgData.duplicateOf) {
          notifyDuplicateInRenderer(imgData.existing);
        } else {
          const record = insertSave(imgData);
          notifySaved(record);
        }
      } catch (err) {
        console.error('Tray drop failed:', err);
      }
    }
  });
}

// Sync handler so the renderer can read app.getVersion() synchronously
// from the preload (used to surface the version on the loading screen
// without an extra async round-trip).
ipcMain.on('app:get-version', (event) => {
  event.returnValue = app.getVersion();
});

// ── Library registry IPC ────────────────────────────────────────────
// All five handlers are thin wrappers over library-registry. The
// switch handler additionally closes the current DB, reopens it
// against the newly-active library, and notifies the renderer so
// it can refetch every cached collection / save.

ipcMain.handle('library:list', () => libraryRegistry.listLibraries());

ipcMain.handle('library:previews', (_e, payload = {}) => {
  const id = typeof payload === 'string' ? payload : payload.id;
  const limit = (typeof payload === 'object' && payload.limit) || 4;
  return libraryRegistry.getLibraryPreviews(id, limit);
});

ipcMain.handle('library:create', (_e, name) => {
  return libraryRegistry.createLibrary(name);
});

ipcMain.handle('library:rename', (_e, payload = {}) => {
  return libraryRegistry.renameLibrary(payload.id, payload.name);
});

ipcMain.handle('library:delete', (_e, id) => {
  const result = libraryRegistry.deleteLibrary(id);
  if (!result.ok) return result;
  if (result.wasActive) {
    // The DB handle was open against the now-deleted folder. Reopen
    // against the auto-promoted active library and notify the
    // renderer so it can clear its view + refetch.
    reopenDatabase();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('library:switched', { activeId: result.newActiveId });
    }
  }
  return result;
});

ipcMain.handle('library:switch', (_e, id) => {
  const result = libraryRegistry.setActiveLibrary(id);
  if (!result.ok) return result;
  // Closing + reopening the DB picks up the new active path. The
  // image and thumb dirs are also derived per-call so they need no
  // explicit refresh.
  reopenDatabase();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('library:switched', { activeId: id });
  }
  rebuildTrayMenu();
  return { ok: true };
});

app.whenReady().then(() => {
  if (process.platform === 'darwin') nativeTheme.themeSource = 'light';
  setSaveNotifier(notifySaved);
  setDuplicateNotifier(notifyDuplicateInRenderer);
  setTrayRefresher(rebuildTrayMenu);
  registerMoodmarkFileProtocol();
  // Bootstrap the library registry first — moves any pre-multi-
  // library data into a default library folder so the DB and image
  // dirs initialize against the right path on the next call.
  libraryRegistry.bootstrap();
  ensureStorageDirs();
  initDatabase();
  registerIpcHandlers();
  createMainWindow();
  createTray();
  registerCaptureHotkey();
  initUpdater(mainWindow);

  // One-shot backfill of content_hash for rows that pre-date the
  // dedup feature. Runs in the background so it doesn't block boot.
  setTimeout(() => {
    const { backfillContentHashes } = require('./db');
    backfillContentHashes()
      .then((n) => { if (n > 0) console.log(`[gatheros] Hashed ${n} legacy save(s) for dedup.`); })
      .catch((err) => console.error('[gatheros] Hash backfill failed:', err));
  }, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Concurrently sends SIGTERM (and Ctrl+C sends SIGINT) when the dev
// run is killed. Without these, Electron sometimes lingers after the
// terminal goes away and keeps holding the global shortcut.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => app.quit());
}

app.on('before-quit', () => {
  destroyToastWindow();
});

app.on('will-quit', () => {
  unregisterCaptureHotkey();
  closeDatabase();
});
