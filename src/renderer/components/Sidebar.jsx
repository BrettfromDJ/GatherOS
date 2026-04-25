import React from 'react';
import styles from './Sidebar.module.css';

function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="5.5" height="5.5" rx="1.2" />
      <rect x="8.5" y="2" width="5.5" height="5.5" rx="1.2" />
      <rect x="2" y="8.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.2" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.6l1.96 4.05 4.46.59-3.27 3.1.83 4.42L8 11.65l-3.98 2.11.83-4.42L1.58 6.24l4.46-.59z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13A6.5 6.5 0 0 0 8 1.5zm0 1.4a5.1 5.1 0 1 1 0 10.2A5.1 5.1 0 0 1 8 2.9z" />
      <path d="M7.3 4.4h1.4v3.9l2.7 1.55-.7 1.2-3.4-1.97V4.4z" />
    </svg>
  );
}

const SMART_VIEWS = [
  { id: 'all', label: 'All Saves', color: 'var(--icon-blue)', Icon: GridIcon },
  { id: 'favorites', label: 'Favorites', color: 'var(--icon-orange)', Icon: StarIcon },
  { id: 'recent', label: 'Recent', color: 'var(--icon-yellow)', Icon: ClockIcon },
];

export default function Sidebar({ view, onViewChange, collections = [], counts = {} }) {
  return (
    <aside className={styles.sidebar}>
      <nav className={styles.section}>
        {SMART_VIEWS.map(({ id, label, color, Icon }) => {
          const active = view.type === id;
          return (
            <button
              key={id}
              className={`${styles.item} ${active ? styles.active : ''}`}
              onClick={() => onViewChange({ type: id })}
            >
              <span
                className={styles.icon}
                style={{ color: active ? '#fff' : color }}
              >
                <Icon />
              </span>
              <span className={styles.label}>{label}</span>
              {counts[id] != null && <span className={styles.count}>{counts[id]}</span>}
            </button>
          );
        })}
      </nav>

      <div className={styles.sectionHeader}>Collections</div>
      <nav className={styles.section}>
        {collections.length === 0 ? (
          <div className={styles.empty}>No collections yet</div>
        ) : (
          collections.map((c) => {
            const active = view.type === 'collection' && view.id === c.id;
            return (
              <button
                key={c.id}
                className={`${styles.item} ${active ? styles.active : ''}`}
                onClick={() => onViewChange({ type: 'collection', id: c.id })}
              >
                <span className={styles.dot} style={{ background: c.color }} />
                <span className={styles.label}>{c.name}</span>
                {counts[c.id] != null && (
                  <span className={styles.count}>{counts[c.id]}</span>
                )}
              </button>
            );
          })
        )}
      </nav>
    </aside>
  );
}
