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
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

let overlayWin = null;
// The display the current overlay is bound to — captured at open
// time so the crop step (which fires after the overlay is dismissed)
// reads pixels from the right monitor on a multi-display setup.
let overlayDisplay = null;

// Default accelerator if no pref is set / pref returns junk.
const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+S';

let activeAccelerator = null;

function readShortcutPref() {
  try {
    const settings = require('./settings');
    return settings.getPref('captureShortcut', DEFAULT_ACCELERATOR);
  } catch {
    return DEFAULT_ACCELERATOR;
  }
}

function registerCaptureHotkey() {
  applyShortcut(readShortcutPref());
}

// Swap to a new accelerator. Called by settings:set-pref's
// side-effect block when the user changes `captureShortcut` in
// the Capture settings page.
function applyShortcut(accelerator) {
  const next = accelerator || DEFAULT_ACCELERATOR;
  if (activeAccelerator) {
    try { globalShortcut.unregister(activeAccelerator); } catch {}
  }
  const registered = globalShortcut.register(next, () => {
    console.log(`[moodmark] ${next} fired`);
    startScreenshotCapture().catch((err) =>
      console.error('[moodmark] capture failed:', err),
    );
  });
  const isRegistered = globalShortcut.isRegistered(next);
  console.log(
    `[moodmark] globalShortcut.register('${next}') → returned=${registered}, isRegistered=${isRegistered}`,
  );
  if (!isRegistered) {
    console.warn(
      `[moodmark] Hotkey not registered — another app may own ${next}, or macOS is blocking it.`,
    );
    activeAccelerator = null;
  } else {
    activeAccelerator = next;
  }
}

function unregisterCaptureHotkey() {
  globalShortcut.unregisterAll();
  activeAccelerator = null;
}

// Honor the Settings → Capture → "Drop folder" preference: if a
// folder is set AND exists, write a copy of the captured buffer
// there as a real PNG file alongside saving it into the library.
// Best-effort: any failure (missing folder, permission denied,
// FS error) only logs; the in-library save is the source of truth.
function writeToDropFolder(buffer) {
  try {
    const settings = require('./settings');
    const dropFolder = settings.getPref('captureDropFolder', null);
    if (!dropFolder) return;
    if (!fs.existsSync(dropFolder)) {
      console.warn('[capture] drop-folder missing:', dropFolder);
      return;
    }
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .slice(0, 19);
    const dest = path.join(dropFolder, `GatherOS-${stamp}.png`);
    fs.writeFileSync(dest, buffer);
    console.log('[capture] copied to drop folder:', dest);
  } catch (err) {
    console.warn('[capture] drop-folder write failed:', err.message);
  }
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

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  overlayDisplay = display;
  const { x, y, width, height } = display.bounds;

  overlayWin = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    // Don't use simpleFullscreen — it locks the window to the
    // primary display on macOS regardless of the x/y passed in,
    // breaking capture on every non-primary monitor. The window is
    // already sized to display.bounds and the screen-saver always-
    // on-top level (set below) places it above the menu bar.
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

  // Re-assert the bounds after construction — on multi-display
  // setups BrowserWindow occasionally rounds x/y to the primary
  // display's origin if the OS thinks the chosen point is invalid.
  overlayWin.setBounds({ x, y, width, height });

  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(false);

  // Backstop for the renderer's keydown listener: while the overlay
  // is open, Escape is wired through the OS shortcut layer too. If
  // focus ever slips (tray menu held it, another app stole it, etc.)
  // the user can still bail out without restarting the app.
  const escAccelerator = 'Escape';
  let escRegistered = false;
  try {
    escRegistered = globalShortcut.register(escAccelerator, () => {
      handleOverlayCancel();
    });
  } catch {}

  overlayWin.on('closed', () => {
    overlayWin = null;
    overlayDisplay = null;
    if (escRegistered) {
      try { globalShortcut.unregister(escAccelerator); } catch {}
      escRegistered = false;
    }
  });

  // When launched from the tray menu, the menu keeps keyboard focus
  // by default and the overlay receives no key events. Try to steal
  // focus at every reasonable moment (creation, finish-load, show)
  // so the renderer's keydown listener actually fires.
  const stealFocus = () => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    if (process.platform === 'darwin') {
      try { app.focus({ steal: true }); } catch {}
    }
    try { overlayWin.focus(); } catch {}
  };
  overlayWin.once('ready-to-show', stealFocus);
  overlayWin.webContents.once('did-finish-load', stealFocus);
  overlayWin.on('show', stealFocus);

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

  // Hard kill-switch: no matter what happens below — capture hangs,
  // sharp throws, IPC stalls — the overlay must not linger. 4s is
  // long enough for a clean capture path on slow disks but short
  // enough that a stuck flow doesn't trap the user.
  const killTimer = setTimeout(() => {
    if (!win.isDestroyed()) {
      try { win.close(); } catch {}
    }
  }, 4000);

  // Give the compositor a frame to render without the overlay.
  await new Promise((r) => setTimeout(r, 120));

  try {
    const cropped = await captureAndCrop(rect);
    if (!win.isDestroyed()) win.close();

    writeToDropFolder(cropped);

    const { saveImageFromBuffer } = require('./storage');
    const { insertSave } = require('./db');
    const { notifySaved, notifyDuplicate } = require('./notify');
    const imgData = await saveImageFromBuffer(cropped, 'png');
    if (imgData.duplicateOf) {
      notifyDuplicate(imgData.existing);
    } else {
      const record = insertSave(imgData);
      notifySaved(record);
    }
  } catch (err) {
    console.error('Failed to capture screenshot:', err);
    if (!win.isDestroyed()) win.close();
  } finally {
    clearTimeout(killTimer);
  }
}

