import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Instagram, LoaderCircle, Square, X } from 'lucide-react';
import styles from './SocialImportActivity.module.css';
import { toSocialImportView } from '../lib/socialImportView.mjs';

function PlatformIcon({ platform }) {
  if (platform === 'instagram') return <Instagram size={16} strokeWidth={1.8} aria-hidden="true" />;
  return <span className={styles.xIcon} aria-hidden="true">𝕏</span>;
}

export default function SocialImportActivity({
  snapshot,
  onCancel,
  onDismiss,
  now = Date.now(),
}) {
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef(null);
  const view = useMemo(() => toSocialImportView(snapshot, { now }), [snapshot, now]);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setExpanded(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  useEffect(() => {
    if (view?.terminal) setExpanded(false);
  }, [view?.terminal, view?.runId]);

  if (!view) return null;

  const terminal = view.terminal;
  const busy = view.stage === 'stopping';
  const stageText = view.stalled ? 'Import may be stalled' : view.stageName;
  const summary = `${stageText}; ${plural(view.saved, 'new save')} saved`;
  const toggle = () => { if (!terminal) setExpanded((value) => !value); };

  return (
    <div
      className={styles.activity}
      data-terminal={terminal ? 'true' : 'false'}
    >
      {terminal && (
        <button
          type="button"
          className={styles.dismiss}
          aria-label="Dismiss import notification"
          onClick={() => onDismiss?.(view.runId)}
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-expanded={expanded}
        aria-label={`${view.headline}. ${summary}${terminal ? '' : '. Show import details'}`}
        disabled={terminal}
        onClick={toggle}
      >
        {!terminal && <LoaderCircle className={styles.spinner} size={16} strokeWidth={2} aria-hidden="true" />}
        {terminal && <span className={styles.terminalDot} aria-hidden="true" />}
        <PlatformIcon platform={view.platform} />
        <span className={styles.triggerText}>
          <span className={styles.headline}>{view.headline}</span>
          <span className={styles.stage} aria-live="polite">{summary}</span>
        </span>
      </button>

      {expanded && !terminal && (
        <section className={styles.card} aria-label={`${view.platformName} import details`}>
          <div className={styles.cardHeader}>
            <div>
              <div className={styles.eyebrow}>{view.modeName}</div>
              <h2>{view.headline}</h2>
            </div>
            <span className={styles.elapsed}>{view.elapsed}</span>
          </div>
          <div className={styles.stageDetail} role="status" aria-live="polite">
            {view.stalled ? 'Import may be stalled' : view.stageName}
          </div>
          <dl className={styles.counts}>
            <div><dt>Scanned</dt><dd>{view.scanned}</dd></div>
            <div><dt>Newly saved</dt><dd>{view.saved}</dd></div>
            <div><dt>Already known</dt><dd>{view.known}</dd></div>
            <div><dt>Failed</dt><dd>{view.failed}</dd></div>
          </dl>
          <button
            type="button"
            className={styles.stop}
            onClick={(event) => { event.stopPropagation(); onCancel?.(view.runId); }}
            disabled={busy || terminal}
          >
            <Square size={13} fill="currentColor" aria-hidden="true" />
            {busy ? 'Stopping…' : 'Stop import'}
          </button>
        </section>
      )}
    </div>
  );
}

function plural(value, singular) {
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}
