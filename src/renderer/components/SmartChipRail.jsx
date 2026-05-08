import React from 'react';
import { Grid as GridIcon, Inbox, Calendar, Trash2 } from 'lucide-react';
import styles from './SmartChipRail.module.css';

const ICON = { size: 14, strokeWidth: 1.7, 'aria-hidden': true };

// Smart views as a top-of-Library chip rail. Replaces the SMART_VIEWS
// section that lived in the sidebar. Each chip flips view.type and
// renders its count inline; the Unsorted chip swaps the count for a
// tiny check icon when the inbox is at zero ("inbox zero" reward).
const CHIPS = [
  { id: 'all',       label: 'All',         Icon: () => <GridIcon {...ICON} /> },
  { id: 'unsorted',  label: 'Unsorted',    Icon: () => <Inbox    {...ICON} /> },
  { id: 'onThisDay', label: 'On this day', Icon: () => <Calendar {...ICON} /> },
  { id: 'trash',     label: 'Trash',       Icon: () => <Trash2   {...ICON} /> },
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M3 8.5 L6.5 12 L13 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function SmartChipRail({
  activeViewType = 'all',
  counts = { all: 0, unsorted: 0, trash: 0, onThisDay: 0 },
  onPick,
}) {
  return (
    <div className={styles.rail} role="tablist" aria-label="Smart views">
      {CHIPS.map(({ id, label, Icon }) => {
        const isActive = activeViewType === id;
        const count = counts[id] ?? 0;
        const inboxZero = id === 'unsorted' && count === 0;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
            onClick={() => onPick({ type: id })}
            title={inboxZero ? 'Inbox zero — every save is in a folder' : undefined}
          >
            <span className={styles.chipIcon}><Icon /></span>
            <span className={styles.chipLabel}>{label}</span>
            {inboxZero ? (
              <span className={`${styles.chipBadge} ${styles.chipBadgeZero}`}>
                <CheckIcon />
              </span>
            ) : count > 0 ? (
              <span className={styles.chipBadge}>{count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
