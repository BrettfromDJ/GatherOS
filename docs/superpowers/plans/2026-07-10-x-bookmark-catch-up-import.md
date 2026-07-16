# X Bookmark Catch-Up Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an X import mode that saves missed recent bookmarks and stops after two consecutive active-or-dismissed bookmarks known to GatherLocal.

**Architecture:** GatherLocal classifies ordered X URLs through a token-authenticated desktop contract; extension applies a small deterministic catch-up state machine to API replay and scroll fallback. Desktop DB remains source of truth, tombstones remain intact, and existing count/all modes keep their force-import behavior.

**Tech Stack:** Electron/Node CommonJS, Chrome MV3 JavaScript, SQLite via better-sqlite3, `node:test`.

---

### Task 1: Catch-up stop policy

**Files:**
- Create: `extension/catch-up-import.mjs`
- Create: `test/catch-up-import.test.js`

- [x] **Step 1: Write failing policy tests**

Test public `applyCatchUpStatus(state, status)` with literal sequences:

```js
assert.deepEqual(run(['new', 'known-active', 'known-active']), {
  saves: 1, stopped: true, knownStreak: 2,
});
assert.deepEqual(run(['known-active', 'new', 'known-dismissed', 'known-active']), {
  saves: 1, stopped: true, knownStreak: 2,
});
assert.deepEqual(run(['known-dismissed', 'known-active']), {
  saves: 0, stopped: true, knownStreak: 2,
});
```

- [x] **Step 2: Run RED**

Run: `rtk node --test test/catch-up-import.test.js`
Expected: FAIL because `extension/catch-up-import.mjs` does not exist.

- [x] **Step 3: Implement minimal state machine**

Export `applyCatchUpStatus(state, status)`. `new` returns `shouldSave: true`, resets `knownStreak`; either known value increments streak and returns `shouldStop: true` only at `2`; unknown statuses throw.

- [x] **Step 4: Run GREEN**

Run: `rtk node --test test/catch-up-import.test.js`
Expected: all policy tests PASS.

### Task 2: Desktop bookmark-status source of truth

**Files:**
- Modify: `src/main/db.js`
- Modify: `src/main/extension-server.js`
- Modify: `src/main/native-host.js`
- Create: `test/x-bookmark-status.test.js`

- [x] **Step 1: Write failing DB and HTTP contract tests**

Use repo temp-DB helpers. Seed one live X save and one `dismissed_tweets` key. Assert ordered classification:

```js
assert.deepEqual(classifyXBookmarkUrls([
  'https://x.com/a/status/101',
  'https://x.com/b/status/202',
  'https://x.com/c/status/303',
]), {
  hasKnownHistory: true,
  statuses: ['known-active', 'known-dismissed', 'new'],
});
```

Also assert empty DB returns `hasKnownHistory: false`; invalid/non-X URL is `new`; batches above 100 are rejected. Start the local extension server against the temp DB, call authenticated `POST /x-bookmark-status`, and assert HTTP 200 plus exact ordered response keys. Send an invalid token and assert HTTP 401.

- [x] **Step 2: Run RED**

Run: `rtk node --test test/x-bookmark-status.test.js`
Expected: FAIL because classifier/route do not exist.

- [x] **Step 3: Implement DB classifier**

Add/export `classifyXBookmarkUrls(tweetUrls)`. Canonicalize with `tweetKeyFromUrl`. Query live `saves` (`deleted_at IS NULL`, X status source URL) and `dismissed_tweets`; classify tombstone before active; compute `hasKnownHistory` from any live X save or `tw:%` tombstone. Preserve input order. Reject non-array and length over 100.

- [x] **Step 4: Implement authenticated server route**

Generalize JSON POST auth/body parsing without changing `/save`. Add `POST /x-bookmark-status`, token-protected and origin-checked, accepting `{ tweetUrls }`; return `{ ok: true, hasKnownHistory, statuses }`. Invalid input returns HTTP 400.

