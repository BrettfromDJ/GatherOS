import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { History } from 'lucide-react';
import styles from './SettingsModal.module.css';
import AcknowledgmentsModal from './AcknowledgmentsModal.jsx';
import PrivacyModal from './PrivacyModal.jsx';

const SUPPORT_EMAIL = 'hello@designjoy.co';

function formatPlanLabel(account) {
  if (!account) return '—';
  const sub = account.subscription;
  if (sub) {
    const plan = sub.plan === 'yearly' ? 'Yearly' : sub.plan === 'monthly' ? 'Monthly' : '';
    const status = sub.status;
    if (status === 'trialing') return plan ? `${plan} · Trial` : 'Trial';
    if (status === 'past_due') return plan ? `${plan} · Past due` : 'Past due';
    if (status === 'canceled') return plan ? `${plan} · Canceled` : 'Canceled';
    if (status === 'paused') return plan ? `${plan} · Paused` : 'Paused';
    return plan || 'Active';
  }
  if (account.reason === 'trial') return 'Trial';
  return 'Free';
}

function formatPeriodEnd(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

const STATUS_IDLE = 'idle';
const STATUS_TESTING = 'testing';
const STATUS_OK = 'ok';
const STATUS_ERROR = 'error';

function DrawerChevron() {
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
      <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ZipIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 2h6.25l3 3v8.5a0.5 0.5 0 0 1-0.5 0.5h-9a0.5 0.5 0 0 1-0.5-0.5v-11a0.5 0.5 0 0 1 0.5-0.5z" />
      <path d="M9.5 2v3h3" />
      <path d="M6.25 6h1M7.25 7.5h1M6.25 9h1M7.25 10.5h1" />
    </svg>
  );
}

function EraseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4h11" />
      <path d="M5.5 4V2.5a0.75 0.75 0 0 1 0.75 -0.75h3.5a0.75 0.75 0 0 1 0.75 0.75V4" />
      <path d="M3.75 4v9a0.75 0.75 0 0 0 0.75 0.75h7a0.75 0.75 0 0 0 0.75 -0.75V4" />
      <path d="M6.5 7v4M9.5 7v4" />
    </svg>
  );
}

