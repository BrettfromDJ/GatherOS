const {
  globalShortcut,
  BrowserWindow,
  desktopCapturer,
  screen,
  app,
  systemPreferences,
  dialog,
  shell,
} = require('electron');
const path = require('node:path');

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

let overlayWin = null;

function registerCaptureHotkey() {
  const accelerator = 'CommandOrControl+Shift+S';
  const registered = globalShortcut.register(accelerator, () => {
    console.log('[moodmark] ⌘⇧S fired');
    startScreenshotCapture().catch((err) =>
      console.error('[moodmark] capture failed:', err),
    );
  });
  const isRegistered = globalShortcut.isRegistered(accelerator);
  console.log(
    `[moodmark] globalShortcut.register('${accelerator}') → returned=${registered}, isRegistered=${isRegistered}`,
  );
  if (!isRegistered) {
    console.warn(
      '[moodmark] Hotkey not registered — another app may own ⌘⇧S, or macOS is blocking it.',
    );
  }
}

function unregisterCaptureHotkey() {
  globalShortcut.unregisterAll();
}

async function ensureScreenRecordingPermission() {
  if (process.platform !== 'darwin') return true;

  let status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return true;

  // Trigger the system permission prompt. Silently no-ops if the
  // user has already denied — getMediaAccessStatus is the source of
  // truth on the next read.
  try {
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
  } catch {}

  status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return true;

  // Still not granted (denied / restricted / dismissed prompt).
  // Walk the user to the right pane in System Settings. In dev we
  // run inside an `Electron` host binary, so that's the toggle name
  // they'll see; packaged builds appear as the product name.
  const productName = app.isPackaged ? app.getName() : 'Electron';
  const restartLine = app.isPackaged
    ? `Then quit and reopen GatherOS for the change to take effect.`
    : `Then quit and relaunch the dev session for the change to take effect.`;

  const res = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Open System Settings', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    title: 'Screen Recording permission needed',
    message: 'GatherOS needs Screen Recording to capture screenshots.',
    detail:
      `Click “Open System Settings”, then enable Screen Recording for “${productName}”.\n\n` +
      restartLine,
  });
  if (res.response === 0) {
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
  }
  return false;
}

async function startScreenshotCapture() {
  if (overlayWin) return;

  const ok = await ensureScreenRecordingPermission();
  if (!ok) return;

  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;

  overlayWin = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    simpleFullscreen: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(false);

  overlayWin.on('closed', () => { overlayWin = null; });

  if (isDev) {
    overlayWin.loadURL(`${DEV_URL}/overlay.html`);
  } else {
    overlayWin.loadFile(
      path.join(__dirname, '..', '..', 'dist', 'renderer', 'overlay.html'),
    );
  }
}

async function handleOverlayComplete(rect) {
  if (!overlayWin) return;
  const win = overlayWin;
  overlayWin = null;

  // Hide the overlay before capturing so it doesn't appear in the screenshot.
  win.setOpacity(0);
  win.hide();

  // Give the compositor a frame to render without the overlay.
  await new Promise((r) => setTimeout(r, 120));

  try {
    const cropped = await captureAndCrop(rect);
    win.close();

    const { saveImageFromBuffer } = require('./storage');
    const { insertSave } = require('./db');
    const { notifySaved } = require('./notify');
    const imgData = await saveImageFromBuffer(cropped, 'png');
    const record = insertSave(imgData);
    notifySaved(record);
  } catch (err) {
    console.error('Failed to capture screenshot:', err);
    if (!win.isDestroyed()) win.close();
  }
}

async function captureAndCrop(rect) {
  const sharp = require('sharp');
  const display = screen.getPrimaryDisplay();
  const sf = display.scaleFactor || 1;
  const targetWidth = Math.round(display.size.width * sf);
  const targetHeight = Math.round(display.size.height * sf);

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: targetWidth, height: targetHeight },
  });
  const source =
    sources.find((s) => Number(s.display_id) === display.id) || sources[0];

  const pngBuffer = source.thumbnail.toPNG();

  // Clamp the rect to the actual thumbnail size.
  const thumbSize = source.thumbnail.getSize();
  const scaleX = thumbSize.width / targetWidth;
  const scaleY = thumbSize.height / targetHeight;
  const left = Math.max(0, Math.min(thumbSize.width - 1, Math.round(rect.x * scaleX)));
  const top = Math.max(0, Math.min(thumbSize.height - 1, Math.round(rect.y * scaleY)));
  const width = Math.max(1, Math.min(thumbSize.width - left, Math.round(rect.w * scaleX)));
  const height = Math.max(1, Math.min(thumbSize.height - top, Math.round(rect.h * scaleY)));

  return sharp(pngBuffer).extract({ left, top, width, height }).png().toBuffer();
}

