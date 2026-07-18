const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  nativeTheme,
  protocol,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

// Native messaging host short-circuit. When Chrome spawns this
// binary as the extension's host (via the --native-host flag), we
// hand off to a stdin/stdout relay BEFORE touching the logger,
// single-instance lock, or anything else that would interfere with
// the running main app. The host process exits when stdin closes.
if (process.argv.includes('--native-host')) {
  require('./native-host').run();
  return;
}

// Tee console.* into ~/Library/Logs/GatherOS/main.log and capture
// uncaughtException / renderer crashes. Must run before the rest of
// the module so any init-time throws are recorded.
require('./logger').setup();

// Single-instance lock. Two processes sharing one SQLite file would
// race writes and corrupt the library — we only ever want one. If
// we fail to get the lock, focus the existing window via the
// 'second-instance' event below and exit immediately.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}
// The native messaging host wakes us with a --gatheros-bg sentinel
// when it's launching us solely to persist a bookmark save. In that
// case we must NOT pull the app in front of the user's browser — both
// the initial window show (below) and the second-instance focus are
// suppressed. Saving a bookmark is a background sync, never a foreground
// interruption.
const LAUNCHED_FOR_BG_SAVE = process.argv.includes('--gatheros-bg');
app.on('second-instance', (_event, argv) => {
  // A relaunch carrying the sentinel is the host nudging an already-
  // running app for a save — leave focus where it is.
  if (Array.isArray(argv) && argv.includes('--gatheros-bg')) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

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
const extensionServer = require('./extension-server');
const { showToast, destroyToastWindow } = require('./toast-window');
const { setSaveNotifier, setDuplicateNotifier, setNeedsUpgradeNotifier, setBookmarkNotifier, setBookmarkFailedNotifier, setErrorNotifier, setTrayRefresher, setSaveOpener, notifyError } = require('./notify');
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
  // Dock-icon drops save quietly in the background. We intentionally do
  // NOT show/focus the window — popping the app to the foreground on
  // every dropped image interrupts whatever the user's doing. The save
  // still confirms via the standard toast.
  dockOpenQueue.push(filePath);
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
  // Free tier: new saves require an upgrade. Drop the queued drops and
  // surface the prompt rather than silently saving past the gate.
  if (!require('./entitlement').canCreateSave()) {
    dockOpenQueue.length = 0;
    try { notifyNeedsUpgrade({ source: 'save' }); } catch { /* ignore */ }
    return;
  }
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
      const name = (() => { try { return require('node:path').basename(filePath); } catch { return 'file'; } })();
      notifyError(`Couldn\u2019t save ${name} \u2014 drop it into the app window to retry`);
    }
  }
}

// Same shape for URL drops onto the Dock — Chrome and other browsers
// drag images as URLs rather than promised files in many flows. We
// fetch + persist via the existing saveImageFromUrl pipeline so the
// dedup, palette, and AI hooks fire just like a drag-into-window.
const dockOpenUrlQueue = [];

