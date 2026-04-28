const {
  app,
  BrowserWindow,
  Tray,
  Menu,
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
} = require('./capture');
const { showToast, destroyToastWindow } = require('./toast-window');
const { setSaveNotifier } = require('./notify');
const { initUpdater } = require('./updater');

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
  // Background AI pipeline — runs only if the user opted in to at least
  // one feature and a key is configured. Errors are swallowed so the
  // save flow never blocks on it.
  maybeAIIndexInBackground(record);
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hiddenInset',
    // Aligned vertically with the 28px toolbar icons
    // (10px padding-top + 14px half-icon = center at y ≈ 24).
    trafficLightPosition: { x: 22, y: 18 },
    backgroundColor: '#FAFAF9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

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

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('GatherOS');

  const menu = Menu.buildFromTemplate([
    { label: 'Open GatherOS', click: () => {
      if (mainWindow) mainWindow.focus();
      else createMainWindow();
    }},
    { label: 'Capture Screenshot  ⌘⇧S', click: startScreenshotCapture },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    if (mainWindow) mainWindow.focus();
    else createMainWindow();
  });

  tray.on('drop-files', async (_e, files) => {
    for (const file of files) {
      try {
        const imgData = await saveImageFromFile(file);
        const record = insertSave(imgData);
        notifySaved(record);
      } catch (err) {
        console.error('Tray drop failed:', err);
      }
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') nativeTheme.themeSource = 'light';
  setSaveNotifier(notifySaved);
  registerMoodmarkFileProtocol();
  ensureStorageDirs();
  initDatabase();
  registerIpcHandlers();
  createMainWindow();
  createTray();
  registerCaptureHotkey();
  initUpdater(mainWindow);

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
