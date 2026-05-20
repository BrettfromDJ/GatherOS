const { BrowserWindow, screen, app } = require('electron');
const path = require('node:path');

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

const TOAST_WIDTH = 300;
const TOAST_HEIGHT = 340;
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
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-toast.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Renderer is sandboxed; preload only needs electron's
      // ipcRenderer + contextBridge which both work under sandbox.
      sandbox: true,
    },
  });

  toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  toastWin.setAlwaysOnTop(true, 'floating');
  // Start click-through; enabled only when there's a toast to interact with.
  toastWin.setIgnoreMouseEvents(true, { forward: true });

  toastWin.webContents.once('did-finish-load', () => {
    ready = true;
    const items = pending;
    pending = [];
    for (const p of items) toastWin.webContents.send('toast:show', p);
    if (items.length > 0 && !toastWin.isVisible()) toastWin.showInactive();
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
  if (ready) {
    win.webContents.send('toast:show', record);
    if (!win.isVisible()) win.showInactive();
  } else {
    pending.push(record);
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

// Called by the renderer once every toast has been dismissed. Hide the
// window so it doesn't sit as a transparent compositing surface eating
// GPU. Shown again the next time showToast() fires.
function onToastsEmpty() {
  setToastInteractive(false);
  if (toastWin && !toastWin.isDestroyed()) toastWin.hide();
}

module.exports = {
  showToast,
  destroyToastWindow,
  setToastInteractive,
  onToastsEmpty,
};
