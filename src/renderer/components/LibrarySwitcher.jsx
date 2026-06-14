import React, { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Check, Plus, Settings as SettingsIcon, SquareLibrary, Search } from 'lucide-react';
import styles from './LibrarySwitcher.module.css';
import { fileUrl } from '../lib/fileUrl.js';

const SwitcherIcon = () => <ChevronsUpDown size={15} strokeWidth={2} aria-hidden="true" />;
const CheckIcon = () => <Check size={14} strokeWidth={2} aria-hidden="true" />;
const PlusIcon = () => <Plus size={14} strokeWidth={2} aria-hidden="true" />;
const ManageIcon = () => <SettingsIcon size={14} strokeWidth={1.8} aria-hidden="true" />;
const LibraryRowIcon = () => <SquareLibrary size={15} strokeWidth={1.8} aria-hidden="true" />;
const SearchIcon = () => <Search size={14} strokeWidth={1.9} aria-hidden="true" />;

// Up-to-three stacked thumbnails of a library's most recent saves, so
// you recognise libraries by their contents. Falls back to the glyph
// for an empty library.
function LibraryCover({ covers }) {
  const imgs = Array.isArray(covers) ? covers.slice(0, 3) : [];
  if (imgs.length === 0) {
    return (
      <span className={styles.coverEmpty} aria-hidden="true">
        <LibraryRowIcon />
      </span>
    );
  }
  return (
    <span className={styles.cover} aria-hidden="true">
      {imgs.map((p, i) => (
        <img key={i} className={styles.coverImg} src={fileUrl(p)} alt="" draggable={false} />
      ))}
    </span>
  );
}

// Top-of-toolbar dropdown that shows the active library and lets the
// user switch between libraries. The "···" actions button beside the
// trigger was retired in nav stage 9 — rename / delete moved to a
// dedicated Libraries settings page, reachable via the "Manage
// libraries" link at the bottom of the dropdown.
export default function LibrarySwitcher({
  libraries,
  activeId,
  onSwitch,
  onCreate,
  onOpenManage,
  onOpen,
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState('');
  const [filter, setFilter] = useState('');
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const createInputRef = useRef(null);

  const active = libraries.find((l) => l.id === activeId) || libraries[0];

  // Reset the filter each time the dropdown closes so it opens clean.
  useEffect(() => {
    if (!open) setFilter('');
  }, [open]);

  const showFilter = libraries.length > 0;
  const q = filter.trim().toLowerCase();
  const filteredLibraries = q
    ? libraries.filter((l) => l.name.toLowerCase().includes(q))
    : libraries;

  useEffect(() => {
    if (!open) return undefined;
    function onMouseDown(e) {
      const inTrigger = triggerRef.current && triggerRef.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (inTrigger || inDropdown) return;
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        if (creating) {
          setCreating(false);
          setCreateDraft('');
        } else {
          setOpen(false);
          triggerRef.current?.blur(); // no phantom focus ring after click → Esc
        }
      }
    }
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, creating]);

  function startCreating() {
    setCreating(true);
    setCreateDraft('');
    requestAnimationFrame(() => createInputRef.current?.focus());
  }

  async function commitCreate() {
    const next = createDraft.trim();
    setCreating(false);
    setCreateDraft('');
    if (!next) return;
    await onCreate?.(next);
  }

  if (!active) return null;

  return (
    <div className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={[styles.trigger, open && styles.triggerOpen]
          .filter(Boolean)
          .join(' ')}
        onClick={() => setOpen((v) => {
          const next = !v;
          // Refresh covers/counts on open so a library you just added
          // saves to shows fresh thumbnails without an app restart.
          if (next) onOpen?.();
          return next;
        })}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-tooltip={open ? undefined : active.name}
        data-tooltip-pos="below"
      >
        <span className={styles.triggerLabel}>{active.name}</span>
        <span className={styles.triggerSwitcher}>
          <SwitcherIcon />
        </span>
      </button>

      {open && (
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          role="listbox"
          aria-label="Libraries"
        >
          {showFilter && (
            <div className={styles.filter}>
              <span className={styles.filterIcon}><SearchIcon /></span>
              <input
                className={styles.filterInput}
                placeholder="Find a library…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Find a library"
              />
            </div>
          )}

          <div className={styles.sectionLabel}>Libraries</div>

          <div className={styles.dropdownGroup}>
            {filteredLibraries.map((lib, idx) => {
              const isActive = lib.id === active.id;
              const count = typeof lib.save_count === 'number' ? lib.save_count : 0;
              return (
                <button
                  key={lib.id}
                  type="button"
                  className={[styles.row, styles.rowLibrary, isActive && styles.rowActive]
                    .filter(Boolean)
                    .join(' ')}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    if (!isActive) onSwitch?.(lib.id);
                    setOpen(false);
                  }}
                  style={{ '--idx': idx }}
                >
                  <LibraryCover covers={lib.covers} />
                  <span className={styles.rowMain}>
                    <span className={styles.rowName}>{lib.name}</span>
                    <span className={styles.rowSub}>
                      {count} {count === 1 ? 'save' : 'saves'}
                    </span>
                  </span>
                  <span className={styles.rowCheck}>
                    {isActive ? <CheckIcon /> : null}
                  </span>
                </button>
              );
            })}
            {filteredLibraries.length === 0 && (
              <div className={styles.empty}>No libraries match “{filter.trim()}”.</div>
            )}
          </div>

          <div className={styles.divider} />

          {creating ? (
            <div className={`${styles.row} ${styles.rowCreating}`}>
              <span className={styles.rowCheck}>
                <PlusIcon />
              </span>
              <input
                ref={createInputRef}
                autoFocus
                className={styles.rowRenameInput}
                placeholder="New library"
                value={createDraft}
                onChange={(e) => setCreateDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitCreate();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setCreating(false);
                    setCreateDraft('');
                  }
                }}
                onBlur={commitCreate}
              />
            </div>
          ) : (
            <button
              type="button"
              className={`${styles.row} ${styles.rowAction}`}
              onClick={startCreating}
            >
              <span className={styles.rowCheck}>
                <PlusIcon />
              </span>
              <span className={styles.rowLabel}>New library</span>
            </button>
          )}

          {onOpenManage && (
            <button
              type="button"
              className={`${styles.row} ${styles.rowAction}`}
              onClick={() => {
                setOpen(false);
                onOpenManage();
              }}
            >
              <span className={styles.rowCheck}>
                <ManageIcon />
              </span>
              <span className={styles.rowLabel}>Manage libraries</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
