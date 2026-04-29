import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import styles from './AIUnlockedModal.module.css';

function SparkleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.4l1.5 3.7 3.7 1.5-3.7 1.5L8 11.8 6.5 8.1 2.8 6.6l3.7-1.5z" />
      <path d="M13 9.5l0.6 1.5 1.5 0.6-1.5 0.6L13 13.6l-0.6-1.4-1.5-0.6 1.5-0.6z" opacity="0.55" />
    </svg>
  );
}

function NameIcon() {
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
      <path d="M3.5 4.5h6M3.5 8h9M3.5 11.5h5" />
      <path d="M12.4 9.6l0.4 1 1 0.4-1 0.4L12.4 12.4l-0.4-1-1-0.4 1-0.4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SearchIcon() {
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
      <circle cx="7" cy="7" r="3.75" />
      <path d="M9.65 9.65l3 3" />
      <path d="M12.4 1.6l0.4 1 1 0.4-1 0.4-0.4 1-0.4-1-1-0.4 1-0.4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TagIcon() {
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
      <path d="M2.5 2.5h5l6 6-5 5-6-6V2.5z" />
      <circle cx="5.25" cy="5.25" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PromptIcon() {
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
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M4.5 6.5h7M4.5 9.5h4.5" />
    </svg>
  );
}

const FEATURES = [
  {
    Icon: NameIcon,
    title: 'Auto-named saves',
    description: 'New uploads get a short, descriptive title in the background.',
  },
  {
    Icon: SearchIcon,
    title: 'Visual search',
    description: 'Search by meaning — try “warm editorial photography” or “brutalist architecture”.',
  },
  {
    Icon: TagIcon,
    title: 'Auto-tag any save',
    description: 'One-click tag generation from the details panel.',
  },
  {
    Icon: PromptIcon,
    title: 'Image prompts',
    description: 'Get an AI-generation prompt for any reference, ready to copy.',
  },
];

export default function AIUnlockedModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return ReactDOM.createPortal(
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="AI features unlocked"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.hero}>
          <div className={styles.heroIcon}>
            <SparkleIcon />
          </div>
          <h2 className={styles.title}>AI features unlocked</h2>
          <p className={styles.subtitle}>
            Here’s what’s now available across your library.
          </p>
        </div>

        <ul className={styles.list}>
          {FEATURES.map(({ Icon, title, description }) => (
            <li key={title} className={styles.row}>
              <span className={styles.featureIcon}>
                <Icon />
              </span>
              <div className={styles.featureText}>
                <span className={styles.featureTitle}>{title}</span>
                <span className={styles.featureDesc}>{description}</span>
              </div>
            </li>
          ))}
        </ul>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.gotItBtn}
            onClick={onClose}
            autoFocus
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
