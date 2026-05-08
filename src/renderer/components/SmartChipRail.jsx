import React from 'react';
import styles from './SmartChipRail.module.css';

// Smart-view sub-menu strip. Replaces the SMART_VIEWS section that
// lived in the sidebar. Renders as plain text labels separated by
// generous gaps, sitting above a hairline divider. Active label is
// ink, inactive labels are tertiary — typographic restraint.
const CHIPS = [
  { id: 'all',      label: 'All' },
  { id: 'unsorted', label: 'Unsorted' },
  { id: 'trash',    label: 'Trash' },
];

export default function SmartChipRail({
  activeViewType = 'all',
  counts = { all: 0, unsorted: 0, trash: 0 },
  onPick,
}) {
  return (
    <div className={styles.rail} role="tablist" aria-label="Smart views">
      {CHIPS.map(({ id, label }) => {
        const isActive = activeViewType === id;
        const count = counts[id] ?? 0;
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
            {count > 0 && (
              <span className={styles.chipBadge}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