async function captureAndCrop(rect) {
  const sharp = require('sharp');
  const display = overlayDisplay || screen.getPrimaryDisplay();
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

// Capture the entire display under the cursor in one shot — no
// overlay, no picker. Saves straight to the active library.
async function captureFullscreen() {
  const ok = await ensureScreenRecordingPermission();
  if (!ok) return;

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
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
    const png = source.thumbnail.toPNG();
    writeToDropFolder(png);
    const { saveImageFromBuffer } = require('./storage');
    const { insertSave } = require('./db');
    const { notifySaved, notifyDuplicate } = require('./notify');
    const imgData = await saveImageFromBuffer(png, 'png');
    if (imgData.duplicateOf) {
      notifyDuplicate(imgData.existing);
    } else {
      const record = insertSave(imgData);
      notifySaved(record);
    }
  } catch (err) {
    console.error('Failed to capture fullscreen:', err);
  }
}

// Window capture: hand off to macOS's native `screencapture -w` so the
// user gets the OS-native blue hover-highlight + camera cursor for free.
// The captured PNG is then framed in a light-gray padded canvas.
async function captureWindow() {
  if (process.platform !== 'darwin') {
    console.warn('[gatheros] Window capture is macOS-only.');
    return;
  }

  const ok = await ensureScreenRecordingPermission();
  if (!ok) return;

  const tmpPath = path.join(os.tmpdir(), `gatheros-window-${Date.now()}.png`);
  console.log('[gatheros] captureWindow start →', tmpPath);

  try {
    await new Promise((resolve, reject) => {
      // -w: window selection mode (the native blue-hover UX)
      // -t png  (no -x so the shutter sound confirms it fired)
      const proc = spawn('/usr/sbin/screencapture', [
        '-w', '-t', 'png', tmpPath,
      ]);
      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.on('close', (code) => {
        console.log(
          `[gatheros] screencapture exit=${code}` +
            (stderr ? ` stderr=${stderr.trim()}` : ''),
        );
        if (code === 0) resolve();
        else reject(new Error(`screencapture exited with ${code}`));
      });
      proc.on('error', (err) => {
        console.error('[gatheros] screencapture spawn error:', err);
        reject(err);
      });
    });

    // Give the FS a beat to flush. screencapture closes its file
    // handle before exit, but sandbox / FS journaling can lag.
    await new Promise((r) => setTimeout(r, 80));

    if (!fs.existsSync(tmpPath)) {
      console.log('[gatheros] captureWindow: no file produced (user cancelled)');
      return;
    }

    const raw = fs.readFileSync(tmpPath);
    console.log(`[gatheros] captureWindow: read ${raw.length} bytes`);
    const framed = await padWindowImage(raw);

    writeToDropFolder(framed);

    const { saveImageFromBuffer } = require('./storage');
    const { insertSave } = require('./db');
    const { notifySaved, notifyDuplicate } = require('./notify');
    const imgData = await saveImageFromBuffer(framed, 'png');
    if (imgData.duplicateOf) {
      notifyDuplicate(imgData.existing);
      console.log('[gatheros] captureWindow: duplicate of', imgData.duplicateOf);
    } else {
      const record = insertSave(imgData);
      notifySaved(record);
      console.log('[gatheros] captureWindow: saved', record?.id);
    }
  } catch (err) {
    console.error('[gatheros] Failed to capture window:', err);
  } finally {
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
}

// Frame a window screenshot in a light-gray canvas with even padding
// on every side. The macOS shot already includes the system shadow on
// the alpha channel, so once we extend onto gray the shadow softens
// naturally into the surround.
async function padWindowImage(pngBuffer) {
  const sharp = require('sharp');
  const PAD = 48;
  const BG = { r: 235, g: 235, b: 235, alpha: 1 };
  return sharp(pngBuffer)
    .extend({
      top: PAD, bottom: PAD, left: PAD, right: PAD,
      background: BG,
    })
    .flatten({ background: BG }) // collapse residual transparency
    .png()
    .toBuffer();
}

module.exports = {
  registerCaptureHotkey,
  unregisterCaptureHotkey,
  applyShortcut,
  startScreenshotCapture,
  handleOverlayComplete,
  handleOverlayCancel,
  captureFullscreen,
  captureWindow,
};
