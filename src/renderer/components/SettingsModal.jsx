import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import styles from './SettingsModal.module.css';

const STATUS_IDLE = 'idle';
const STATUS_TESTING = 'testing';
const STATUS_OK = 'ok';
const STATUS_ERROR = 'error';

export default function SettingsModal({ open, onClose, onConfiguredChange, onPrefsChange }) {
  const [hasKey, setHasKey] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState(STATUS_IDLE);
  const [errorMessage, setErrorMessage] = useState('');
  const [prefs, setPrefs] = useState({ autoNameOnSave: true });
  const [unindexed, setUnindexed] = useState(0);
  const [reindexState, setReindexState] = useState({ running: false, processed: 0, total: 0 });
  const inputRef = useRef(null);

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
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
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

          <label className={styles.fieldLabel} htmlFor="openai-key-input">
            API Key
          </label>
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

        <section className={styles.section}>
          <div className={styles.sectionTitle}>AI Features</div>
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
              <span className={styles.toggleLabel}>Semantic search</span>
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
