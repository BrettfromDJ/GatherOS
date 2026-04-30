import React, { useEffect, useRef, useState } from 'react';
import styles from './SidebarSearch.module.css';

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="3.5" />
      <path d="M8.5 8.5l3 3" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

// Compact sidebar search. Collapsed state is a button-shaped row
// with just the search icon + a soft label; clicking expands it
// into a focused text input bound to the same `value` the toolbar
// search uses, so both inputs stay in sync. Escape, the clear
// button, or blur-when-empty collapse it back.
export default function SidebarSearch({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  // If an external code path set the search value, expand the row
  // so it reflects the active query — matches the toolbar's input.
  useEffect(() => {
    if (value) setOpen(true);
  }, [value]);

  function handleExpand() {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleClear() {
    onChange?.('');
    setOpen(false);
  }

  function handleBlur() {
    // Auto-collapse only when the user leaves the field with no
    // active query — prevents a stray click from hiding the
    // currently-applied search.
    if (!value) setOpen(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClear();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className={styles.collapsed}
        onClick={handleExpand}
        title="Search saves"
      >
        <span className={styles.icon}>
          <SearchIcon />
        </span>
        <span className={styles.collapsedLabel}>Search</span>
      </button>
    );
  }

  return (
    <div className={styles.expanded}>
      <span className={styles.icon}>
        <SearchIcon />
      </span>
      <input
        ref={inputRef}
        type="text"
        className={styles.input}
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="Search by title or tag"
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          className={styles.clearBtn}
          onClick={handleClear}
          tabIndex={-1}
          aria-label="Clear search"
        >
          <ClearIcon />
        </button>
      )}
    </div>
  );
}
