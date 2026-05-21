// File-backed logger for the main process. Tees console.log/warn/error
// to ~/Library/Logs/GatherOS/main.log so when a user emails support
// after a crash we can ask them to send the file via "Reveal Logs in
// Finder" (Help menu).
//
// Designed to never throw — the logger silently no-ops if the file
// stream can't be opened. We don't want logging itself to take the
// app down.

const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');

const MAX_BYTES = 1024 * 1024;

let logFilePath = null;
let stream = null;
let installed = false;

function ensureStream() {
  if (stream) return stream;
  try {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, 'main.log');
    try {
      const st = fs.statSync(logFilePath);
      if (st.size > MAX_BYTES) {
        const prev = `${logFilePath}.1`;
        try { fs.unlinkSync(prev); } catch {}
        fs.renameSync(logFilePath, prev);
      }
    } catch {}
    stream = fs.createWriteStream(logFilePath, { flags: 'a' });
  } catch {
    stream = null;
  }
  return stream;
}

function format(level, args) {
  const ts = new Date().toISOString();
  const text = args.map((a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
  return `${ts} [${level}] ${text}\n`;
}

function write(level, args) {
  try {
    const s = ensureStream();
    if (s) s.write(format(level, args));
  } catch {}
}

function getLogFilePath() {
  ensureStream();
  return logFilePath;
}

function setup() {
  if (installed) return;
  installed = true;

  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...a) => { origLog(...a); write('log', a); };
  console.info = (...a) => { origInfo(...a); write('info', a); };
  console.warn = (...a) => { origWarn(...a); write('warn', a); };
  console.error = (...a) => { origError(...a); write('error', a); };

  process.on('uncaughtException', (err) => {
    write('fatal', ['uncaughtException', err]);
    if (app.isReady()) {
      try {
        dialog.showErrorBox(
          'GatherOS encountered an unexpected error',
          `${err?.message || err}\n\nA log was written to:\n${getLogFilePath()}\n\nIf this keeps happening, send the log to support via Help → Reveal Logs in Finder.`
        );
      } catch {}
    }
  });

  process.on('unhandledRejection', (reason) => {
    write('fatal', ['unhandledRejection', reason]);
  });

  // Renderer / utility / GPU process crashes — these don't bubble up
  // through uncaughtException because they're separate processes.
  // 'render-process-gone' fires when the renderer dies (OOM, GPU
  // driver crash, killed by macOS, etc.) so we at least have a
  // breadcrumb in the log.
  try {
    app.on('render-process-gone', (_event, _wc, details) => {
      write('fatal', ['render-process-gone', details]);
    });
    app.on('child-process-gone', (_event, details) => {
      write('fatal', ['child-process-gone', details]);
    });
  } catch {}

  write('info', [`GatherOS ${app.getVersion()} starting on ${process.platform}-${process.arch}`]);
}

module.exports = { setup, getLogFilePath };
