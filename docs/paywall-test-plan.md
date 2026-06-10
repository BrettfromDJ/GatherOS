# Paywall / trial — end-to-end test plan

The model: **14-day local trial (no card) → soft free tier**. After the trial
(and with no paid subscription) the app keeps running — existing saves stay
usable, but **new saves** and **pro features** prompt to upgrade. Everything
**fails open**: a paying user is never blocked.

Three modes resolve from `getEntitlement()`:

| mode | when | new saves | pro features |
|------|------|-----------|--------------|
| `paid` | active subscription | ✅ | ✅ |
| `trial` | local 14-day trial running, OR server trial/offline/uncertain | ✅ | ✅ |
| `free` | trial spent AND no subscription (server `expired`/`unauth`) | ❌ upgrade | ❌ upgrade |

---

## 0. Setup — find the data dir & the helper commands

All local state lives in the app's userData dir. Find it once:

```bash
APP="$(find ~/Library/Application\ Support -maxdepth 2 -name prefs.json 2>/dev/null | head -1 | xargs dirname)"
echo "$APP"
# Usually: ~/Library/Application Support/GatherOS
```

Key files in `$APP`:
- `prefs.json` — holds `trialStartedAt` (the local trial clock)
- `license-cache.json` — cached server license state
- `license-session.bin` — encrypted session token (presence = "signed in")

**The single most useful debugging command** — open DevTools in the app
(`⌥⌘I`) and run:

```js
await window.moodmark.entitlement.get()        // → { mode, trial:{daysLeft,active}, canCreateSave, ... }
await window.moodmark.licensing.verify({force:true})  // → server state { state: 'entitled'|'expired'|'unauth'|... }
```

