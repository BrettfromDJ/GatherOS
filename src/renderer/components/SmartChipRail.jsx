import React from 'react';
import { ChevronLeft } from 'lucide-react';
import styles from './SmartChipRail.module.css';
import Dropdown from './Dropdown.jsx';

const CHIPS = [
  { id: 'all',      label: 'All' },
  { id: 'unsorted', label: 'Unsorted' },
  { id: 'trash',    label: 'Trash' },
];

export const SORT_OPTIONS = [
  { value: 'recent',    label: 'Most recent' },
  { value: 'oldest',    label: 'Oldest first' },
  { value: 'name_asc',  label: 'Name A→Z' },
  { value: 'name_desc', label: 'Name Z→A' },
];

const COLS_MIN = 2;
const COLS_MAX = 8;

// Smart-view sub-menu strip. Three-segment text nav on the left
// (active gets a black underline), a sort-by dropdown and the
// masonry zoom slider clustered on the right. Hairline divider
// underneath separates this row from the grid.
export default function SmartChipRail({
  activeViewType = 'all',
  counts = { all: 0, unsorted: 0, trash: 0 },
  onPick,
  sortMode = 'recent',
  onSortChange,
  columns,
  onColumnsChange,
  // When the user drills into a folder, the rail's left cluster
  // swaps the All/Unsorted/Trash chips for a back button + folder
  // title. Sort + zoom on the right stay regardless.
  viewTitle = null,
  onBack = null,
}) {
  // Slider is inverted so dragging right = bigger cards = fewer columns.
  const sliderValue = (typeof columns === 'number')
    ? COLS_MAX + COLS_MIN - columns
    : COLS_MIN;
  const inFolder = !!viewTitle;
  return (
    <div className={styles.rail} role={inFolder ? undefined : 'tablist'} aria-label={inFolder ? undefined : 'Smart views'}>
      <div className={styles.left}>
        {inFolder ? (
          <>
            {onBack && (
              <button
                type="button"
                className={styles.backBtn}
                onClick={onBack}
                title="Back to all"
                aria-label="Back to all"
              >
                <ChevronLeft size={18} strokeWidth={1.6} aria-hidden="true" />
              </button>
            )}
            <span className={styles.title} title={viewTitle}>
              {viewTitle}
            </span>
          </>
        ) : (
          CHIPS.map(({ id, label }) => {
            const isActive = activeViewType === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
                onClick={() => onPick({ type: id })}
              >
                <span className={styles.chipLabel}>{label}</span>
              </button>
            );
          })
        )}
      </div>
      <div className={styles.right}>
        {onColumnsChange && (
          <div className={styles.zoom} title="Card size">
            <input
              type="range"
              min={COLS_MIN}
              max={COLS_MAX}
              step={1}
              value={sliderValue}
              onChange={(e) =>
                onColumnsChange(COLS_MAX + COLS_MIN - Number(e.target.value))
              }
              className={styles.zoomSlider}
              aria-label="Card size"
            />
          </div>
        )}
        {onSortChange && (
          <Dropdown
            value={sortMode}
            options={SORT_OPTIONS}
            onChange={onSortChange}
            ariaLabel="Sort by"
          />
        )}
      </div>
    </div>
  );
}
