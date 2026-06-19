import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Link as LinkIcon } from 'lucide-react';
import styles from './PasteToSavePrompt.module.css';
import { requestUpgrade } from '../context/entitlement.jsx';

// Paste-aware "save a URL" prompt. When the window regains focus and a
// fresh http(s) link is on the clipboard, this slides in from the corner
// offering a one-tap save with a live preview (favicon / title / cover).
// An "Enter manually" toggle flips it to an editable input so a different
// link is always one click away. Dismissing (or saving) a link suppresses
// it so the prompt never nags about the same URL twice in a session.

function clipboardUrl(raw) {
  const t = (raw || '').trim();
  return /^https?:\/\/\S+$/i.test(t) ? t : '';
}

function minimalPreview(raw) {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, '');
    return { url: u.toString(), title: host, siteName: host, image: '', favicon: `${u.origin}/favicon.ico`, description: '' };
  } catch {
    return null;
  }
}

export default function PasteToSavePrompt({ onSaved, paused = false }) {
  const [link, setLink] = useState('');        // the detected/offered URL
  const [mode, setMode] = useState('clip');    // 'clip' | 'manual'
  const [manualUrl, setManualUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewState, setPreviewState] = useState('idle'); // idle|loading|done|fail
  const [coverError, setCoverError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const handledRef = useRef(new Set());        // urls dismissed/saved this session
  const lastClipRef = useRef('');
  const reqRef = useRef(0);

  function runPreview(raw, delay) {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setPreviewState('loading');
    setCoverError(false);
    const id = ++reqRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await window.moodmark?.saves?.previewUrl?.(normalized);
        if (id !== reqRef.current) return;
        if (res?.ok && res.preview) { setPreview(res.preview); setPreviewState('done'); return; }
      } catch { /* fall through to minimal */ }
      if (id !== reqRef.current) return;
      const m = minimalPreview(normalized);
      setPreview(m);
      setPreviewState(m ? 'done' : 'fail');
    }, delay);
    return t;
  }

  // Detect a copied link when the window regains focus (and on mount).
  useEffect(() => {
    if (paused) return undefined;
    let cancelled = false;
    async function check() {
      let clip = '';
      try { clip = ((await navigator.clipboard.readText()) || '').trim(); }
      catch { return; } // clipboard permission denied — non-fatal
      if (cancelled || !clip || clip === lastClipRef.current) return;
      lastClipRef.current = clip;
      const url = clipboardUrl(clip);
      if (!url || handledRef.current.has(url)) return;
      setLink(url);
      setManualUrl(url);
      setMode('clip');
      setSaved(false);
      setSaving(false);
      runPreview(url, 60);
    }
    check();
    window.addEventListener('focus', check);
    return () => { cancelled = true; window.removeEventListener('focus', check); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // Re-fetch the preview as the manual URL changes (debounced).
  useEffect(() => {
    if (mode !== 'manual') return undefined;
    const raw = manualUrl.trim();
    const looks = /^https?:\/\//i.test(raw) || /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(raw);
    if (!looks) { setPreview(null); setPreviewState('idle'); return undefined; }
    const t = runPreview(raw, 450);
    return () => clearTimeout(t);
  }, [manualUrl, mode]);

  if (!link) return null;

  function targetUrl() {
    let t = (mode === 'manual' ? manualUrl : link).trim();
    if (!t) return '';
    if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
    return t;
  }

  function reset() {
    setLink('');
    setManualUrl('');
    setPreview(null);
    setPreviewState('idle');
    setMode('clip');
    setSaved(false);
    setSaving(false);
  }

  function dismiss() {
    handledRef.current.add(link);
    reset();
  }

  async function save() {
    const t = targetUrl();
    if (!t || saving) return;
    setSaving(true);
    try {
      const res = await window.moodmark?.saves?.captureUrl?.(t);
      if (res?.needsUpgrade) { handledRef.current.add(link); reset(); requestUpgrade('save'); return; }
      if (!res?.ok) { setSaving(false); return; }
      handledRef.current.add(link);
      handledRef.current.add(t);
      setSaved(true);
      onSaved?.(res.record, { duplicate: !!res.duplicate });
      setTimeout(reset, 1000);
    } catch {
      setSaving(false);
    }
  }

  return ReactDOM.createPortal(
    <div className={styles.prompt} role="dialog" aria-label="Save copied link">
      <div className={styles.head}>
        <span className={styles.headLeft}>
          <LinkIcon size={14} strokeWidth={1.9} aria-hidden="true" /> Save a URL
        </span>
        <span className={styles.seg}>
          <button type="button" className={`${styles.segBtn} ${mode === 'clip' ? styles.segOn : ''}`} onClick={() => setMode('clip')}>From clipboard</button>
          <button type="button" className={`${styles.segBtn} ${mode === 'manual' ? styles.segOn : ''}`} onClick={() => setMode('manual')}>Enter manually</button>
        </span>
      </div>

      {mode === 'manual' && (
        <input
          className={styles.input}
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder="https://example.com"
          spellCheck="false"
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      )}

      {previewState === 'loading' && (
        <div className={styles.loading}><span className={styles.spinner} aria-hidden="true" />Fetching preview…</div>
      )}
      {previewState === 'done' && preview && (
        <div className={styles.pv}>
          {preview.image && !coverError ? (
            <img className={styles.thumb} src={preview.image} alt="" onError={() => setCoverError(true)} />
          ) : (
            <div className={styles.thumbFallback} aria-hidden="true"><LinkIcon size={16} strokeWidth={1.8} /></div>
          )}
          <div className={styles.meta}>
            <span className={styles.title}>{preview.title}</span>
            <span className={styles.site}>
              {preview.favicon && (
                <img className={styles.fav} src={preview.favicon} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              )}
              {preview.siteName}
            </span>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.dismiss} onClick={dismiss} disabled={saving}>Dismiss</button>
        <button type="button" className={styles.save} onClick={save} disabled={saving || saved || !targetUrl()}>
          {saved ? 'Saved ✓' : saving ? 'Saving…' : (mode === 'manual' ? 'Save URL' : 'Save this link')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