Edit `prefs.json` / `license-cache.json` **with the app quit** (state is read at
launch; `trialStartedAt` is pinned once on first launch and won't reset itself).
Relaunch to apply. `entitlement.get()` also re-resolves on window focus and after
each save.

Run the app: `cd /Users/brett/GatherOS && git checkout main && git pull origin main && npm run dev`

---

## 1. Fast UI smoke test (no server, no account) — DEV gate

In DevTools, set the override and reload (`⌘R`). Reset with
`localStorage.removeItem('moodmark.dev.gate')`.

| `localStorage.setItem('moodmark.dev.gate', …)` | Expect |
|---|---|
| `'free'` | App runs in **free tier**: bottom-centre "You're on the free plan…" banner; new saves blocked → upgrade modal |
| `'app'` | App runs, no locks (sanity baseline) |
| `'signin'` | SigninScreen with a **"Back to app"** escape link (must not trap you) |

In `'free'` mode, verify the modal: open via the banner **Upgrade**, via a
blocked save, and via any locked feature. Check **Esc closes**, **"Not now"
closes**, clicking the scrim closes, Monthly/Yearly toggle switches price
($4.99 / $49), and the CTA reads **"Sign in to upgrade"** (no account) or
**"Upgrade now"** (signed in).

---

## 2. Local trial logic (no server, no account)

Edit `prefs.json` `trialStartedAt` while the app is **quit**, then relaunch.

```bash
APP="$(find ~/Library/Application\ Support -maxdepth 2 -name prefs.json | head -1 | xargs dirname)"
NOW=$(($(date +%s)*1000))

# A) Active trial (day 1)  → mode 'trial', full app, banner hidden
#    daysLeft 14
node -e "const f='$APP/prefs.json';const p=require(f);p.trialStartedAt=$NOW;require('fs').writeFileSync(f,JSON.stringify(p,null,2))"

# B) Trial almost over (2 days left) → mode 'trial' + countdown banner appears
node -e "const f='$APP/prefs.json';const p=require(f);p.trialStartedAt=$NOW-12*864e5;require('fs').writeFileSync(f,JSON.stringify(p,null,2))"

# C) Trial expired (16 days ago), no account → mode 'free'
node -e "const f='$APP/prefs.json';const p=require(f);p.trialStartedAt=$NOW-16*864e5;require('fs').writeFileSync(f,JSON.stringify(p,null,2))"
```

After each: relaunch → `await window.moodmark.entitlement.get()` and confirm
`mode` + `trial.daysLeft`. The countdown banner should only show in the **last 5
days** (and be dismissible for the session).

---

## 3. New-install scoping (current-user safety) — critical

Existing users must **not** get a fresh 14-day trial on update, and must keep
their existing saves.

```bash
APP="$(find ~/Library/Application\ Support -maxdepth 2 -name prefs.json | head -1 | xargs dirname)"

# Simulate "upgrading into this build": remove the trial decision so the app
# re-decides on next launch.
node -e "const f='$APP/prefs.json';const p=require(f);delete p.trialStartedAt;require('fs').writeFileSync(f,JSON.stringify(p,null,2))"
```

- **Existing user (library has saves):** relaunch → `entitlement.get()` shows
  `trial.startedAt === 0` (spent) → mode `free`. **Existing saves still open and
  display fine.** Only new saves prompt.
- **Genuinely new install (empty library, no session):** with `trialStartedAt`
  removed AND zero saves AND no `license-session.bin`, relaunch → `trial.daysLeft`
  ≈ 14, mode `trial`. (Easiest clean test: move `$APP` aside —
  `mv "$APP" "$APP.bak"` — launch once, then restore with `rm -rf "$APP" && mv "$APP.bak" "$APP"`.)

---

## 4. Save-gating matrix

For each mode (set via §2/§3 or a real account in §5), try **every** save entry
point. In `trial`/`paid`: save succeeds. In `free`: **no save is created** and the
upgrade modal appears.

- [ ] Drag an image file into the window
- [ ] Drag an image URL from a browser
- [ ] Drop a `.zip`
- [ ] Toolbar **Save URL…**
- [ ] Hotkey screenshot (`⌘⇧S` area, + fullscreen/window) → in free tier this
      brings the window forward and pops the modal (no silent no-op)
- [ ] Chrome extension save (right-click → save, and X-bookmark) → in free tier
      the extension call returns **HTTP 402** and the app pops the modal
- [ ] AI "Generate variation"

**Critical check:** in `free` mode, confirm existing saves still open, export,
move to collections, and delete — only **creation** is blocked.

---

## 5. Real account / server states (true e2e)

These need the live backend (`api.gatheros.co`) and a real magic-link sign-in.
Sign in from **Settings → Account → Sign in**, or the upgrade modal's
**"Sign in to upgrade"**. Magic link arrives by email and deep-links back via
`gatheros://auth/verify?token=…`.

| State to test | How to get there | Expect |
|---|---|---|
| **Paid** | Sign in on an account with an active subscription | `mode: 'paid'`, no banner, no locks, everything works |
| **Server trial** | Account whose server trial is active | `mode: 'trial'`, full app |
| **Expired** (trial done, no sub) | Account past trial with no subscription | `mode: 'free'`, soft tier (NOT a hard wall) |
| **Past due** (card declined) | Subscription in `past_due` | App still runs; top **AccountBanner** "We couldn't charge your card" → Update payment method |
| **Upgrade → paid flip** | In `free`, click Upgrade → complete Lemon Squeezy checkout in browser | App **auto-flips to paid within ~2 min** (verify fast-polls after `checkout-opened`) — no relaunch |
| **Sign out** | Settings → Account → Sign out | Drops to local-trial/free logic; existing saves remain |

Checkout/portal links are minted server-side and open in the default browser —
just confirm they open and that returning to the app flips state.

---

## 6. Offline / failure = fail-open (must never block a payer)

```bash
APP="$(find ~/Library/Application\ Support -maxdepth 2 -name prefs.json | head -1 | xargs dirname)"
```

- **Offline with a recent paid cache:** sign in as paid once (writes
  `license-cache.json`), then turn off Wi-Fi and relaunch → app runs, top banner
  "Working offline…", **saves still work** (mode `trial`/`paid`, within the 7-day
  grace). It must **not** drop to `free`.
- **Corrupt/empty cache:** `echo '{}' > "$APP/license-cache.json"` →
  `entitlement.get()` must resolve to a **permissive** mode, not `free`.
- **Delete cache entirely:** `rm -f "$APP/license-cache.json"` while local trial
  is active → still `trial`. Only `expired`/`unauth` **with a spent local trial**
  yields `free`.

---

## 7. Feature-lock spot checks (free mode)

In `free` (§1 dev-gate `'free'` is fastest), each should open the upgrade modal
with the right copy:

- [ ] **Boards:** create a board / "open collection as space" → `boards` copy
- [ ] **Libraries:** LibrarySwitcher "New library" (and Settings → Libraries) → `libraries` copy
- [ ] **AI:** DetailPanel auto-tag, generate prompt, generate variation → `ai` copy
- [ ] **"More like this":** similar-saves section is hidden in free mode
- [ ] **Semantic search:** still returns results (falls back to plain text search — not broken)

---

## Pre-ship gate
- [ ] All of §4 pass in each of paid / trial / free
- [ ] §3 confirms no current user gets a trial reset or loses saves
- [ ] §6 confirms a payer is never blocked offline/on error
- [ ] **Backend:** server trial length is **14 days** on `api.gatheros.co`
      (config outside this repo — verify the server matches the client)
