const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');

const { initDatabase, closeDatabase } = require('./db');
const { ensureStorageDirs, saveImageFromFile } = require('./storage');
const { insertSave } = require('./db');
const { registerIpcHandlers } = require('./ipc');
const { setMainWindow, registerCaptureHotkey, unregisterCaptureHotkey, startScreenshotCapture } = require('./capture');

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

let mainWindow = null;
let tray = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: '#1c1c1e',
    vibrancy: process.platform === 'darwin' ? 'sidebar' : undefined,
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  setMainWindow(mainWindow);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    setMainWindow(null);
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
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
  const icon = buildTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Moodmark');

  const menu = Menu.buildFromTemplate([
    { label: 'Open Moodmark', click: () => {
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
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('save:created', record);
        }
      } catch (err) {
        console.error('Tray drop failed:', err);
      }
    }
  });
}

app.whenReady().then(() => {
  ensureStorageDirs();
  initDatabase();
  registerIpcHandlers();
  createMainWindow();
  createTray();
  registerCaptureHotkey();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  unregisterCaptureHotkey();
  closeDatabase();
});
