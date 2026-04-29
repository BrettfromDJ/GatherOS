// Persists the main window's size + position across launches.
//
// Stored as a small JSON blob in userData. On boot we read the file,
// sanity-check the bounds against currently-attached displays (so a
// window saved on a now-disconnected external monitor doesn't restore
// off-screen), and feed them into the BrowserWindow constructor.
// While the window is open, we listen for resize/move/close and
// debounce-write the latest bounds back to disk.

const { app, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILENAME = 'window-state.json';
const DEFAULTS = { width: 1280, height: 820 };
const MIN_WIDTH = 960;
const MIN_HEIGHT = 600;
const SAVE_DEBOUNCE_MS = 400;

function statePath() {
  return path.join(app.getPath('userData'), FILENAME);
}

function readState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

// Reject saved bounds that fall outside any current display, so we
// don't open the window onto a monitor that's no longer attached.
function boundsAreVisible(bounds) {
  if (!bounds) return false;
  const { x, y, width, height } = bounds;
  if (
    typeof x !== 'number' || typeof y !== 'number' ||
    typeof width !== 'number' || typeof height !== 'number' ||
    width < MIN_WIDTH || height < MIN_HEIGHT
  ) return false;
  const displays = screen.getAllDisplays();
  // Require at least 200×200 of the saved rect to land inside some
  // display — partial overlap is fine, totally off-screen is not.
  return displays.some((d) => {
    const work = d.workArea;
    const overlapX = Math.max(0, Math.min(x + width, work.x + work.width) - Math.max(x, work.x));
    const overlapY = Math.max(0, Math.min(y + height, work.y + work.height) - Math.max(y, work.y));
    return overlapX >= 200 && overlapY >= 200;
  });
}

// Resolve the bounds + flags to feed BrowserWindow at construction
// time. Falls back to centered defaults when nothing's saved or the
// saved geometry is no longer reachable.
function getInitialOptions() {
  const saved = readState();
  const bounds = saved?.bounds;
  if (boundsAreVisible(bounds)) {
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: !!saved.isMaximized,
      isFullScreen: !!saved.isFullScreen,
    };
  }
  return {
    width: DEFAULTS.width,
    height: DEFAULTS.height,
    isMaximized: false,
    isFullScreen: false,
  };
}

// Attach listeners that debounce-persist the window's state. Returns
// a teardown function (mostly useful for tests; the main process
// keeps these alive for the lifetime of the app).
function track(win) {
  let saveTimer = null;

  function snapshot() {
    if (win.isDestroyed()) return null;
    // Only capture "normal" bounds — when fullscreen or maximized
    // we want the *last* restored size persisted, not the screen-
    // filling rect, so that toggling out lands at a sensible size.
    const bounds = win.isFullScreen() || win.isMaximized()
      ? (snapshot.lastNormal || win.getNormalBounds?.() || win.getBounds())
      : win.getBounds();
    snapshot.lastNormal = bounds;
    return {
      bounds,
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
    };
  }

  function persist() {
    const state = snapshot();
    if (!state) return;
    try {
      fs.mkdirSync(path.dirname(statePath()), { recursive: true });
      fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('[window-state] persist failed:', err.message);
    }
  }

  function schedule() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, SAVE_DEBOUNCE_MS);
  }

  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('enter-full-screen', schedule);
  win.on('leave-full-screen', schedule);
  // close fires before the bounds are gone; flush synchronously so
  // we don't lose the final state to a debounce that never fires.
  win.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persist();
  });

  return () => {
    if (saveTimer) clearTimeout(saveTimer);
  };
}

module.exports = { getInitialOptions, track };
