const { BrowserWindow, screen, app } = require('electron');
const path = require('node:path');

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

const TOAST_WIDTH = 280;
const TOAST_HEIGHT = 320;
const EDGE_INSET = 20;

let toastWin = null;
let ready = false;
let pending = [];

function ensureToastWindow() {
  if (toastWin && !toastWin.isDestroyed()) return toastWin;

  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;

  toastWin = new BrowserWindow({
    x: x + EDGE_INSET,
    y: y + height - TOAST_HEIGHT - EDGE_INSET,
    width: TOAST_WIDTH,
    height: TOAST_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-toast.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  toastWin.setAlwaysOnTop(true, 'floating');
  toastWin.setIgnoreMouseEvents(true, { forward: true });

  toastWin.webContents.once('did-finish-load', () => {
    ready = true;
    for (const p of pending) toastWin.webContents.send('toast:show', p);
    pending = [];
  });

  toastWin.on('closed', () => {
    toastWin = null;
    ready = false;
  });

  if (isDev) {
    toastWin.loadURL(`${DEV_URL}/toast.html`);
  } else {
    toastWin.loadFile(
      path.join(__dirname, '..', '..', 'dist', 'renderer', 'toast.html'),
    );
  }

  return toastWin;
}

function showToast(record) {
  const win = ensureToastWindow();
  if (!win.isVisible()) win.showInactive();
  if (ready) {
    win.webContents.send('toast:show', record);
  } else {
    pending.push(record);
  }
}

function hideToastWindow() {
  if (toastWin && !toastWin.isDestroyed() && toastWin.isVisible()) {
    toastWin.hide();
  }
}

function destroyToastWindow() {
  if (toastWin && !toastWin.isDestroyed()) {
    toastWin.destroy();
  }
  toastWin = null;
  ready = false;
  pending = [];
}

function setToastInteractive(interactive) {
  if (!toastWin || toastWin.isDestroyed()) return;
  toastWin.setIgnoreMouseEvents(!interactive, { forward: true });
}

module.exports = {
  showToast,
  hideToastWindow,
  destroyToastWindow,
  setToastInteractive,
};
