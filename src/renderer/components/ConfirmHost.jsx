import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import styles from './ConfirmModal.module.css';
import { _subscribe, _resolve } from '../lib/confirm.js';

// Singleton host for imperative confirm() calls. Mount once near the
// root; when confirm(opts) is invoked it surfaces a modal styled to
// match the app and resolves the promise with true/false.
export default function ConfirmHost() {
  const [opts, setOpts] = useState(null);
  const confirmBtnRef = useRef(null);

  useEffect(() => _subscribe(setOpts), []);

  useEffect(() => {
    if (!opts) return undefined;
    // Esc cancels, Enter confirms — matches the affordances of the
    // native confirm dialog this replaces.
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('keydown', onKey);
    // Focus the primary button on open so Enter immediately resolves.
    confirmBtnRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts]);

  function close(value) {
    setOpts(null);
    _resolve(value);
  }

  if (!opts) return null;

  const {
    title,
    message,
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    destructive = false,
  } = opts;

  return ReactDOM.createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
      role="presentation"
    >
      <div
        className={styles.modal}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={message ? 'confirm-message' : undefined}
      >
        <div className={styles.body}>
          {title && (
            <h2 id="confirm-title" className={styles.title}>{title}</h2>
          )}
          {message && (
            <p id="confirm-message" className={styles.message}>{message}</p>
          )}
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={() => close(false)}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`${styles.confirmBtn} ${destructive ? styles.confirmBtnDanger : ''}`}
            onClick={() => close(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
