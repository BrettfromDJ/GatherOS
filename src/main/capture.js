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
let _mainWindow = null;

function setMainWindow(win) {
  _mainWindow = win;
}

function registerCaptureHotkey() {
  globalShortcut.register('CommandOrControl+Shift+S', startScreenshotCapture);
}

function unregisterCaptureHotkey() {
  globalShortcut.unregisterAll();
}

async function ensureScreenRecordingPermission() {
  if (process.platform !== 'darwin') return true;

  let status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return true;

  // Calling desktopCapturer.getSources() triggers the system prompt the
  // first time. After the user responds, the status updates.
  try {
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
  } catch {
    // Ignore — we'll re-check status below.
  }

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
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');

  overlayWin.webContents.session.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0] });
    });
  });

  overlayWin.on('closed', () => { overlayWin = null; });

  if (isDev) {
    overlayWin.loadURL(`${DEV_URL}/overlay.html`);
  } else {
    overlayWin.loadFile(
      path.join(__dirname, '..', '..', 'dist', 'renderer', 'overlay.html'),
    );
  }
}

async function handleOverlayComplete(dataUrl) {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.close();
  }

  const { saveImageFromBase64 } = require('./storage');
  const { insertSave } = require('./db');

  try {
    const imgData = await saveImageFromBase64(dataUrl);
    const record = insertSave(imgData);
    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('save:created', record);
    }
  } catch (err) {
    console.error('Failed to save screenshot:', err);
  }
}

function handleOverlayCancel() {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.close();
  }
}

module.exports = {
  setMainWindow,
  registerCaptureHotkey,
  unregisterCaptureHotkey,
  startScreenshotCapture,
  handleOverlayComplete,
  handleOverlayCancel,
};
