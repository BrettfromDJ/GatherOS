#!/usr/bin/env node
/*
 * Pre-release smoke test for the packaged macOS app.
 *
 * Launches the built .app and watches stderr for an "Uncaught Exception"
 * banner — the exact failure mode (Cannot find module '../shared/...')
 * that shipped a broken DMG to users in v0.1.22–v0.1.24. If the main
 * process makes it past require-time without crashing, we count the
 * build as launchable and exit 0; if we see the dialog text on stderr,
 * we exit 1 so `npm run release` aborts before publish.
 *
 * Usage:
 *   node scripts/smoke-test.js [path-to-.app]
 *
 * Defaults to the arm64 build for the host machine.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_APP = path.join(
  __dirname,
  '..',
  'dist',
  'build',
  os.arch() === 'arm64' ? 'mac-arm64' : 'mac',
  'GatherOS.app',
);

const APP_DIR = process.argv[2] || DEFAULT_APP;
const BINARY = path.join(APP_DIR, 'Contents', 'MacOS', 'GatherOS');
const TIMEOUT_MS = 8000;

if (!fs.existsSync(BINARY)) {
  console.error(`[smoke-test] FAIL — binary not found at ${BINARY}`);
  console.error('[smoke-test] Did electron-builder finish? Pass the .app path explicitly if it lives elsewhere.');
  process.exit(1);
}

console.log(`[smoke-test] Launching ${BINARY}`);
console.log(`[smoke-test] Watching stderr for ${TIMEOUT_MS / 1000}s…`);

const child = spawn(BINARY, [], {
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let crashed = false;
let crashSnippet = '';

function watchStream(stream) {
  stream.on('data', (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    if (
      text.includes('Uncaught Exception')
      || text.includes('A JavaScript error occurred in the main process')
      || /Cannot find module/.test(text)
    ) {
      crashed = true;
      crashSnippet = text.slice(0, 500);
    }
  });
}
watchStream(child.stderr);
watchStream(child.stdout);

function finish(passed, reason) {
  try { child.kill('SIGKILL'); } catch {}
  if (passed) {
    console.log(`[smoke-test] PASS — ${reason}`);
    process.exit(0);
  } else {
    console.error(`[smoke-test] FAIL — ${reason}`);
    if (crashSnippet) console.error(`[smoke-test] excerpt:\n${crashSnippet}`);
    process.exit(1);
  }
}

const timer = setTimeout(() => {
  if (crashed) finish(false, 'crash detected on stderr');
  else finish(true, `survived ${TIMEOUT_MS / 1000}s without crashing`);
}, TIMEOUT_MS);

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  // We killed it ourselves — that's expected on PASS.
  if (signal === 'SIGKILL' || signal === 'SIGTERM') return;
  if (crashed || (code !== null && code !== 0)) {
    finish(false, `app exited early (code=${code} signal=${signal})`);
  } else {
    finish(false, `app exited before timeout (code=${code})`);
  }
});