export default function SettingsModal({ open, onClose, onConfiguredChange, onPrefsChange, onLibraryWiped, onKeySaved, onReplayOnboarding }) {
  const [hasKey, setHasKey] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState(STATUS_IDLE);
  const [errorMessage, setErrorMessage] = useState('');
  const [prefs, setPrefs] = useState({ autoNameOnSave: true, theme: 'light' });
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [unindexed, setUnindexed] = useState(0);
  const [reindexState, setReindexState] = useState({ running: false, processed: 0, total: 0 });
  const [exportState, setExportState] = useState({ running: false, message: null });
  const [wipeState, setWipeState] = useState({ running: false, message: null });
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotState, setSnapshotState] = useState({ running: false, message: null });
  const [snapshotsListOpen, setSnapshotsListOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [acksOpen, setAcksOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const [portalState, setPortalState] = useState({ running: false, message: null });
  const appVersion = window.moodmark?.app?.version || '';
  const inputRef = useRef(null);

  async function handleWipeLibrary() {
    if (wipeState.running) return;
    setWipeState({ running: true, message: null });
    try {
      const result = await window.moodmark.library.wipeAll();
      if (result?.ok) {
        // Pin starter-pack as already-installed so the auto-install
        // effect in App.jsx doesn't repopulate after the wipe.
        try { localStorage.setItem('moodmark.starterInstalled', '1'); } catch {}
        setWipeState({ running: false, message: `Erased ${result.removed} saves` });
        onLibraryWiped?.();
      } else if (result?.canceled) {
        setWipeState({ running: false, message: null });
      } else {
        setWipeState({ running: false, message: result?.error || 'Wipe failed' });
      }
    } catch (err) {
      setWipeState({ running: false, message: err.message || 'Wipe failed' });
    }
  }

  async function handleExportLibrary() {
    if (exportState.running) return;
    setExportState({ running: true, message: null });
    try {
      const result = await window.moodmark.library.exportZip();
      if (result?.ok) {
        setExportState({ running: false, message: `Exported to ${result.savedPath}` });
      } else if (result?.canceled) {
        setExportState({ running: false, message: null });
      } else {
        setExportState({ running: false, message: result?.error || 'Export failed' });
      }
    } catch (err) {
      setExportState({ running: false, message: err.message || 'Export failed' });
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      window.moodmark.settings.hasOpenAIKey(),
      window.moodmark.settings.getPrefs(),
      window.moodmark.ai.unindexedCount(),
    ]).then(([keyExists, p, count]) => {
      if (cancelled) return;
      setHasKey(!!keyExists);
      setPrefs(p);
      setUnindexed(count || 0);
    });
    setDraft('');
    setStatus(STATUS_IDLE);
    setErrorMessage('');
    // Stale transient feedback (the "Erased X saves" / "Exported to
    // …" / etc. lines) shouldn't survive a close + reopen — reset
    // each time the user pops back in.
    setExportState({ running: false, message: null });
    setWipeState({ running: false, message: null });
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => { cancelled = true; };
  }, [open]);

  // Progress stream from main while ai:reindex-library runs.
  useEffect(() => {
    if (!open) return;
    return window.moodmark.on('ai:reindex-progress', ({ processed, total }) => {
      setReindexState((s) => ({ ...s, processed, total }));
    });
  }, [open]);

  async function handleReindex() {
    if (reindexState.running || unindexed === 0) return;
    setReindexState({ running: true, processed: 0, total: unindexed });
    const result = await window.moodmark.ai.reindexLibrary();
    setReindexState({
      running: false,
      processed: result?.processed || 0,
      total: result?.total || 0,
    });
    const fresh = await window.moodmark.ai.unindexedCount();
    setUnindexed(fresh || 0);
  }

  async function togglePref(name) {
    const next = !prefs[name];
    const updated = { ...prefs, [name]: next };
    setPrefs(updated);
    await window.moodmark.settings.setPref(name, next);
    onPrefsChange?.(updated);
  }

  // Theme writes go through the same prefs file as the AI toggles, but
  // also need to hit document.documentElement so the swap is instant
  // — the boot-time read in main.jsx only runs on next launch.
  // Main process is also told so the macOS traffic-lights / window
  // chrome flip in lockstep with the document.
  async function setTheme(next) {
    if (next !== 'light' && next !== 'dark') return;
    if (prefs.theme === next) return;
    const updated = { ...prefs, theme: next };
    setPrefs(updated);
    document.documentElement.setAttribute('data-theme', next);
    await Promise.all([
      window.moodmark.settings.setPref('theme', next),
      window.moodmark.app.setTheme?.(next),
    ]);
    onPrefsChange?.(updated);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    window.moodmark.backup.list().then((rows) => {
      if (!cancelled) setSnapshots(Array.isArray(rows) ? rows : []);
    });
    return () => { cancelled = true; };
  }, [open]);

  // Pull the latest license/entitlement view when Settings opens so
  // the Account drawer renders with fresh email + plan + status.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    window.moodmark.licensing.verify({ force: false }).then((result) => {
      if (!cancelled) setAccount(result || null);
    });
    setPortalState({ running: false, message: null });
    return () => { cancelled = true; };
  }, [open]);

  async function handleOpenCustomerPortal() {
    if (portalState.running) return;
    setPortalState({ running: true, message: null });
    const result = await window.moodmark.licensing.openCustomerPortal();
    setPortalState({
      running: false,
      message: result?.ok
        ? null
        : result?.error === 'no_customer'
          ? 'You don’t have a subscription yet.'
          : 'Couldn’t open the billing portal. Try again in a moment.',
    });
  }

  async function handleSignOut() {
    const ok = window.confirm(
      'Sign out of GatherOS?\n\nYour library stays on this Mac. You can sign back in any time with the same email.',
    );
    if (!ok) return;
    await window.moodmark.licensing.signOut();
    // Closing settings before AppGate flips back to the SigninScreen
    // avoids a brief flash of Settings on top of the new takeover.
    onClose?.();
  }

  async function handleSnapshotNow() {
    if (snapshotState.running) return;
    setSnapshotState({ running: true, message: null });
    const result = await window.moodmark.backup.snapshot();
    const rows = await window.moodmark.backup.list();
    setSnapshots(Array.isArray(rows) ? rows : []);
    setSnapshotState({
      running: false,
      message: result?.ok ? 'Snapshot saved.' : `Snapshot failed: ${result?.reason || 'unknown'}`,
    });
  }

  async function handleRestoreSnapshot(snapshot) {
    const stamp = formatRelativeTimestamp(snapshot.timestamp);
    const ok = window.confirm(
      `Restore the library from the snapshot taken ${stamp}?\n\n`
      + 'Saves added since that snapshot will disappear from the library. '
      + 'The image files on disk are untouched, so nothing is permanently '
      + 'lost — re-importing those files would resurface them.\n\n'
      + 'A fresh snapshot of the current state is taken first as a safety net.',
    );
    if (!ok) return;
    setSnapshotState({ running: true, message: null });
    const result = await window.moodmark.backup.restore(snapshot.path);
    const rows = await window.moodmark.backup.list();
    setSnapshots(Array.isArray(rows) ? rows : []);
    setSnapshotState({
      running: false,
      message: result?.ok ? 'Restored. Reloading…' : `Restore failed: ${result?.reason || 'unknown'}`,
    });
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setStatus(STATUS_TESTING);
    setErrorMessage('');
    const result = await window.moodmark.settings.setOpenAIKey(trimmed);
    if (result.ok) {
      setStatus(STATUS_OK);
      setHasKey(true);
      setDraft('');
      // Auto-enable both AI features now that a key is configured.
      // Toggles render as off whenever !hasKey, so the user expects
      // them to flip on the moment the key is saved.
      const enabled = { ...prefs, autoNameOnSave: true, semanticSearch: true };
      setPrefs(enabled);
      await Promise.all([
        window.moodmark.settings.setPref('autoNameOnSave', true),
        window.moodmark.settings.setPref('semanticSearch', true),
      ]);
      onPrefsChange?.(enabled);
      onConfiguredChange?.(true);
      // Brief success state, then close settings and hand off to the
      // celebration modal. Two-stage timeout so the unlocked modal's
      // entrance doesn't visually overlap the settings exit.
      setTimeout(() => {
        if (status === STATUS_ERROR) return;
        onClose();
        setTimeout(() => onKeySaved?.(), 140);
      }, 700);
    } else {
      setStatus(STATUS_ERROR);
      setErrorMessage(reasonToMessage(result.reason));
    }
  }

  async function handleClear() {
    await window.moodmark.settings.clearOpenAIKey();
    setHasKey(false);
    setStatus(STATUS_IDLE);
    setErrorMessage('');
    onConfiguredChange?.(false);
  }

  async function handleTest() {
    setStatus(STATUS_TESTING);
    setErrorMessage('');
    const result = await window.moodmark.settings.testOpenAIKey();
    if (result.ok) {
      setStatus(STATUS_OK);
    } else {
      setStatus(STATUS_ERROR);
      setErrorMessage(reasonToMessage(result.reason));
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && draft.trim()) handleSave();
  }

  return ReactDOM.createPortal(
    <div
      className={styles.backdrop}
      onClick={(e) => {
        // Only treat clicks landing directly on the backdrop as a
        // dismiss — don't catch clicks that started inside the
        // modal and bubbled up.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </header>

        <section className={styles.section}>
          <div className={styles.sectionTitle} aria-label="OpenAI">
            <svg
              className={styles.openaiLogo}
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.786a4.495 4.495 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
            </svg>
          </div>
          <p className={styles.sectionHint}>
            Bring your own key for AI features like auto-tagging. It’s encrypted locally, and your images go straight to OpenAI—never through anyone else.
          </p>

          <div className={styles.fieldLabelRow}>
            <label className={styles.fieldLabel} htmlFor="openai-key-input">
              API Key
            </label>
            <button
              type="button"
              className={styles.helpLink}
              onClick={() =>
                window.moodmark.shell.openUrl(
                  'https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key',
                )
              }
            >
              Where do I find this? ↗
            </button>
          </div>
          <input
            id="openai-key-input"
            ref={inputRef}
            className={styles.input}
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasKey ? '••••••••••••••••••••••••' : 'sk-...'}
            autoComplete="off"
            spellCheck={false}
          />

          <div className={styles.statusRow}>
            {status === STATUS_IDLE && hasKey && (
              <span className={`${styles.status} ${styles.statusOk}`}>
                <span className={styles.dot} aria-hidden="true" />
                Connected
              </span>
            )}
            {status === STATUS_IDLE && !hasKey && (
              <span className={`${styles.status} ${styles.statusMuted}`}>
                Not configured
              </span>
            )}
            {status === STATUS_TESTING && (
              <span className={`${styles.status} ${styles.statusMuted}`}>
                Testing…
              </span>
            )}
            {status === STATUS_OK && (
              <span className={`${styles.status} ${styles.statusOk}`}>
                <span className={styles.dot} aria-hidden="true" />
                Connected
              </span>
            )}
            {status === STATUS_ERROR && (
              <span className={`${styles.status} ${styles.statusError}`}>
                {errorMessage}
              </span>
            )}
          </div>

          <div className={styles.actions}>
            {hasKey && (
              <button
                type="button"
                className={styles.btn}
                onClick={handleTest}
                disabled={status === STATUS_TESTING}
              >
                Test connection
              </button>
            )}
            {hasKey && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={handleClear}
              >
                Forget key
              </button>
            )}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={handleSave}
              disabled={!draft.trim() || status === STATUS_TESTING}
            >
              {hasKey ? 'Replace key' : 'Save key'}
            </button>
          </div>
        </section>

        <section className={`${styles.section} ${styles.drawerSection}`}>
          <button
            type="button"
            className={styles.drawerHeader}
            onClick={() => setAccountOpen((v) => !v)}
            aria-expanded={accountOpen}
          >
            <span className={styles.sectionTitle}>Account</span>
            <span className={[styles.drawerChevron, accountOpen && styles.drawerChevronOpen].filter(Boolean).join(' ')}>
              <DrawerChevron />
            </span>
          </button>
          {accountOpen && (
            <div className={styles.drawerBody}>
              <div className={styles.aboutRow}>
                <span className={styles.aboutLabel}>Email</span>
                <span className={styles.aboutValue}>
                  {account?.user?.email || '—'}
                </span>
              </div>
              <div className={styles.aboutRow}>
                <span className={styles.aboutLabel}>Plan</span>
                <span className={styles.aboutValue}>
                  {formatPlanLabel(account)}
                </span>
              </div>
              {account?.subscription?.current_period_end && (
                <div className={styles.aboutRow}>
                  <span className={styles.aboutLabel}>
                    {account.subscription.cancel_at_period_end
                      ? 'Ends'
                      : account.subscription.status === 'trialing'
                        ? 'Trial ends'
                        : 'Renews'}
                  </span>
                  <span className={styles.aboutValue}>
                    {formatPeriodEnd(account.subscription.current_period_end)}
                  </span>
                </div>
              )}
              <div className={styles.actions} style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  onClick={handleSignOut}
                >
                  Sign out
                </button>
                {account?.subscription && (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={handleOpenCustomerPortal}
                    disabled={portalState.running}
                  >
                    {portalState.running ? 'Opening…' : 'Manage subscription'}
                  </button>
                )}
              </div>
              {portalState.message && (
                <div className={styles.sectionHint} style={{ marginTop: 8 }}>
                  {portalState.message}
                </div>
              )}
            </div>
          )}
        </section>

        <section className={`${styles.section} ${styles.drawerSection}`}>
          <button
            type="button"
            className={styles.drawerHeader}
            onClick={() => setAppearanceOpen((v) => !v)}
            aria-expanded={appearanceOpen}
          >
            <span className={styles.sectionTitle}>Appearance</span>
            <span className={[styles.drawerChevron, appearanceOpen && styles.drawerChevronOpen].filter(Boolean).join(' ')}>
              <DrawerChevron />
            </span>
          </button>
          {appearanceOpen && (
            <div className={styles.drawerBody}>
              <div className={styles.themeRow}>
                <button
                  type="button"
                  className={`${styles.themeOption} ${prefs.theme !== 'dark' ? styles.themeOptionActive : ''}`}
                  onClick={() => setTheme('light')}
                  aria-pressed={prefs.theme !== 'dark'}
                >
                  <span className={`${styles.themeSwatch} ${styles.themeSwatchLight}`} aria-hidden="true" />
                  <span className={styles.themeLabel}>Light</span>
                </button>
                <button
                  type="button"
                  className={`${styles.themeOption} ${prefs.theme === 'dark' ? styles.themeOptionActive : ''}`}
                  onClick={() => setTheme('dark')}
                  aria-pressed={prefs.theme === 'dark'}
                >
                  <span className={`${styles.themeSwatch} ${styles.themeSwatchDark}`} aria-hidden="true" />
                  <span className={styles.themeLabel}>Dark</span>
                </button>
              </div>
            </div>
          )}
        </section>

        <section className={`${styles.section} ${styles.drawerSection}`}>
          <button
            type="button"
            className={styles.drawerHeader}
            onClick={() => setAiOpen((v) => !v)}
            aria-expanded={aiOpen}
          >
            <span className={styles.sectionTitle}>AI Features</span>
            <span className={[styles.drawerChevron, aiOpen && styles.drawerChevronOpen].filter(Boolean).join(' ')}>
              <DrawerChevron />
            </span>
          </button>
          {aiOpen && (
          <div className={styles.drawerBody}>
          <label className={styles.toggleRow}>
            <span className={styles.toggleText}>
              <span className={styles.toggleLabel}>Auto-name new uploads</span>
              <span className={styles.toggleSub}>
                Generate a short title for each image you save. Runs in the background.
              </span>
            </span>
            <span className={styles.switch}>
              <input
                type="checkbox"
                checked={hasKey && !!prefs.autoNameOnSave}
                onChange={() => togglePref('autoNameOnSave')}
                disabled={!hasKey}
              />
              <span className={styles.switchTrack}>
                <span className={styles.switchKnob} />
              </span>
            </span>
          </label>
          <label className={styles.toggleRow}>
            <span className={styles.toggleText}>
              <span className={styles.toggleLabel}>Visual search</span>
              <span className={styles.toggleSub}>
                Index new saves with vector embeddings so the search bar matches by meaning ("dark moody UI") instead of exact words.
              </span>
            </span>
            <span className={styles.switch}>
              <input
                type="checkbox"
                checked={hasKey && !!prefs.semanticSearch}
                onChange={() => togglePref('semanticSearch')}
                disabled={!hasKey}
              />
              <span className={styles.switchTrack}>
                <span className={styles.switchKnob} />
              </span>
            </span>
          </label>

          {hasKey && (unindexed > 0 || reindexState.running) && (
            <div className={styles.reindexBox}>
              <div className={styles.reindexCopy}>
                {reindexState.running ? (
                  <>
                    <strong>Indexing {reindexState.processed} of {reindexState.total}…</strong>
                    <span className={styles.toggleSub}>
                      Each save runs one vision call + one embedding (~$0.001 each). You can keep using the app.
                    </span>
                  </>
                ) : (
                  <>
                    <strong>{unindexed} {unindexed === 1 ? 'save needs' : 'saves need'} indexing</strong>
                    <span className={styles.toggleSub}>
                      Older saves won't appear in semantic results until they're processed. Roughly ${(unindexed * 0.001).toFixed(3)} of API usage.
                    </span>
                  </>
                )}
              </div>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handleReindex}
                disabled={reindexState.running || unindexed === 0}
              >
                {reindexState.running ? 'Indexing…' : 'Index now'}
              </button>
            </div>
          )}
          </div>
          )}
        </section>

        <section className={`${styles.section} ${styles.drawerSection}`}>
          <button
            type="button"
            className={styles.drawerHeader}
            onClick={() => setDataOpen((v) => !v)}
            aria-expanded={dataOpen}
          >
            <span className={styles.sectionTitle}>Data</span>
            <span className={[styles.drawerChevron, dataOpen && styles.drawerChevronOpen].filter(Boolean).join(' ')}>
              <DrawerChevron />
            </span>
          </button>
          {dataOpen && (
          <div className={styles.drawerBody}>
          <p className={styles.sectionHint}>
            Export your entire library — the GatherOS database plus every
            saved image and thumbnail — into a single .zip backup. You can
            restore later by replacing the contents of the app's data
            folder with this archive's contents.
          </p>
          <div className={styles.actions} style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnWithIcon}`}
              onClick={handleExportLibrary}
              disabled={exportState.running}
            >
              <span className={styles.btnIcon}><ZipIcon /></span>
              {exportState.running ? 'Exporting…' : 'Export Library as Zip'}
            </button>
          </div>
          {exportState.message && (
            <div className={styles.sectionHint} style={{ marginTop: 8 }}>
              {exportState.message}
            </div>
          )}

          <div className={styles.divider} />

          <p className={styles.sectionHint}>
            GatherOS saves daily snapshots of your library so you can
            restore if necessary.
          </p>
          <div className={styles.actions} style={{ justifyContent: 'flex-start', marginBottom: 6 }}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnWithIcon}`}
              onClick={handleSnapshotNow}
              disabled={snapshotState.running}
            >
              <span className={styles.btnIcon}>
                <History size={14} strokeWidth={1.7} aria-hidden="true" />
              </span>
              {snapshotState.running ? 'Working…' : 'Snapshot now'}
            </button>
          </div>
          {snapshots.length > 0 ? (
            <div className={styles.subDrawer}>
              <button
                type="button"
                className={styles.subDrawerHeader}
                onClick={() => setSnapshotsListOpen((v) => !v)}
                aria-expanded={snapshotsListOpen}
              >
                <span>Available snapshots ({snapshots.length})</span>
                <span
                  className={[
                    styles.drawerChevron,
                    snapshotsListOpen && styles.drawerChevronOpen,
                  ].filter(Boolean).join(' ')}
                >
                  <DrawerChevron />
                </span>
              </button>
              {snapshotsListOpen && (
                <ul className={styles.snapshotList}>
                  {snapshots.map((s) => (
                    <li key={s.path} className={styles.snapshotRow}>
                      <div className={styles.snapshotMeta}>
                        <span className={styles.snapshotWhen}>
                          {formatRelativeTimestamp(s.timestamp)}
                        </span>
                        <span className={styles.snapshotSub}>
                          {new Date(s.timestamp).toLocaleString()}
                          {' · '}{formatBackupSize(s.size)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.btn}
                        disabled={snapshotState.running}
                        onClick={() => handleRestoreSnapshot(s)}
                      >
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className={styles.sectionHint} style={{ marginTop: 4 }}>
              No snapshots yet. The first one will be taken automatically
              within a moment.
            </div>
          )}
          {snapshotState.message && (
            <div className={styles.sectionHint} style={{ marginTop: 8 }}>
              {snapshotState.message}
            </div>
          )}

          <div className={styles.divider} />

          <p className={styles.sectionHint}>
            Erase your entire library — every save, folder, and tag. The
            underlying image files are deleted from disk. This cannot be
            undone.
          </p>
          <div className={styles.actions} style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger} ${styles.btnWithIcon}`}
              onClick={handleWipeLibrary}
              disabled={wipeState.running}
            >
              <span className={styles.btnIcon}><EraseIcon /></span>
              {wipeState.running ? 'Erasing…' : 'Erase Library'}
            </button>
          </div>
          {wipeState.message && (
            <div className={styles.sectionHint} style={{ marginTop: 8 }}>
              {wipeState.message}
            </div>
          )}
          </div>
          )}
        </section>

        <section className={`${styles.section} ${styles.drawerSection}`}>
          <button
            type="button"
            className={styles.drawerHeader}
            onClick={() => setAboutOpen((v) => !v)}
            aria-expanded={aboutOpen}
          >
            <span className={styles.sectionTitle}>About</span>
            <span className={[styles.drawerChevron, aboutOpen && styles.drawerChevronOpen].filter(Boolean).join(' ')}>
              <DrawerChevron />
            </span>
          </button>
          {aboutOpen && (
          <div className={styles.drawerBody}>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>Version</span>
              <span className={styles.aboutValue}>
                {appVersion ? `v${appVersion}` : '—'}
              </span>
            </div>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>Privacy</span>
              <button
                type="button"
                className={styles.aboutLink}
                onClick={() => setPrivacyOpen(true)}
              >
                View policy
              </button>
            </div>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>Support</span>
              <button
                type="button"
                className={styles.aboutLink}
                onClick={() => window.moodmark.shell.openUrl(`mailto:${SUPPORT_EMAIL}`)}
              >
                {SUPPORT_EMAIL}
              </button>
            </div>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>Open source</span>
              <button
                type="button"
                className={styles.aboutLink}
                onClick={() => setAcksOpen(true)}
              >
                View acknowledgments
              </button>
            </div>
            {onReplayOnboarding && (
              <div className={styles.aboutRow}>
                <span className={styles.aboutLabel}>Welcome tour</span>
                <button
                  type="button"
                  className={styles.aboutLink}
                  onClick={onReplayOnboarding}
                >
                  Replay
                </button>
              </div>
            )}
          </div>
          )}
        </section>
      </div>

      <AcknowledgmentsModal
        open={acksOpen}
        onClose={() => setAcksOpen(false)}
      />

      <PrivacyModal
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
      />
    </div>,
    document.body,
  );
}

// "5 minutes ago" / "2 hours ago" / "3 days ago" — used for the
// backup snapshot list so each row reads at a glance.
function formatRelativeTimestamp(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'just now';
  if (diff < hour) {
    const m = Math.max(1, Math.round(diff / min));
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (diff < day) {
    const h = Math.round(diff / hour);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.round(diff / day);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function formatBackupSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function reasonToMessage(reason) {
  switch (reason) {
    case 'no-key': return 'No key configured';
    case 'invalid': return 'Key was rejected by OpenAI (401)';
    case 'invalid-format': return 'Key should start with sk-';
    case 'no-encryption': return 'OS keychain encryption unavailable on this system';
    case 'network': return 'Network error reaching OpenAI';
    case 'write-failed': return 'Could not save the encrypted key to disk';
    case 'test-failed': return 'Key test failed';
    default:
      if (typeof reason === 'string' && reason.startsWith('http-')) {
        return `OpenAI returned ${reason.replace('http-', 'HTTP ')}`;
      }
      return 'Something went wrong';
  }
}
