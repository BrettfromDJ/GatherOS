import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import styles from './ShortcutsModal.module.css';

const SECTIONS = [
  {
    title: 'Search',
    items: [
      { keys: ['⌘', 'K'], label: 'Open quick switcher' },
    ],
  },
  {
    title: 'Library',
    items: [
      { keys: ['⌘', 'N'], label: 'New collection' },
      { keys: ['⌘', 'V'], label: 'Paste image from clipboard' },
      { keys: ['⌘ +', 'click'], label: 'Multi-select an image' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { keys: ['⌘', 'A'], label: 'Select all visible images' },
      { keys: ['⌘ ⇧', 'A'], label: 'Clear selection' },
      { keys: ['Delete'], label: 'Delete selected images' },
      { keys: ['Esc'], label: 'Clear selection' },
    ],
  },
  {
    title: 'Focused image',
    items: [
      { keys: ['J', 'or', '→'], label: 'Next image' },
      { keys: ['K', 'or', '←'], label: 'Previous image' },
      { keys: ['Esc'], label: 'Back to grid' },
    ],
  },
];

export default function ShortcutsModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
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
        aria-label="Keyboard shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Keyboard Shortcuts</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className={styles.body}>
          {SECTIONS.map((section) => (
            <section key={section.title} className={styles.section}>
              <div className={styles.sectionTitle}>{section.title}</div>
              <ul className={styles.list}>
                {section.items.map((item) => (
                  <li key={item.label} className={styles.row}>
                    <span className={styles.rowLabel}>{item.label}</span>
                    <span className={styles.rowKeys}>
                      {item.keys.map((k, i) =>
                        // Tiny join words like "or" render as plain text;
                        // everything else is a kbd chip.
                        /^(or|\+|·)$/.test(k.trim()) ? (
                          <span key={i} className={styles.kbdSep}>{k}</span>
                        ) : (
                          <kbd key={i} className={styles.kbd}>{k}</kbd>
                        ),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