// Single dropped URL → save. Tries the URL as an image first; if
// the response is HTML, tries the search-engine-unwrap version
// (Safari from Google Images sends the /imgres?imgurl=… wrapper);
// only if both image attempts fail does it fall back to capturing
// the page as a URL-kind save.
async function handleDockDropUrl(url, deps) {
  const { saveImageFromUrl, insertSave, captureUrl, unwrapSearchEngineUrl } = deps;
  const candidates = [url];
  const unwrapped = unwrapSearchEngineUrl(url);
  if (unwrapped && unwrapped !== url) candidates.unshift(unwrapped);

  let sawHtml = false;
  for (const candidate of candidates) {
    try {
      const imgData = await saveImageFromUrl(candidate);
      if (imgData.duplicateOf) {
        try { notifyDuplicateInRenderer(imgData.existing); }
        catch (err) { console.error('[gatheros] notifyDuplicate failed:', err); }
      } else {
        const record = insertSave(imgData);
        try { notifySaved(record); }
        catch (err) { console.error('[gatheros] notifySaved failed:', err); }
      }
      return;
    } catch (err) {
      const msg = String(err?.message || err);
      if (/not an image/i.test(msg)) sawHtml = true;
      console.warn('[gatheros] Dock-drop image attempt failed:', candidate, msg);
    }
  }

  // Every image attempt errored. If at least one came back as HTML,
  // the user dragged a page (Safari's quirk). Fall back to URL-kind
  // capture so we save something useful instead of erroring.
  if (!sawHtml) return;
  console.log('[gatheros] Dock-drop URL is a page, not an image — capturing as URL-kind save:', url);
  try {
    const captured = await captureUrl(url);
    if (captured.duplicateOf) {
      try { notifyDuplicateInRenderer(captured.existing); }
      catch (e) { console.error('[gatheros] notifyDuplicate failed:', e); }
    } else {
      const record = insertSave({ ...captured, sourceUrl: url, kind: 'url' });
      try { notifySaved(record); }
      catch (e) { console.error('[gatheros] notifySaved failed:', e); }
    }
  } catch (captureErr) {
    console.error('[gatheros] Dock-drop URL capture also failed:', url, captureErr?.message || captureErr);
    notifyError('Couldn\u2019t save the dropped link \u2014 try saving it from inside the app');
  }
}

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
  if (!require('./entitlement').canCreateSave()) {
    dockOpenUrlQueue.length = 0;
    try { notifyNeedsUpgrade({ source: 'save' }); } catch { /* ignore */ }
    return;
  }
  const { saveImageFromUrl } = require('./storage');
  const { insertSave } = require('./db');
  const { captureUrl } = require('./urlCapture');
  const { unwrapSearchEngineUrl } = require('../shared/unwrapSearchUrl');
  while (dockOpenUrlQueue.length > 0) {
    const url = dockOpenUrlQueue.shift();
    await handleDockDropUrl(url, {
      saveImageFromUrl, insertSave, captureUrl, unwrapSearchEngineUrl,
    });
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
      // Required so an <img crossOrigin="anonymous"> served over
      // this scheme produces an un-tainted canvas — the eyedropper
      // needs getImageData() against the focused image, which
      // throws SecurityError on tainted canvases.
      corsEnabled: true,
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
  // Video formats — used by X-bookmark video saves and any future
  // video-kind capture path. Required for the <video> element to
  // resolve a playable MIME via the moodmark-file:// protocol.
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
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
    const stat = fs.statSync(abs);
    const fileSize = stat.size;

    // CORS allow-all so an <img crossOrigin="anonymous"> loaded from
    // this scheme produces an un-tainted canvas. The FocusedView
    // eyedropper calls getImageData() against the focused image,
    // which throws SecurityError on a tainted canvas. Same scheme is
    // used everywhere in-app so allow-all is the right answer; the
    // renderer is the only consumer.
    const corsHeader = { 'Access-Control-Allow-Origin': '*' };

    // Honour Range requests for streaming media. HTML5 <video> can't
    // seek without 206 Partial Content responses — without this, the
    // user can play a video bookmark linearly but dragging the
    // timeline scrubber does nothing because the browser asks for a
    // byte range and we hand back the full file.
    const range = req.headers.get('range');
    if (range && fileSize > 0) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        if (start >= 0 && end < fileSize && start <= end) {
          const chunkSize = end - start + 1;
          const stream = fs.createReadStream(abs, { start, end });
          return new Response(Readable.toWeb(stream), {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              ...corsHeader,
            },
          });
        }
      }
    }

    return new Response(Readable.toWeb(fs.createReadStream(abs)), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        // Advertise range support so <video> probes the file with a
        // 0-1 byte range on load and then knows it can seek freely.
        'Accept-Ranges': 'bytes',
        ...corsHeader,
      },
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

