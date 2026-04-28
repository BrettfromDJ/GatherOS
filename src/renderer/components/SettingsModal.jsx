import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import styles from './SettingsModal.module.css';

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

export default function SettingsModal({ open, onClose, onConfiguredChange, onPrefsChange, onLibraryWiped }) {
  const [hasKey, setHasKey] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState(STATUS_IDLE);
  const [errorMessage, setErrorMessage] = useState('');
  const [prefs, setPrefs] = useState({ autoNameOnSave: true });
  const [unindexed, setUnindexed] = useState(0);
  const [reindexState, setReindexState] = useState({ running: false, processed: 0, total: 0 });
  const [exportState, setExportState] = useState({ running: false, message: null });
  const [wipeState, setWipeState] = useState({ running: false, message: null });
  const [aiOpen, setAiOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
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
      onConfiguredChange?.(true);
      // Brief success state then close
      setTimeout(() => {
        if (status !== STATUS_ERROR) onClose();
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
          <div className={styles.sectionTitle}>OpenAI</div>
          <p className={styles.sectionHint}>
            Bring your own key to enable AI features like auto-tagging. Your key is encrypted with the system keychain and stored locally.
            Image data goes directly from your machine to OpenAI — never through anyone else.
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
          <p className={styles.sectionHint}>
            Each new upload runs once. Disable any feature you don't want billed against your key.
          </p>
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
                checked={!!prefs.autoNameOnSave}
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
                checked={!!prefs.semanticSearch}
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
              className={styles.btn}
              onClick={handleExportLibrary}
              disabled={exportState.running}
            >
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
            Erase your entire library — every save, bucket, and tag. The
            underlying image files are deleted from disk. This cannot be
            undone.
          </p>
          <div className={styles.actions} style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={handleWipeLibrary}
              disabled={wipeState.running}
            >
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
      </div>
    </div>,
    document.body,
  );
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
