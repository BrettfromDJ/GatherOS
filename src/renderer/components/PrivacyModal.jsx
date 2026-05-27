import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import styles from './PrivacyModal.module.css';

// Plain-language privacy summary mirrored from PRIVACY.md. Kept short
// enough to scan in one sitting; for the full long-form text the
// "View full policy" link opens the GitHub copy.

const POLICY_URL = 'https://github.com/BrettfromDJ/GatherOS/blob/main/PRIVACY.md';
const SUPPORT_EMAIL = 'hey@gatheros.co';

const SECTIONS = [
  {
    title: 'Local-first',
    body:
      'Every save, collection, tag, and note lives in ' +
      '~/Library/Application Support/GatherOS/ on your machine. ' +
      'GatherOS doesn’t run servers — nothing in that folder is uploaded by us.',
  },
  {
    title: 'No tracking',
    body:
      'We don’t collect analytics, telemetry, or crash reports. ' +
      'We don’t require an account. We don’t show ads or share ' +
      'data with third parties.',
  },
  {
    title: 'Your OpenAI key',
    body:
      'When you supply an OpenAI key, it’s stored in the macOS ' +
      'Keychain (encrypted by the OS). It’s used only to authenticate ' +
      'requests sent directly from your machine to api.openai.com. ' +
      'We never see it.',
  },
  {
    title: 'AI features and OpenAI',
    body:
      'When AI features are on, GatherOS sends image data and short ' +
      'text snippets to OpenAI on your behalf. OpenAI handles that data ' +
      'under their own terms. Toggle the features off and no calls are made.',
  },
  {
    title: 'Auto-updates',
    body:
      'GatherOS checks GitHub Releases for new builds over HTTPS. ' +
      'GitHub logs standard request info; nothing app-specific is added.',
  },
];

export default function PrivacyModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function openExternal(e, url) {
    e.preventDefault();
    window.moodmark.shell.openUrl(url);
  }

  return ReactDOM.createPortal(
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Privacy"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Privacy</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className={styles.body}>
          <p className={styles.lede}>
            The short version: almost nothing leaves your machine, and what does
            is sent on your direct instruction.
          </p>

          {SECTIONS.map(({ title, body }) => (
            <section key={title} className={styles.section}>
              <div className={styles.sectionTitle}>{title}</div>
              <p className={styles.sectionBody}>{body}</p>
            </section>
          ))}

          <div className={styles.footerLinks}>
            <a
              href={POLICY_URL}
              onClick={(e) => openExternal(e, POLICY_URL)}
              className={styles.link}
            >
              View full policy
            </a>
            <span className={styles.dot}>·</span>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              onClick={(e) => openExternal(e, `mailto:${SUPPORT_EMAIL}`)}
              className={styles.link}
            >
              Email support
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
