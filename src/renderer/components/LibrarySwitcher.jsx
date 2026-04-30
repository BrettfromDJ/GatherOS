import React, { useEffect, useRef, useState } from 'react';
import styles from './LibrarySwitcher.module.css';
import ContextMenu from './ContextMenu.jsx';

// Stacked up/down chevrons — the typical macOS picker / switcher
// glyph. Sits on the left of the library name to signal "click to
// pick a different one" without needing a label.
function SwitcherIcon() {
  return (
    <svg viewBox="0 0 10 12" width="10" height="12" aria-hidden="true">
      <path
        d="M2 4l3-3 3 3M2 8l3 3 3-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path
        d="M2.5 6L5 8.5L9.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path
        d="M6 2v8M2 6h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" fill="currentColor">
      <circle cx="2.5" cy="6" r="1" />
      <circle cx="6" cy="6" r="1" />
      <circle cx="9.5" cy="6" r="1" />
    </svg>
  );
}

// Top-of-sidebar dropdown that shows the active library and lets
// the user switch between libraries. The "···" button to the right
// of the trigger opens a menu with rename / delete actions for the
// active library — to manage a non-active library, switch to it
// first.
export default function LibrarySwitcher({
  libraries,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState('');
  const [actionsMenu, setActionsMenu] = useState(null); // { x, y }
  const triggerRowRef = useRef(null);
  const dropdownRef = useRef(null);
  const renameInputRef = useRef(null);
  const createInputRef = useRef(null);
  const actionsBtnRef = useRef(null);

  const active = libraries.find((l) => l.id === activeId) || libraries[0];
  const canDelete = libraries.length > 1;

  useEffect(() => {
    if (!open) return undefined;
    function onMouseDown(e) {
      const inTriggerRow = triggerRowRef.current && triggerRowRef.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (inTriggerRow || inDropdown) return;
      // The actions context menu portals to body — let its own
      // outside-click handler manage closing.
      const inCtx = e.target.closest('[role="menu"]');
      if (inCtx) return;
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        if (creating) {
          setCreating(false);
          setCreateDraft('');
        } else {
          setOpen(false);
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

  function startRenameActive() {
    if (!active) return;
    setRenaming(true);
    setRenameDraft(active.name);
    setActionsMenu(null);
    requestAnimationFrame(() => renameInputRef.current?.select());
  }

  async function commitRename() {
    const next = renameDraft.trim();
    setRenaming(false);
    setRenameDraft('');
    if (!next || !active || next === active.name) return;
    await onRename?.(active.id, next);
  }

  function startCreating() {
    setCreating(true);
    setCreateDraft('');
    requestAnimationFrame(() => createInputRef.current?.focus());
  }

  async function commitCreate() {
    const name = createDraft.trim();
    setCreating(false);
    setCreateDraft('');
    if (!name) return;
    await onCreate?.(name);
  }

  function openActionsMenu() {
    if (!actionsBtnRef.current) return;
    const rect = actionsBtnRef.current.getBoundingClientRect();
    setActionsMenu({ x: rect.left, y: rect.bottom + 4 });
  }

  async function handleDeleteActive() {
    setActionsMenu(null);
    if (!active) return;
    const confirmed = window.confirm(
      `Delete the library "${active.name}"? Every save, bucket, and image inside it will be permanently removed.`,
    );
    if (!confirmed) return;
    await onDelete?.(active.id);
  }

  if (!active) return null;

  // Hide Delete when there's only one library — that's the
  // last-remaining-library guard, enforced server-side too.
  const actionItems = [
    { label: 'Rename', onClick: startRenameActive },
    ...(canDelete
      ? [{ label: 'Delete library', danger: true, onClick: handleDeleteActive }]
      : []),
  ];

  return (
    <div className={styles.wrap}>
      <div ref={triggerRowRef} className={styles.triggerRow}>
        {renaming ? (
          <input
            ref={renameInputRef}
            autoFocus
            className={styles.triggerRenameInput}
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setRenaming(false);
                setRenameDraft('');
              }
            }}
            onBlur={commitRename}
          />
        ) : (
          <button
            type="button"
            className={[styles.trigger, open && styles.triggerOpen]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            title={active.name}
          >
            <span className={styles.triggerSwitcher}>
              <SwitcherIcon />
            </span>
            <span className={styles.triggerLabel}>{active.name}</span>
          </button>
        )}
        <button
          ref={actionsBtnRef}
          type="button"
          className={styles.actionsBtn}
          onClick={openActionsMenu}
          aria-label={`${active.name} actions`}
          title="Library actions"
        >
          <DotsIcon />
        </button>
      </div>

      {open && (
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          role="listbox"
          aria-label="Libraries"
        >
          {libraries.map((lib) => {
            const isActive = lib.id === active.id;
            return (
              <button
                key={lib.id}
                type="button"
                className={[styles.row, isActive && styles.rowActive]
                  .filter(Boolean)
                  .join(' ')}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  if (!isActive) onSwitch?.(lib.id);
                  setOpen(false);
                }}
              >
                <span className={styles.rowCheck}>
                  {isActive ? <CheckIcon /> : null}
                </span>
                <span className={styles.rowLabel}>{lib.name}</span>
              </button>
            );
          })}

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
        </div>
      )}

      {actionsMenu && (
        <ContextMenu
          x={actionsMenu.x}
          y={actionsMenu.y}
          items={actionItems}
          onClose={() => setActionsMenu(null)}
        />
      )}
    </div>
  );
}
