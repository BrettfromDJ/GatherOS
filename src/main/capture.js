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

  try {
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
  } catch {}

  status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return true;

  const res = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Open System Settings', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Screen Recording Permission Needed',
    message: 'Moodmark needs permission to record your screen to capture screenshots.',
    detail:
      'Click "Open System Settings", enable Screen Recording for Electron, then quit Moodmark (Ctrl+C in Terminal) and run it again with "npm run dev".',
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

module.exports = {
  registerCaptureHotkey,
  unregisterCaptureHotkey,
  startScreenshotCapture,
  handleOverlayComplete,
  handleOverlayCancel,
};
