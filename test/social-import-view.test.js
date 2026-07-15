const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let view;
test.before(async () => {
  view = await import('../src/renderer/lib/socialImportView.mjs');
});

test('social import view labels mode, stage, and plural counts', () => {
  assert.equal(view.platformLabel('x'), 'X');
  assert.equal(view.platformLabel('instagram'), 'Instagram');
  assert.equal(view.modeLabel('catch-up'), 'Catch-up');
  assert.equal(view.stageLabel('saving'), 'Saving');
  assert.equal(view.pluralize(1, 'save'), '1 save');
  assert.equal(view.pluralize(2, 'save'), '2 saves');
});

test('social import view formats elapsed and stalled state', () => {
  const snapshot = {
    runId: 'run-1', platform: 'x', mode: 'fixed', stage: 'saving',
    scanned: 4, saved: 1, known: 2, failed: 1,
    startedAt: 1000, lastProgressAt: 31_000,
  };
  const result = view.toSocialImportView(snapshot, { now: 61_000 });
  assert.equal(result.elapsed, '1:00');
  assert.equal(result.stalled, true);
  assert.equal(result.terminal, false);
});

test('terminal view persists without auto-dismiss metadata', () => {
  const result = view.toSocialImportView({
    runId: 'run-2', platform: 'instagram', mode: 'all', stage: 'complete',
    scanned: 3, saved: 2, known: 1, failed: 0, startedAt: 1000,
  }, { now: 5000 });
  assert.equal(result.elapsed, '4s');
  assert.equal(result.terminal, true);
  assert.equal(result.autoDismissAt, undefined);
  assert.equal(view.isTerminalStage('stopped'), true);
});

test('activity UI keeps preload/event contract and accessible controls', () => {
  const root = path.join(__dirname, '..');
  const component = fs.readFileSync(path.join(root, 'src/renderer/components/SocialImportActivity.jsx'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/App.jsx'), 'utf8');
  assert.match(component, /aria-expanded/);
  assert.match(component, /Stop import/);
  assert.match(component, /aria-live/);
  assert.match(component, /Dismiss import notification/);
  assert.match(app, /socialImport\?\.get/);
  assert.match(app, /social-import:status/);
  assert.match(app, /socialImport\?\.cancel/);
  assert.match(app, /socialImport\?\.dismiss/);
});
