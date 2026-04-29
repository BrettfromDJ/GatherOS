import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import styles from './WelcomeModal.module.css';

function WaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c0.55 0 1 0.45 1 1v0.6a4 4 0 0 1 3 3.86V11h.5a2.5 2.5 0 0 1 2.5 2.5v3.36a6.14 6.14 0 0 1-1.6 4.14L16 22.6a1 1 0 0 1-.74.32H9.7a1 1 0 0 1-.86-.5l-2.6-4.45a1.6 1.6 0 0 1 2.62-1.81L10 17.4V8.5A1.5 1.5 0 0 1 11.5 7v-4c0-0.55 0.45-1 1-1z" opacity="0.92" />
    </svg>
  );
}

function DropIcon() {
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
      <path d="M8 1.5v8.5" />
      <path d="M4.5 7L8 10.5 11.5 7" />
      <path d="M2.5 12.25v1.25a0.5 0.5 0 0 0 0.5 0.5h10a0.5 0.5 0 0 0 0.5 -0.5v-1.25" />
    </svg>
  );
}

function ScissorsIcon() {
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
      <path d="M2 2h2.5v2.5H2zM11.5 2H14v2.5h-2.5zM2 11.5h2.5V14H2zM11.5 11.5H14V14h-2.5z" />
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
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </svg>
  );
}

function BucketIcon() {
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
      <path d="M2.75 3.5h10.5l-1 9.25a0.75 0.75 0 0 1 -0.75 0.75H4.5a0.75 0.75 0 0 1 -0.75 -0.75z" />
      <path d="M5.5 3.5C5.5 2 6.5 1.25 8 1.25s2.5 0.75 2.5 2.25" />
    </svg>
  );
}

const FEATURES = [
  {
    Icon: DropIcon,
    title: 'Drop anything in',
    description: 'Drag an image, file, or URL anywhere in the window — it’s saved instantly.',
  },
  {
    Icon: ScissorsIcon,
    title: 'Screenshot to save',
    description: 'Press ⌘⇧S anywhere on your Mac to crop a region straight into your library.',
  },
  {
    Icon: SearchIcon,
    title: 'Find it fast',
    description: 'Press ⌘K to jump to any save by title or tag, from anywhere in the app.',
  },
  {
    Icon: BucketIcon,
    title: 'Organize with Buckets',
    description: 'Create collections in the sidebar to group references by project, brief, or vibe.',
  },
];

export default function WelcomeModal({ open, onClose }) {
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
        aria-label="Welcome to GatherOS"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.hero}>
          <div className={styles.heroIcon}>
            <WaveIcon />
          </div>
          <h2 className={styles.title}>Welcome to GatherOS</h2>
          <p className={styles.subtitle}>
            We dropped a few starter images in to get you going. Here’s how to add your own.
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
            Let’s go
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