function handleOverlayCancel() {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.close();
  }
}

// Capture the entire primary display in one shot — no overlay,
// no picker. Saves straight to the active library.
async function captureFullscreen() {
  const ok = await ensureScreenRecordingPermission();
  if (!ok) return;

  const display = screen.getPrimaryDisplay();
  const sf = display.scaleFactor || 1;
  const targetWidth = Math.round(display.size.width * sf);
  const targetHeight = Math.round(display.size.height * sf);

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: targetWidth, height: targetHeight },
  });
  const source =
    sources.find((s) => Number(s.display_id) === display.id) || sources[0];
  if (!source) return;

  try {
    const { saveImageFromBuffer } = require('./storage');
    const { insertSave } = require('./db');
    const { notifySaved } = require('./notify');
    const imgData = await saveImageFromBuffer(source.thumbnail.toPNG(), 'png');
    const record = insertSave(imgData);
    notifySaved(record);
  } catch (err) {
    console.error('Failed to capture fullscreen:', err);
  }
}

let windowPickerWin = null;

// Window capture: pop a small picker BrowserWindow listing every
// available window with a live thumbnail. User clicks one, we save
// the thumbnail as a PNG. desktopCapturer is the source of truth —
// the picker just renders what it returns.
async function captureWindow() {
  if (windowPickerWin) {
    windowPickerWin.focus();
    return;
  }

  const ok = await ensureScreenRecordingPermission();
  if (!ok) return;

  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const PICKER_W = 560;
  const PICKER_H = 460;

  windowPickerWin = new BrowserWindow({
    x: x + Math.round((width - PICKER_W) / 2),
    y: y + Math.round((height - PICKER_H) / 2),
    width: PICKER_W,
    height: PICKER_H,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    hasShadow: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-windowpicker.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  windowPickerWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  windowPickerWin.setAlwaysOnTop(true, 'screen-saver');
  windowPickerWin.on('closed', () => { windowPickerWin = null; });

  if (isDev) {
    windowPickerWin.loadURL(`${DEV_URL}/windowpicker.html`);
  } else {
    windowPickerWin.loadFile(
      path.join(__dirname, '..', '..', 'dist', 'renderer', 'windowpicker.html'),
    );
  }
}

async function listCaptureWindows() {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 320, height: 200 },
  });
  return sources
    .filter((s) => s.thumbnail && !s.thumbnail.isEmpty())
    .map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
}

async function handleWindowPickerPick(sourceId) {
  if (!sourceId) return;
  const win = windowPickerWin;
  windowPickerWin = null;
  if (win) win.hide();

  // Re-pull the source at full resolution so we save a sharp PNG
  // rather than the 320×200 picker thumbnail.
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 3000, height: 3000 },
  });
  const source = sources.find((s) => s.id === sourceId);

  try {
    if (!source) throw new Error('Window source not found');
    const { saveImageFromBuffer } = require('./storage');
    const { insertSave } = require('./db');
    const { notifySaved } = require('./notify');
    const imgData = await saveImageFromBuffer(source.thumbnail.toPNG(), 'png');
    const record = insertSave(imgData);
    notifySaved(record);
  } catch (err) {
    console.error('Failed to capture window:', err);
  } finally {
    if (win && !win.isDestroyed()) win.close();
  }
}

function handleWindowPickerCancel() {
  if (windowPickerWin && !windowPickerWin.isDestroyed()) {
    windowPickerWin.close();
  }
}

module.exports = {
  registerCaptureHotkey,
  unregisterCaptureHotkey,
  startScreenshotCapture,
  handleOverlayComplete,
  handleOverlayCancel,
  captureFullscreen,
  captureWindow,
  listCaptureWindows,
  handleWindowPickerPick,
  handleWindowPickerCancel,
};