- [x] **Step 5: Implement native relay**

Generalize `postToApp(body, token, path = '/save')`. Handle native message `{ type: 'x-bookmark-status', tweetUrls }`, require running app/token like save, POST to `/x-bookmark-status`, return body unchanged.

- [x] **Step 6: Run GREEN + syntax checks**

Run: `rtk node --test test/x-bookmark-status.test.js`
Run: `rtk node --check src/main/db.js src/main/extension-server.js src/main/native-host.js`
Expected: PASS.

### Task 3: Importer and panel integration

**Files:**
- Modify: `extension/panel.js`
- Modify: `extension/background.js`
- Modify: `extension/import-limit.mjs` only if shared run-state helpers belong there
- Modify: `test/catch-up-import.test.js`
- Modify: `test/import-limit.test.js` only for fixed-mode regression coverage

- [x] **Step 1: Add failing orchestration tests at helper seam**

Add a page helper test proving ordered statuses yield only new entries before the second consecutive known marker, including `known, new, known, known`. Add regression assertion that numeric claim limits remain unchanged.

- [x] **Step 2: Run RED**

Run: `rtk node --test test/catch-up-import.test.js test/import-limit.test.js`
Expected: new orchestration test FAILS; existing limit tests PASS.

- [x] **Step 3: Add panel mode**

Add selector option `Catch up to latest saved` with nonnumeric value `catch-up`. Send `{ type: 'gatheros:import-bookmarks', mode: 'catch-up' }`; numeric options continue sending `limit`. Handle `{ noBoundary: true }` by keeping panel open, restoring button, and showing `No previous X bookmark found. Choose a fixed amount instead.`

- [x] **Step 4: Add preflight and mode state**

Before starting catch-up, send native `x-bookmark-status` with `tweetUrls: []`. If `hasKnownHistory` is false, return `{ ok: false, noBoundary: true }`. Store `mode: 'catch-up'`, `knownStreak: 0`, and no finite claim limit. Fixed modes retain current state and `force: true` saves.

- [x] **Step 5: Apply same ordered policy to both transports**

For each API page or scroll batch, call desktop status once with ordered `tweetUrl` values. Walk entries/statuses together. In catch-up mode: known entries are not saved; new entries save with `force: false`; successful new save resets streak; second consecutive known ends import. A classification/save rejection stops run with partial-progress notification. API pagination ending before boundary reports completion without claiming `Already caught up.` Scroll mode pauses immediately at boundary before finishing queued saves.

- [x] **Step 6: Add completion copy**

When boundary reached with zero new saves, notify `Already caught up.` Otherwise retain accurate imported-count summary. Do not use this copy for bottom, timeout, or error completion.

- [x] **Step 7: Run GREEN + extension checks**

Run: `rtk node --test test/catch-up-import.test.js test/import-limit.test.js test/save-response.test.js test/x-bookmark-status.test.js`
Run: `rtk node --check extension/background.js extension/panel.js extension/content/x-bookmark-watcher.js extension/import-limit.mjs extension/catch-up-import.mjs`
Expected: PASS.

### Task 4: Full verification and commit

**Files:**
- Modify only files listed above plus this plan/spec when needed for accuracy.

- [x] **Step 1: Run repo checks**

Run: `rtk npm run test:ai`
Run: `rtk npm run build:renderer`
Run: `rtk git diff --check`
Expected: all PASS.

- [x] **Step 2: Inspect scope and diff**

Run: `rtk git status --short`
Run: `rtk git diff --stat 7b82825...HEAD`
Run: `rtk git diff 7b82825...HEAD -- extension src/main test docs/superpowers/plans`
Confirm no unrelated files, contract matches spec, fixed/all imports still force-import.

- [x] **Step 3: Commit**

```bash
rtk git add extension src/main test docs/superpowers/plans/2026-07-10-x-bookmark-catch-up-import.md
rtk git commit -m "Add X bookmark catch-up import"
```
