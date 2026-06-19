import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Link as LinkIcon, X as XIcon } from 'lucide-react';
import styles from './SaveUrlModal.module.css';
import { requestUpgrade } from '../context/entitlement.jsx';

// Minimal preview derived purely from the URL — used as a fallback when
// the metadata fetch fails (site blocks it, offline, etc.) so a valid
// link always shows *something* rather than silently nothing.
function minimalPreview(raw) {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, '');
    return { url: u.toString(), title: host, siteName: host, image: '', favicon: `${u.origin}/favicon.ico`, description: '' };
  } catch {
    return null;
  }
}

// Compact modal for the toolbar's "+ Add → Save URL…" path.
// Collects a URL, kicks off the main-process capture (screenshot
// the page, store as a save with kind='url'), and surfaces basic
// success/failure feedback. Capture takes a few seconds — the
// modal shows a Saving… state until the IPC resolves.
//
// Closes itself on success after a brief "Saved" flash so the user
// sees confirmation before snapping back to the library.
export default function SaveUrlModal({ open, onClose, onSaved }) {
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedRecord, setSavedRecord] = useState(null);
  // Live preview of the link being entered (title / favicon / cover).
  const [preview, setPreview] = useState(null);
  const [previewState, setPreviewState] = useState('idle'); // idle|loading|done|fail
  const [coverError, setCoverError] = useState(false);
  const previewReqRef = useRef(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      // Reset state whenever the modal is dismissed so a re-open
      // starts fresh.
      setUrl('');
      setSaving(false);
      setError(null);
      setSavedRecord(null);
      setPreview(null);
      setPreviewState('idle');
      setCoverError(false);
      return undefined;
    }
    // Auto-focus the input on open. Slight delay so the modal's
    // mount animation doesn't steal the focus away.
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    // Pre-fill with the clipboard if it looks like a URL — saves a
    // step in the common case of "copy URL from browser, switch to
    // the app, want to save it."
    (async () => {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && /^https?:\/\//i.test(clip.trim())) {
          setUrl(clip.trim());
        }
      } catch { /* clipboard permission may be denied — non-fatal */ }
    })();
    // Escape closes the modal (unless we're mid-save).
    function onKey(e) {
      if (e.key === 'Escape' && !saving) onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
    // `saving` is intentionally excluded — we want the Escape
    // handler to read the latest value at event time, which it
    // does via the closure even without the dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced live preview as the link changes. Only fires for things
  // that look like a URL; tracks the latest request so a slow earlier
  // fetch can't overwrite a newer one.
  useEffect(() => {
    if (!open) return undefined;
    const raw = url.trim();
    const looksUrl = /^https?:\/\//i.test(raw) || /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(raw);
    if (!looksUrl) { setPreview(null); setPreviewState('idle'); return undefined; }
    setPreviewState('loading');
    setCoverError(false);
    const reqId = ++previewReqRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await window.moodmark?.saves?.previewUrl?.(raw);
        if (reqId !== previewReqRef.current) return; // a newer edit superseded this
        if (res?.ok && res.preview) { setPreview(res.preview); setPreviewState('done'); }
        else { const m = minimalPreview(raw); if (m) { setPreview(m); setPreviewState('done'); } else { setPreview(null); setPreviewState('fail'); } }
      } catch {
        if (reqId !== previewReqRef.current) return;
        const m = minimalPreview(raw);
        if (m) { setPreview(m); setPreviewState('done'); } else { setPreview(null); setPreviewState('fail'); }
      }
    }, 450);
    return () => clearTimeout(t);
  }, [url, open]);

  if (!open) return null;

  async function handleSubmit(e) {
    e?.preventDefault?.();
    let target = url.trim();
    if (!target) return;
    // Be forgiving — a bare domain like "example.com/page" gets https://
    // so the user doesn't have to type the scheme.
    if (!/^https?:\/\//i.test(target)) {
      target = `https://${target}`;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await window.moodmark?.saves?.captureUrl?.(target);
      // Free tier — the save was blocked. Close and let the upgrade modal
      // take over instead of showing a misleading "capture failed".
      if (result?.needsUpgrade) {
        onClose?.();
        requestUpgrade('save');
        return;
      }
      if (!result?.ok) {
        setError(result?.error || 'Capture failed. Try again.');
        setSaving(false);
        return;
      }
      setSavedRecord(result.record);
      onSaved?.(result.record, { duplicate: !!result.duplicate });
      // Brief flash so the user sees the success state before the
      // modal closes itself.
      setTimeout(() => {
        onClose?.();
      }, 700);
    } catch (err) {
      setError(err?.message || 'Capture failed. Try again.');
      setSaving(false);
    }
  }

  return ReactDOM.createPortal(
    <div className={styles.scrim} onClick={saving ? undefined : onClose}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label="Save URL"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          disabled={saving}
          aria-label="Close"
        >
          <XIcon size={16} strokeWidth={1.8} />
        </button>

        <div className={styles.headerRow}>
          <span className={styles.icon} aria-hidden="true">
            <LinkIcon size={18} strokeWidth={1.8} />
          </span>
          <h2 className={styles.heading}>Save a URL</h2>
        </div>
        <p className={styles.body}>
          Paste a link — we&rsquo;ll screenshot the page and store it so you can
          revisit the live site from inside Gather.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            ref={inputRef}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck="false"
            placeholder="https://example.com"
            className={styles.input}
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            disabled={saving || !!savedRecord}
            required
          />
          {error && <div className={styles.error}>{error}</div>}

          {previewState === 'loading' && (
            <div className={styles.previewLoading}>
              <span className={styles.previewSpinner} aria-hidden="true" />
              Fetching preview…
            </div>
          )}
          {previewState === 'done' && preview && (
            <div className={styles.preview}>
              {preview.image && !coverError ? (
                <img
                  className={styles.previewThumb}
                  src={preview.image}
                  alt=""
                  onError={() => setCoverError(true)}
                />
              ) : (
                <div className={styles.previewThumbFallback} aria-hidden="true">
                  <LinkIcon size={18} strokeWidth={1.8} />
                </div>
              )}
              <div className={styles.previewMeta}>
                <span className={styles.previewTitle}>{preview.title}</span>
                <span className={styles.previewSite}>
                  {preview.favicon && (
                    <img
                      className={styles.previewFav}
                      src={preview.favicon}
                      alt=""
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  {preview.siteName}
                </span>
                {preview.description && (
                  <span className={styles.previewDesc}>{preview.description}</span>
                )}
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={saving || !!savedRecord || !url.trim()}
            >
              {savedRecord ? 'Saved ✓' : saving ? 'Saving…' : 'Save URL'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
