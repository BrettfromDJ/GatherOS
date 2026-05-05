import React, { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Check, Plus, MoreHorizontal, Pencil, FolderOpen, Trash2 } from 'lucide-react';
import styles from './LibrarySwitcher.module.css';
import ContextMenu from './ContextMenu.jsx';
import { CollectionIcon } from './Sidebar.jsx';
import { fileUrl } from '../lib/fileUrl.js';

const SwitcherIcon = () => <ChevronsUpDown size={15} strokeWidth={2} aria-hidden="true" />;
const CheckIcon = () => <Check size={11} strokeWidth={1.8} aria-hidden="true" />;
const PlusIcon = () => <Plus size={11} strokeWidth={1.8} aria-hidden="true" />;
const DotsIcon = () => <MoreHorizontal size={12} strokeWidth={2} aria-hidden="true" />;

// Mini fanned thumbnail stack for each library row in the dropdown.
// Up to three images peek out at gentle tilts; on hover they fan out
// a little so the row feels alive. Empty libraries get a neutral
// outlined card with the bucket icon centered, sized identically so
// the layout doesn't shift between empty and populated rows.
function ThumbStack({ items }) {
  const populated = Array.isArray(items) && items.length > 0;
  return (
    <div className={styles.thumbStack} aria-hidden="true">
      {populated ? (
        items.slice(0, 3).map((s, i) => (
          <img
            key={s.id || i}
            className={styles.thumbStackImg}
            src={fileUrl(s.thumb_path || s.file_path)}
            alt=""
            draggable={false}
            style={{ '--idx': i }}
          />
        ))
      ) : (
        <div className={styles.thumbEmpty}>
          <CollectionIcon />
        </div>
      )}
    </div>
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
  // { libId: [{ id, file_path, thumb_path }] }
  const [previews, setPreviews] = useState({});
  const triggerRowRef = useRef(null);
  const dropdownRef = useRef(null);
  const renameInputRef = useRef(null);
  const createInputRef = useRef(null);
  const actionsBtnRef = useRef(null);

  const active = libraries.find((l) => l.id === activeId) || libraries[0];
  const canDelete = libraries.length > 1;

  // Fetch thumbnail previews for every library when the dropdown
  // opens. Cheap — read-only DB peek per library, returns at most
  // 4 rows. Refetched if the library list changes while open
  // (e.g. user creates one without closing).
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      const next = {};
      await Promise.all(
        libraries.map(async (lib) => {
          try {
            const items = await window.moodmark.libraries.previews(lib.id, 4);
            next[lib.id] = Array.isArray(items) ? items : [];
          } catch {
            next[lib.id] = [];
          }
        }),
      );
      if (!cancelled) setPreviews(next);
    })();
    return () => { cancelled = true; };
  }, [open, libraries]);

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
      `Delete the library "${active.name}"? Every save, folder, and image inside it will be permanently removed.`,
    );
    if (!confirmed) return;
    await onDelete?.(active.id);
  }

  if (!active) return null;

  // Hide Delete when there's only one library — that's the
  // last-remaining-library guard, enforced server-side too.
  const ACTION_ICON = { size: 14, strokeWidth: 1.6, 'aria-hidden': true };
  const actionItems = [
    {
      label: 'Rename',
      icon: <Pencil {...ACTION_ICON} />,
      onClick: startRenameActive,
    },
    {
      label: 'Reveal in Finder',
      icon: <FolderOpen {...ACTION_ICON} />,
      onClick: () => window.moodmark.library.revealActive(),
    },
    ...(canDelete
      ? [{
          label: 'Delete library',
          icon: <Trash2 {...ACTION_ICON} />,
          danger: true,
          onClick: handleDeleteActive,
        }]
      : []),
  ];

  return (
    <div className={styles.wrap}>
      <div ref={triggerRowRef} className={styles.triggerRow} data-onboarding="library-switcher">
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
          {libraries.map((lib, idx) => {
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
                style={{ '--idx': idx }}
              >
                <ThumbStack items={previews[lib.id]} />
                <span className={styles.rowLabel}>{lib.name}</span>
                <span className={styles.rowCheck}>
                  {isActive ? <CheckIcon /> : null}
                </span>
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
