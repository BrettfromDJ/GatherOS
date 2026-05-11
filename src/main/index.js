const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  nativeTheme,
  protocol,
  shell,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const {
  initDatabase, closeDatabase, insertSave, getSave, updateSave, getTagsForSave,
} = require('./db');
const { getPref } = require('./settings');
const { hasSession: hasAiSession, analyzeImage, embedText } = require('./openai');
const licensing = require('./licensing');
const { URL_SCHEME: LICENSE_URL_SCHEME } = require('../shared/licensing-config');

// Register the custom URL scheme so the OS knows magic-link emails
// (gatheros://auth/verify?token=…) should open this app. macOS
// dispatches the URL via the 'open-url' event; Windows / Linux pass
// it through argv to a second-instance launch.
if (process.defaultApp) {
  // Dev: when launched via `electron .`, defaultApp is true and we
  // need to pass the script path so single-instance forwarding works.
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(LICENSE_URL_SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(LICENSE_URL_SCHEME);
}

// Token queue for licensing deep-links that arrive before the
// renderer is ready to receive them (cold launch from email click).
const pendingLicenseTokens = [];
let rendererReady = false;

async function handleLicensingDeepLink(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  // gatheros://auth/verify?token=…
  if (parsed.hostname !== 'auth' || parsed.pathname !== '/verify') return;
  const token = parsed.searchParams.get('token');
  if (!token) return;

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  const result = await licensing.exchangeMagicToken(token);
  // Always notify the renderer so it can refresh license state and
  // dismiss the signin screen; include success/failure so the UI can
  // surface the right toast.
  pendingLicenseTokens.push(result);
  drainLicenseTokenQueue();
}

function drainLicenseTokenQueue() {
  if (!mainWindow || !rendererReady) return;
  while (pendingLicenseTokens.length > 0) {
    const item = pendingLicenseTokens.shift();
    mainWindow.webContents.send('licensing:auth-result', item);
  }
}

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

// macOS Dock-drop queue. The 'open-file' event can fire BEFORE app
// is ready (e.g. when the user drags an image onto a non-running
// app's Dock icon and that triggers launch), so the listener has to
// be installed at module load time and paths queued until storage
// + DB are initialized. drainDockOpenQueue runs once init completes
// and again on every subsequent drop while the app is alive.
const dockOpenQueue = [];
let dockOpenReady = false;

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  dockOpenQueue.push(filePath);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  drainDockOpenQueue();
});

// Block until the main window's renderer has finished loading, so
// notifySaved/notifyDuplicateInRenderer don't fire IPCs into a
// half-initialized renderer. Also catches the cold-launch case
// where Dock-drop spawns the app: dockOpenReady flips true right
// after createMainWindow(), but the renderer still has 100-300ms
// of vite-load left.
async function waitForMainWindowReady() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.webContents.isLoading()) return;
  await new Promise((resolve) => {
    const wc = mainWindow.webContents;
    const cleanup = () => {
      wc.off('did-finish-load', cleanup);
      wc.off('did-fail-load', cleanup);
      wc.off('destroyed', cleanup);
      resolve();
    };
    wc.once('did-finish-load', cleanup);
    wc.once('did-fail-load', cleanup);
    wc.once('destroyed', cleanup);
    // Belt-and-suspenders timeout — if neither event ever fires, we
    // still proceed (worst case: user misses the save:created toast).
    setTimeout(cleanup, 4000);
  });
}

async function drainDockOpenQueue() {
  if (!dockOpenReady || dockOpenQueue.length === 0) return;
  await waitForMainWindowReady();
  const { saveImageFromFile } = require('./storage');
  const { insertSave } = require('./db');
  while (dockOpenQueue.length > 0) {
    const filePath = dockOpenQueue.shift();
    try {
      const imgData = await saveImageFromFile(filePath);
      if (imgData.duplicateOf) {
        try { notifyDuplicateInRenderer(imgData.existing); }
        catch (err) { console.error('[gatheros] notifyDuplicate failed:', err); }
      } else {
        const record = insertSave(imgData);
        try { notifySaved(record); }
        catch (err) { console.error('[gatheros] notifySaved failed:', err); }
      }
    } catch (err) {
      console.error('[gatheros] Dock-drop save failed:', filePath, err?.message || err);
    }
  }
}

// Same shape for URL drops onto the Dock — Chrome and other browsers
// drag images as URLs rather than promised files in many flows. We
// fetch + persist via the existing saveImageFromUrl pipeline so the
// dedup, palette, and AI hooks fire just like a drag-into-window.
const dockOpenUrlQueue = [];

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (typeof url !== 'string') return;
  // Magic-link bridge: gatheros://auth/verify?token=… — route to the
  // licensing module instead of the image-save pipeline.
  if (url.startsWith(`${LICENSE_URL_SCHEME}://`)) {
    handleLicensingDeepLink(url);
    return;
  }
  if (!/^https?:\/\//i.test(url)) return;
  dockOpenUrlQueue.push(url);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  drainDockOpenUrlQueue();
});

