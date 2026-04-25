import React from 'react';
import styles from './Toolbar.module.css';

function GridSmallIcon() {
  return (
    <svg className={styles.zoomIcon} viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="2"  y="2"  width="2.5" height="2.5" rx="0.5" />
      <rect x="6"  y="2"  width="2.5" height="2.5" rx="0.5" />
      <rect x="10" y="2"  width="2.5" height="2.5" rx="0.5" />
      <rect x="2"  y="6"  width="2.5" height="2.5" rx="0.5" />
      <rect x="6"  y="6"  width="2.5" height="2.5" rx="0.5" />
      <rect x="10" y="6"  width="2.5" height="2.5" rx="0.5" />
      <rect x="2"  y="10" width="2.5" height="2.5" rx="0.5" />
      <rect x="6"  y="10" width="2.5" height="2.5" rx="0.5" />
      <rect x="10" y="10" width="2.5" height="2.5" rx="0.5" />
    </svg>
  );
}

function GridLargeIcon() {
  return (
    <svg className={styles.zoomIcon} viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="4.5" height="4.5" rx="0.75" />
      <rect x="7.5" y="2" width="4.5" height="4.5" rx="0.75" />
      <rect x="2" y="7.5" width="4.5" height="4.5" rx="0.75" />
      <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="0.75" />
    </svg>
  );
}

const COLS_MIN = 2;
const COLS_MAX = 8;

export default function Toolbar({
  search,
  onSearchChange,
  columns,
  onColumnsChange,
  count,
}) {
  // Slider is inverted so dragging right = bigger cards = fewer columns.
  const sliderValue = COLS_MAX + COLS_MIN - columns;
  return (
    <div className={styles.toolbar}>
      <div className={styles.searchWrap}>
        <span className={styles.searchIcon}>⌕</span>
        <input
          className={styles.search}
          type="search"
          placeholder="Search by title or tag"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {count != null && (
        <span className={styles.count}>
          {count} {count === 1 ? 'save' : 'saves'}
        </span>
      )}

      <div className={styles.zoom} title="Card size">
        <GridSmallIcon />
        <input
          type="range"
          min={COLS_MIN}
          max={COLS_MAX}
          step={1}
          value={sliderValue}
          onChange={(e) =>
            onColumnsChange(COLS_MAX + COLS_MIN - Number(e.target.value))
          }
          className={styles.slider}
          aria-label="Card size"
        />
        <GridLargeIcon />
      </div>
    </div>
  );
}
