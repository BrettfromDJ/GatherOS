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

// One BrowserWindow per display, all opened at once. A single
// spanning window doesn't render reliably across displays with
// different scale factors on macOS — Chromium picks one display to
// paint on and the others get nothing — so we open per-display
// overlays. Map<windowId, { win, display }> so the complete-handler
// can look up which display sent the rect.
const overlayWins = new Map();
let escRegistered = false;

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

  try {
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
  } catch {}

  status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return true;

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

function closeAllOverlays() {
  for (const entry of overlayWins.values()) {
    if (entry.win && !entry.win.isDestroyed()) {
      try { entry.win.close(); } catch {}
    }
  }
  overlayWins.clear();
  if (escRegistered) {
    try { globalShortcut.unregister('Escape'); } catch {}
    escRegistered = false;
  }
}

async function startScreenshotCapture() {
  if (overlayWins.size > 0) return;

  const ok = await ensureScreenRecordingPermission();
  if (!ok) return;

  const displays = screen.getAllDisplays();
  console.log('[capture] opening overlays for', displays.length, 'displays');

  // One Escape registration shared by every overlay.
  try {
    escRegistered = globalShortcut.register('Escape', () => {
      handleOverlayCancel();
    });
  } catch {}

  for (const display of displays) {
    const { x, y, width, height } = display.bounds;
    const win = new BrowserWindow({
      x, y, width, height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      // Don't compete for keyboard focus — only one window can be
      // "frontmost" at a time on macOS, and the unfocused overlay's
      // cursor lags the focused one's (default arrow until first
      // mousedown). Marking both non-focusable means macOS tracks
      // cursor purely by which window the pointer is over, so the
      // crosshair shows immediately on either monitor. Escape still
      // works because it's registered via globalShortcut, not the
      // renderer's keydown listener.
      focusable: false,
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
    win.setBounds({ x, y, width, height });
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(false);

    overlayWins.set(win.id, { win, display });

    win.on('closed', () => {
      overlayWins.delete(win.id);
      if (overlayWins.size === 0 && escRegistered) {
        try { globalShortcut.unregister('Escape'); } catch {}
        escRegistered = false;
      }
    });

    if (isDev) {
      win.loadURL(`${DEV_URL}/overlay.html`);
    } else {
      win.loadFile(
        path.join(__dirname, '..', '..', 'dist', 'renderer', 'overlay.html'),
      );
    }

    console.log('[capture] opened overlay for display', display.id, 'at', win.getBounds());
  }
}

async function handleOverlayComplete(rect, senderWebContents) {
  // Identify which overlay (and therefore which display) the rect
  // came from. Without this we can't tell monitor 1 from monitor 2.
  const senderWin = senderWebContents
    ? BrowserWindow.fromWebContents(senderWebContents)
    : null;
  const entry = senderWin ? overlayWins.get(senderWin.id) : null;
  if (!entry) {
    console.error('[capture] overlay-complete from unknown sender; ignoring');
    closeAllOverlays();
    return;
  }
  const { win, display } = entry;

  // Hide every overlay before capturing so none appear in the shot.
  for (const e of overlayWins.values()) {
    try { e.win.setOpacity(0); } catch {}
    try { e.win.hide(); } catch {}
  }

  // Hard kill-switch — overlays must not linger if anything below stalls.
  const killTimer = setTimeout(() => closeAllOverlays(), 4000);

  // Give the compositor a frame to render without the overlay.
  await new Promise((r) => setTimeout(r, 120));

  try {
    const cropped = await captureAndCrop(rect, display);
    closeAllOverlays();

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
    closeAllOverlays();
  } finally {
    clearTimeout(killTimer);
  }
}

// rect is in CSS pixels relative to the overlay window for `display`.
// Since each overlay sits at exactly that display's bounds, rect is
// already in display-local CSS coords — no translation needed.
async function captureAndCrop(rect, display) {
  const sharp = require('sharp');
  const sf = display.scaleFactor || 1;

  console.log('[capture] rect (display-local CSS px):', rect);
  console.log('[capture] target display:', {
    id: display.id, bounds: display.bounds, size: display.size, scaleFactor: sf,
  });

  const clampedLeft = Math.max(0, Math.min(display.bounds.width - 1, rect.x));
  const clampedTop = Math.max(0, Math.min(display.bounds.height - 1, rect.y));
  const clampedRight = Math.max(clampedLeft + 1, Math.min(display.bounds.width, rect.x + rect.w));
  const clampedBottom = Math.max(clampedTop + 1, Math.min(display.bounds.height, rect.y + rect.h));

  const targetWidth = Math.round(display.size.width * sf);
  const targetHeight = Math.round(display.size.height * sf);

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: targetWidth, height: targetHeight },
  });
  console.log('[capture] desktopCapturer sources:', sources.map((s, i) => ({
    idx: i,
    display_id: s.display_id,
    name: s.name,
    thumbSize: s.thumbnail.getSize(),
  })));

  let source = sources.find((s) => Number(s.display_id) === display.id);
  let matchVia = 'display_id';
  if (!source) {
    const allDisplays = screen.getAllDisplays();
    const idx = allDisplays.findIndex((d) => d.id === display.id);
    if (idx >= 0 && sources[idx]) {
      source = sources[idx];
      matchVia = `index ${idx}`;
    }
  }
  if (!source) {
    console.error('[capture] no desktopCapturer source for display', display.id);
    throw new Error('Could not locate screen source for the active display.');
  }
  console.log('[capture] matched source via', matchVia);

  const pngBuffer = source.thumbnail.toPNG();
  const thumbSize = source.thumbnail.getSize();
  const scaleX = thumbSize.width / display.bounds.width;
  const scaleY = thumbSize.height / display.bounds.height;
  const left = Math.max(0, Math.min(thumbSize.width - 1, Math.round(clampedLeft * scaleX)));
  const top = Math.max(0, Math.min(thumbSize.height - 1, Math.round(clampedTop * scaleY)));
  const width = Math.max(1, Math.min(thumbSize.width - left, Math.round((clampedRight - clampedLeft) * scaleX)));
  const height = Math.max(1, Math.min(thumbSize.height - top, Math.round((clampedBottom - clampedTop) * scaleY)));

  console.log('[capture] final crop in thumbnail (device px):', { left, top, width, height, thumbSize });

  return sharp(pngBuffer).extract({ left, top, width, height }).png().toBuffer();
}

function handleOverlayCancel() {
  closeAllOverlays();
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
  let source = sources.find((s) => Number(s.display_id) === display.id);
  if (!source) {
    const allDisplays = screen.getAllDisplays();
    const idx = allDisplays.findIndex((d) => d.id === display.id);
    if (idx >= 0 && sources[idx]) source = sources[idx];
  }
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

async function padWindowImage(pngBuffer) {
  const sharp = require('sharp');
  const PAD = 48;
  const BG = { r: 235, g: 235, b: 235, alpha: 1 };
  return sharp(pngBuffer)
    .extend({
      top: PAD, bottom: PAD, left: PAD, right: PAD,
      background: BG,
    })
    .flatten({ background: BG })
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