async function drainDockOpenUrlQueue() {
  if (!dockOpenReady || dockOpenUrlQueue.length === 0) return;
  await waitForMainWindowReady();
  const { saveImageFromUrl } = require('./storage');
  const { insertSave } = require('./db');
  while (dockOpenUrlQueue.length > 0) {
    const url = dockOpenUrlQueue.shift();
    try {
      const imgData = await saveImageFromUrl(url);
      if (imgData.duplicateOf) {
        try { notifyDuplicateInRenderer(imgData.existing); }
        catch (err) { console.error('[gatheros] notifyDuplicate failed:', err); }
      } else {
        const record = insertSave(imgData);
        try { notifySaved(record); }
        catch (err) { console.error('[gatheros] notifySaved failed:', err); }
      }
    } catch (err) {
      console.error('[gatheros] Dock-drop URL save failed:', url, err?.message || err);
    }
  }
}

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
  // Each side-effect is isolated: a failure in showToast (creating
  // a new BrowserWindow during cold launch is the most common
  // crasher) shouldn't take out the IPC notify or tray rebuild.
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('save:created', record);
    }
  } catch (err) { console.error('[gatheros] save:created send failed:', err); }
  try { showToast(record); }
  catch (err) { console.error('[gatheros] showToast failed:', err); }
  try { rebuildTrayMenu(); }
  catch (err) { console.error('[gatheros] rebuildTrayMenu failed:', err); }
  try { maybeAIIndexInBackground(record); }
  catch (err) { console.error('[gatheros] AI index failed:', err); }
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
  // No license session = paywall is in front of the user; AI features
  // would 401 at the proxy anyway, so skip the round-trip.
  if (!hasAiSession()) return;

  const wantName = getPref('autoNameOnSave', true) && !(record.title && record.title.trim());
  const wantSemantic = getPref('semanticSearch', false);
  if (!wantName && !wantSemantic) return;

  // Tell the renderer this save is being processed so the UI can show
  // a loading indicator. Mirrored on completion / failure in the
  // finally block below.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('save:indexing-start', record.id);
  }

  try {
    const { title, description, text } = await analyzeImage(record.file_path);

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
          const vec = await embedText(embedSource);
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
  // Theme is read from prefs synchronously so the BrowserWindow's
  // initial backgroundColor matches what variables.css will paint —
  // otherwise a dark-mode user sees a white flash before the first
  // CSS frame lands.
  const initialTheme = require('./settings').getPref('theme', 'light');
  const isDark = initialTheme === 'dark';
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
    backgroundColor: isDark ? '#1C1C1E' : '#FAFAF9',
    // macOS sidebar vibrancy material — same one Finder / Mail use
    // for their floating sidebars. Renderer keeps the .sidebar
    // background transparent so this material shows through; the
    // main content pane explicitly paints var(--content-bg) over it.
    ...(process.platform === 'darwin' ? {
      vibrancy: 'sidebar',
      visualEffectState: 'active',
    } : {}),
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

  // Renderer is ready to receive IPC events. Drain any queued
  // licensing deep-links that arrived before this point.
  mainWindow.webContents.once('did-finish-load', () => {
    rendererReady = true;
    drainLicenseTokenQueue();
  });
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

// Sync so the preload can hand a value to the renderer before first
// paint, avoiding a flash of light theme on a dark-pref'd launch.
ipcMain.on('app:get-theme', (event) => {
  const settings = require('./settings');
  event.returnValue = settings.getPref('theme', 'system');
});

ipcMain.on('app:get-defaults', (event) => {
  const settings = require('./settings');
  event.returnValue = {
    defaultSort: settings.getPref('defaultSort', 'recent'),
    defaultColumns: settings.getPref('defaultColumns', 4),
    defaultMode: settings.getPref('defaultMode', 'library'),
  };
});

// Reports the result of the PRAGMA integrity_check that ran during
// initDatabase(). Renderer pulls this on mount and surfaces a
// recoverable warning if the SQLite file came back damaged.
ipcMain.handle('db:integrity', () => {
  const { getIntegrityResult } = require('./db');
  return getIntegrityResult();
});

// Window state — last view + focused save the user was on. Pulled
// synchronously at preload time so App.jsx can restore on first
// render with no flash; written async whenever the renderer state
// changes.
ipcMain.on('app:get-window-state', (event) => {
  const settings = require('./settings');
  event.returnValue = settings.getPref('windowState', null);
});

ipcMain.handle('app:set-window-state', (_e, state) => {
  const settings = require('./settings');
  if (state == null || typeof state !== 'object') return { ok: false };
  // Whitelist what we persist — keep it tight so future renderer
  // state additions don't accidentally land on disk forever.
  const sanitized = {
    view: state.view && typeof state.view === 'object' ? state.view : null,
    focusedId: typeof state.focusedId === 'string' ? state.focusedId : null,
  };
  return settings.setPref('windowState', sanitized);
});

// Renderer's Light/Dark switch fires this so the native chrome
// (traffic lights, scrollbars, native dialogs) flips in lockstep
// with the document. Pref persistence still happens via the regular
// settings:set-pref path; this handler only updates Electron state.
ipcMain.handle('app:set-theme', (_e, theme) => {
  const next = theme === 'dark' ? 'dark' : 'light';
  if (process.platform === 'darwin') {
    nativeTheme.themeSource = next;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(next === 'dark' ? '#1C1C1E' : '#FAFAF9');
  }
  return { ok: true };
});

// ── Library registry IPC ────────────────────────────────────────────
// All five handlers are thin wrappers over library-registry. The
// switch handler additionally closes the current DB, reopens it
// against the newly-active library, and notifies the renderer so
// it can refetch every cached collection / save.

ipcMain.handle('library:list', () => libraryRegistry.listLibraries());

// Reveal the currently active library's folder in Finder. Useful for
// manual backups and for users who want to inspect what GatherOS has
// stored on disk. Resolved per-call so library switches are picked up.
ipcMain.handle('library:reveal-active', () => {
  try {
    const root = libraryRegistry.getActiveLibraryRoot();
    if (!root) return { ok: false, reason: 'no-active-library' };
    return shell.openPath(root).then((err) => {
      if (err) return { ok: false, reason: err };
      return { ok: true, path: root };
    });
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
});

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
  if (process.platform === 'darwin') {
    // Drive the macOS native chrome (title bar text, traffic-light
    // hover state, native scrollbars) off the same prefs.theme value
    // the renderer applies to <html data-theme>.
    const settings = require('./settings');
    const themePref = settings.getPref('theme', 'light');
    nativeTheme.themeSource = themePref === 'dark' ? 'dark' : 'light';
  }
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
  // Apply the macOS application menu now that mainWindow exists so
  // the menu can target webContents.send() at the right window.
  const { buildAppMenu } = require('./menu');
  Menu.setApplicationMenu(buildAppMenu({ getMainWindow: () => mainWindow }));
  createTray();
  registerCaptureHotkey();
  initUpdater(mainWindow);

  // Trash auto-purge: if the Settings → "Auto-empty trash" pref is
  // > 0, hard-delete any soft-trashed saves older than that retention
  // window. Runs once at boot; users get fresh state without us
  // having to schedule a background sweep.
  try {
    const settings = require('./settings');
    const days = Number(settings.getPref('trashAutoEmptyDays', 0)) || 0;
    if (days > 0) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const { purgeTrashBefore } = require('./db');
      const { deleteImageFiles } = require('./storage');
      const result = purgeTrashBefore(cutoff);
      if (result?.ok && result.ids.length > 0) {
        console.log(`[trash] auto-purged ${result.ids.length} saves older than ${days}d`);
        for (const f of result.files) deleteImageFiles(f.filePath, f.thumbPath);
      }
    }
  } catch (err) {
    console.warn('[trash] auto-purge failed:', err.message);
  }

  // Storage + DB are now ready; drain any Dock-drop paths or URLs
  // that accumulated during launch (and unblock subsequent drops).
  dockOpenReady = true;
  drainDockOpenQueue();
  drainDockOpenUrlQueue();

  // One-shot backfill of content_hash for rows that pre-date the
  // dedup feature. Runs in the background so it doesn't block boot.
  setTimeout(() => {
    const { backfillContentHashes } = require('./db');
    backfillContentHashes()
      .then((n) => { if (n > 0) console.log(`[gatheros] Hashed ${n} legacy save(s) for dedup.`); })
      .catch((err) => console.error('[gatheros] Hash backfill failed:', err));
  }, 1500);

  // Daily auto-snapshot of the SQLite DB. No-ops if the latest
  // snapshot is <24h old; otherwise produces a fresh one and prunes
  // older ones beyond the keep-N cap. Image files are append-only
  // (content-hash-named) so we don't include them — the DB is the
  // only thing that meaningfully changes between sessions.
  setTimeout(() => {
    try {
      const { maybeSnapshotOnLaunch } = require('./backup');
      const result = maybeSnapshotOnLaunch();
      if (result?.ok) {
        console.log('[backup] auto-snapshot taken at', new Date(result.timestamp).toISOString());
      }
    } catch (err) {
      console.error('[backup] launch snapshot failed:', err);
    }
  }, 2500);

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
