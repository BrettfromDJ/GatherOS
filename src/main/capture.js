const {
  globalShortcut,
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


// Default accelerator if no pref is set / pref returns junk.
const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+S';

let activeAccelerator = null;

// Free-tier guard for the hotkey-triggered screenshot paths. These are
// fire-and-forget (no IPC return value), so on a block we surface the
// upgrade prompt in the window via notify rather than silently no-op.
// Fails OPEN — any error resolving entitlement allows the capture.
function blockedByFreeTier(context) {
  try {
    const { canCreateSave } = require('./entitlement');
    if (canCreateSave()) return false;
    const { notifyNeedsUpgrade } = require('./notify');
    notifyNeedsUpgrade({ source: context });
    return true;
  } catch {
    return false;
  }
}

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

// Dialog-free probe for the onboarding capture step — lets the
// renderer frame the macOS Screen Recording ask BEFORE the user hits
// the shortcut, instead of the permission dialog ambushing the first
// real capture. Returns 'granted' | 'denied' | 'not-determined' |
// 'restricted' | 'unknown' ('granted' on non-macOS).
function getScreenPermissionStatus() {
  if (process.platform !== 'darwin') return 'granted';
  try { return systemPreferences.getMediaAccessStatus('screen'); }
  catch { return 'unknown'; }
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

// Area capture hands off to macOS's native `screencapture -i -s` so
// the user gets the OS-native crosshair, dimmed selection rectangle,
// W×H readout, modifier-key behaviour (shift to lock axis, option to
// size from centre), and — most importantly — a cursor that works
// reliably across every connected display. Our previous in-app
// overlay couldn't get the CSS crosshair to render on a second
// monitor because macOS only refreshes the cursor on the frontmost
// window. Letting the OS draw its own UI sidesteps the whole problem.
async function startScreenshotCapture() {
  if (process.platform !== 'darwin') {
    console.warn('[capture] area capture is macOS-only');
    return;
  }
  if (blockedByFreeTier('screenshot')) return;

  const ok = await ensureScreenRecordingPermission();
  if (!ok) return;

  const tmpPath = path.join(os.tmpdir(), `gatheros-area-${Date.now()}.png`);
  console.log('[capture] screencapture -i -s →', tmpPath);

  try {
    await new Promise((resolve, reject) => {
      // -i: interactive selection UI
      // -s: only allow rect selection (don't toggle to window mode on space)
      // -x: no shutter sound
      // -t png: PNG output
      const proc = spawn('/usr/sbin/screencapture', [
        '-i', '-s', '-x', '-t', 'png', tmpPath,
      ]);
      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`screencapture exited with ${code} ${stderr.trim()}`));
      });
      proc.on('error', reject);
    });

    // Give the FS a beat to flush before we read.
    await new Promise((r) => setTimeout(r, 80));

    if (!fs.existsSync(tmpPath)) {
      // No file means the user pressed Escape — nothing to save.
      console.log('[capture] user cancelled area capture');
      return;
    }

    const buf = fs.readFileSync(tmpPath);
    writeToDropFolder(buf);
    await persistScreenshot(buf);
  } catch (err) {
    console.error('[capture] area capture failed:', err);
  } finally {
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
}

// Shared tail for every screenshot path: store the buffer, detect a
// duplicate, insert the save, auto-tag it #screenshot (so screenshots
// are filterable/searchable as a group), and fire the right
// notification. Returns the record (or the existing dup).
async function persistScreenshot(buf, ext = 'png') {
  const { saveImageFromBuffer } = require('./storage');
  const { insertSave, addTagToSave } = require('./db');
  const { notifySaved, notifyDuplicate } = require('./notify');
  const imgData = await saveImageFromBuffer(buf, ext);
  const tag = (saveId) => {
    try { addTagToSave({ saveId, name: 'screenshot' }); }
    catch (err) { console.warn('[capture] auto-tag #screenshot failed:', err); }
  };
  if (imgData.duplicateOf) {
    tag(imgData.existing.id); // idempotent — keeps the existing copy tagged
    notifyDuplicate(imgData.existing);
    return imgData.existing;
  }
  const record = insertSave(imgData);
  tag(record.id);
  notifySaved(record);
  return record;
}

// Capture the entire display under the cursor in one shot — no
// overlay, no picker. Saves straight to the active library.
async function captureFullscreen() {
  if (blockedByFreeTier('screenshot')) return;
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
    await persistScreenshot(png);
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
  if (blockedByFreeTier('screenshot')) return;

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
    const record = await persistScreenshot(framed);
    console.log('[gatheros] captureWindow: saved/dup', record?.id);
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
  captureFullscreen,
  captureWindow,
  getScreenPermissionStatus,
};