// Quiet, batched save path for X bookmark syncs. Scrolling the
// bookmarks list fires a save per tweet that comes into view; routing
// each through notifySaved would flood the grid with land-animations,
// toasts and sounds. Instead we keep the background AI index, swallow
// the per-item UI, and emit one "Synced N bookmarks" summary plus a
// single grid refresh after the burst settles.
let bookmarkBatchCount = 0;
let bookmarkBatchFailed = 0;
let bookmarkBatchTimer = null;
let bookmarkBatchStartedAt = 0;
function flushBookmarkBatch() {
  if (bookmarkBatchTimer) { clearTimeout(bookmarkBatchTimer); bookmarkBatchTimer = null; }
  const count = bookmarkBatchCount;
  const failed = bookmarkBatchFailed;
  bookmarkBatchCount = 0;
  bookmarkBatchFailed = 0;
  bookmarkBatchStartedAt = 0;
  if (count <= 0 && failed <= 0) return;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bookmarks:synced', { count, failed });
    }
  } catch (err) { console.error('[gatheros] bookmarks:synced send failed:', err); }
  try { rebuildTrayMenu(); }
  catch (err) { console.error('[gatheros] rebuildTrayMenu failed:', err); }
}
function notifyBookmarkFailed() {
  if (bookmarkBatchCount === 0 && bookmarkBatchFailed === 0) bookmarkBatchStartedAt = Date.now();
  bookmarkBatchFailed += 1;
  if (bookmarkBatchTimer) clearTimeout(bookmarkBatchTimer);
  bookmarkBatchTimer = setTimeout(flushBookmarkBatch, 1500);
}

function notifyBookmarkSaved(record) {
  // Keep search working — embeddings still index in the background.
  try { maybeAIIndexInBackground(record); }
  catch (err) { console.error('[gatheros] AI index failed:', err); }
  if (bookmarkBatchCount === 0) bookmarkBatchStartedAt = Date.now();
  bookmarkBatchCount += 1;
  // Flush after 1.5s of quiet, OR force one every ~5s during a long
  // continuous sync so the grid still trickles in instead of waiting
  // for the entire backlog to finish.
  if (Date.now() - bookmarkBatchStartedAt >= 5000) {
    flushBookmarkBatch();
  } else {
    if (bookmarkBatchTimer) clearTimeout(bookmarkBatchTimer);
    bookmarkBatchTimer = setTimeout(flushBookmarkBatch, 1500);
  }
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

// A fire-and-forget save (global-hotkey screenshot) was blocked by the
// free tier. Bring the window forward and let the renderer pop the
// upgrade prompt — otherwise the capture would silently no-op.
function notifyNeedsUpgrade(context) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('save:needs-upgrade', context || {});
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
  const wantSemantic = getPref('semanticSearch', true);
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
      // FocusedView's URL-kind saves render the live site in a
      // <webview> tag. Off by default in modern Electron for
      // security — we own the renderer + scrub framing headers in
      // the webview's session below, so it's safe to enable.
      webviewTag: true,
    },
  });

  // Re-apply maximized / fullscreen flags after construction (they
  // can't be passed to the BrowserWindow constructor on macOS).
  if (winState.isFullScreen) mainWindow.setFullScreen(true);
  else if (winState.isMaximized) mainWindow.maximize();

  trackWindowState(mainWindow);

  // Cold-launched just to save a bookmark? Stay in the background —
  // the window opens later when the user actually reaches for the app
  // (Dock click → app.on('activate'), or the tray menu). Showing it
  // here would defeat the whole point of the background save launch.
  mainWindow.once('ready-to-show', () => {
    if (!LAUNCHED_FOR_BG_SAVE) mainWindow.show();
  });

  // Renderer is ready to receive IPC events. Drain any queued
  // licensing deep-links that arrived before this point.
  mainWindow.webContents.once('did-finish-load', () => {
    rendererReady = true;
    drainLicenseTokenQueue();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Forward fullscreen state changes to the renderer so the
  // Spaces "Present" button can swap to "Stop" and back when the
  // user exits via the green stoplight or ⌃⌘F.
  const sendFsState = (on) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen-changed', on);
    }
  };
  mainWindow.on('enter-full-screen', () => sendFsState(true));
  mainWindow.on('leave-full-screen', () => sendFsState(false));

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
  // Mark as a template image so macOS handles the colour treatment:
  // black in light mode, white in dark mode, dimmed when the menu bar
  // is inactive. Requires the PNG itself to be pure black + alpha —
  // any colour in the source bleeds through unchanged.
  icon.setTemplateImage(true);
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
    if (!require('./entitlement').canCreateSave()) {
      try { notifyNeedsUpgrade({ source: 'save' }); } catch { /* ignore */ }
      return;
    }
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
  // Closing + reopening the DB picks up the new active path.
  reopenDatabase();
  // Make sure the now-active library has its images/ + thumbs/ dirs.
  // Dirs are derived per-call, but they still have to exist before the
  // first save writes into them — older libraries (or any created
  // before this guard) may be missing them.
  ensureStorageDirs();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('library:switched', { activeId: id });
  }
  rebuildTrayMenu();
  return { ok: true };
});

