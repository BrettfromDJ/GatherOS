// Quick-search popover anchored under the menu bar tray icon. Lets the
// user search the library + grab a ref ("copy", "drag-out", "reveal in
// app") without raising the full main window.
//
// Lifecycle:
//   • Lazy-created on first show; reused thereafter.
//   • Auto-hides on blur (clicking outside dismisses).
//   • Re-positioned every show so it tracks the tray icon if the menu
//     bar items shift.

const { BrowserWindow, screen, app } = require('electron');
const path = require('node:path');

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

const POPOVER_WIDTH = 360;
const POPOVER_HEIGHT = 440;

let popoverWin = null;

function ensurePopover() {
  if (popoverWin && !popoverWin.isDestroyed()) return popoverWin;

  popoverWin = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    acceptFirstMouse: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-tray-search.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  popoverWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popoverWin.setAlwaysOnTop(true, 'floating');

  // Click-outside to dismiss. We hide rather than destroy so the next
  // show is instant (no reload).
  popoverWin.on('blur', () => {
    if (popoverWin && !popoverWin.isDestroyed()) popoverWin.hide();
  });

  popoverWin.on('closed', () => {
    popoverWin = null;
  });

  if (isDev) {
    popoverWin.loadURL(`${DEV_URL}/tray-search.html`);
  } else {
    popoverWin.loadFile(
      path.join(__dirname, '..', '..', 'dist', 'renderer', 'tray-search.html'),
    );
  }

  return popoverWin;
}

// Position the popover centered below the tray icon. Falls back to
// top-right of the active display if the tray bounds aren't available
// (e.g. the icon hasn't been laid out yet on cold boot).
function positionUnderTray(win, tray) {
  const trayBounds = tray?.getBounds?.();
  const winBounds = win.getBounds();
  let x;
  let y;

  if (trayBounds && trayBounds.width > 0) {
    x = Math.round(trayBounds.x + (trayBounds.width / 2) - (winBounds.width / 2));
    y = Math.round(trayBounds.y + trayBounds.height + 4);
  } else {
    const display = screen.getPrimaryDisplay();
    x = display.workArea.x + display.workArea.width - winBounds.width - 12;
    y = display.workArea.y + 4;
  }

  // Clamp to keep the popover entirely on its display.
  const display = screen.getDisplayNearestPoint({ x, y });
  const work = display.workArea;
  const safeX = Math.max(work.x + 4, Math.min(x, work.x + work.width - winBounds.width - 4));
  const safeY = Math.max(work.y + 4, y);

  win.setPosition(safeX, safeY, false);
}

function showPopover(tray) {
  const win = ensurePopover();
  positionUnderTray(win, tray);
  win.show();
  win.focus();
  // Renderer listens to clear its query and re-focus the input.
  win.webContents.send('tray-search:focus');
}

function hidePopover() {
  if (popoverWin && !popoverWin.isDestroyed()) {
    popoverWin.hide();
  }
}

function destroyPopover() {
  if (popoverWin && !popoverWin.isDestroyed()) {
    popoverWin.destroy();
  }
  popoverWin = null;
}

function isVisible() {
  return !!(popoverWin && !popoverWin.isDestroyed() && popoverWin.isVisible());
}

module.exports = { showPopover, hidePopover, destroyPopover, isVisible };