// Strip framing-block headers from every response served to the
// sessions we render third-party pages in — the URL-capture
// hidden window AND the FocusedView <webview>. Sites set these
// headers to refuse being iframed; Electron lets us scrub them so
// the same workaround Eagle uses works here too. Scoped to the
// two partitions we control; everything else (main window, etc.)
// keeps the headers intact.
const URL_RENDER_PARTITIONS = ['persist:url-capture', 'persist:url-view'];

function stripFramingHeaders(sessionInstance) {
  sessionInstance.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    // Header keys arrive normalized-case from Chromium but be
    // defensive — match case-insensitively.
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-frame-options') {
        delete headers[key];
      } else if (lower === 'content-security-policy') {
        // Strip just the frame-ancestors directive; leave the rest
        // of the CSP intact so JS / image / connect-src rules the
        // page set up still apply.
        const values = Array.isArray(headers[key]) ? headers[key] : [headers[key]];
        const cleaned = values
          .map((v) => v.replace(/(^|;)\s*frame-ancestors[^;]*;?/gi, '$1').trim())
          .filter(Boolean);
        if (cleaned.length === 0) delete headers[key];
        else headers[key] = cleaned;
      }
    }
    callback({ responseHeaders: headers });
  });
}

app.whenReady().then(() => {
  // Install the header-strip on the partitions the URL features use.
  // session.fromPartition lazily creates the session if it doesn't
  // exist, so doing this before the first capture / webview mount
  // is safe.
  for (const p of URL_RENDER_PARTITIONS) {
    try { stripFramingHeaders(session.fromPartition(p)); }
    catch (err) { console.warn(`[gatheros] header-strip on ${p} failed:`, err?.message || err); }
  }

  if (process.platform === 'darwin') {
    // Drive the macOS native chrome (title bar text, traffic-light
    // hover state, native scrollbars) off the same prefs.theme value
    // the renderer applies to <html data-theme>.
    const settings = require('./settings');
    const themePref = settings.getPref('theme', 'light');
    nativeTheme.themeSource = themePref === 'dark' ? 'dark' : 'light';
    // Match the Dock icon in dev to the packaged build. electron-builder
    // bakes build/icon.icns into the bundle at release time, but in
    // `npm run dev` macOS falls back to Electron's default icon. Setting
    // it explicitly at runtime keeps the visual identity consistent.
    try {
      const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.icns');
      if (fs.existsSync(iconPath) && app.dock) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }
    } catch (err) {
      console.warn('[gatheros] dock.setIcon failed:', err?.message || err);
    }
  }
  setSaveNotifier(notifySaved);
  // Clicking the save toast opens the asset inside Gather — reuse the
  // tray's "bring the app forward and open this save" flow.
  setSaveOpener(openSaveFromTray);
  setDuplicateNotifier(notifyDuplicateInRenderer);
  setNeedsUpgradeNotifier(notifyNeedsUpgrade);
  setBookmarkNotifier(notifyBookmarkSaved);
  setBookmarkFailedNotifier(notifyBookmarkFailed);
  // Generic error line for fire-and-forget paths (dock drops etc.) —
  // previously these only logged, which reads as data loss.
  setErrorNotifier((message) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:error-toast', { message: String(message || 'Something went wrong') });
      }
    } catch (err) { console.error('[gatheros] error toast send failed:', err); }
  });
  setTrayRefresher(rebuildTrayMenu);
  registerMoodmarkFileProtocol();
  // Bootstrap the library registry first — moves any pre-multi-
  // library data into a default library folder so the DB and image
  // dirs initialize against the right path on the next call.
  libraryRegistry.bootstrap();
  ensureStorageDirs();
  initDatabase();
  // Decide the local no-account trial start on first launch (idempotent;
  // also done lazily inside getEntitlement). MUST run after initDatabase
  // so isNewInstall() can read the real library count — otherwise an
  // existing no-account user (with saves but no session) would be misread
  // as a fresh install and wrongly handed a 14-day trial.
  try { require('./entitlement').ensureTrialDecided(); }
  catch (err) { console.warn('[gatheros] trial init failed:', err?.message || err); }
  registerIpcHandlers();
  createMainWindow();
  // Apply the macOS application menu now that mainWindow exists so
  // the menu can target webContents.send() at the right window.
  const { buildAppMenu } = require('./menu');
  Menu.setApplicationMenu(buildAppMenu({ getMainWindow: () => mainWindow }));
  createTray();
  registerCaptureHotkey();
  extensionServer.start();
  // Drop the native-messaging host manifest into every Chromium-
  // family browser's user dir so the extension can connect without
  // the user ever touching the filesystem.
  try { require('./native-host-installer').install(); } catch (err) {
    console.warn('[native-host] install failed:', err?.message || err);
  }
  initUpdater(mainWindow);

  // Trash auto-purge: if the Settings → "Auto-empty trash" pref is
  // > 0, hard-delete any soft-trashed saves older than that retention
  // window. Runs once at boot; users get fresh state without us
  // having to schedule a background sweep.
  //
  // MIN_TRASH_PURGE_DAYS is a defense-in-depth floor: the UI <select>
  // already only offers 7/14/30/90, but settings.json is plain text
  // and could be hand-edited (or set by a future bug) to a value
  // that would wipe a user's whole trash on the next launch. Refuse
  // anything less than a week — anything tighter than that crosses
  // the line from "auto-empty" to "footgun".
  const MIN_TRASH_PURGE_DAYS = 7;
  try {
    const settings = require('./settings');
    const rawDays = Number(settings.getPref('trashAutoEmptyDays', 0)) || 0;
    if (rawDays > 0 && rawDays < MIN_TRASH_PURGE_DAYS) {
      console.warn(`[trash] auto-purge floor: requested ${rawDays}d, ignoring (min ${MIN_TRASH_PURGE_DAYS}d)`);
    } else if (rawDays >= MIN_TRASH_PURGE_DAYS) {
      const cutoff = Date.now() - rawDays * 24 * 60 * 60 * 1000;
      const { purgeTrashBefore } = require('./db');
      const { deleteImageFiles } = require('./storage');
      const result = purgeTrashBefore(cutoff);
      if (result?.ok && result.ids.length > 0) {
        console.log(`[trash] auto-purged ${result.ids.length} saves older than ${rawDays}d`);
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
    // Check for mainWindow specifically, not BrowserWindow.getAllWindows().
    // The toast helper keeps a hidden BrowserWindow alive whenever a
    // notification has fired, so getAllWindows().length is rarely 0
    // after the user has interacted with the app at all. If we only
    // gated on the all-windows count, clicking the Dock icon after
    // closing the main window would silently do nothing.
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
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
  extensionServer.stop();
  closeDatabase();
});
