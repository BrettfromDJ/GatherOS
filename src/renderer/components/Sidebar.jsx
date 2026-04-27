import React, { useEffect, useRef, useState } from 'react';
import styles from './Sidebar.module.css';
import ContextMenu from './ContextMenu.jsx';

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

function CollapseSidebarIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <line x1="6" y1="3" x2="6" y2="13" />
    </svg>
  );
}

function SettingsGearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.6" y="4.4" width="12.8" height="7.2" rx="1.4" />
      <line x1="3.6" y1="6.7" x2="3.7" y2="6.7" />
      <line x1="6" y1="6.7" x2="6.1" y2="6.7" />
      <line x1="8.4" y1="6.7" x2="8.5" y2="6.7" />
      <line x1="10.8" y1="6.7" x2="10.9" y2="6.7" />
      <line x1="3.6" y1="9" x2="3.7" y2="9" />
      <line x1="12.4" y1="9" x2="12.5" y2="9" />
      <line x1="5.2" y1="9.6" x2="10.8" y2="9.6" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 14.4l-0.97-0.88C3.6 10.24 1.33 8.19 1.33 5.67 1.33 3.61 2.95 2 5 2c1.16 0 2.27 0.54 3 1.39C8.73 2.54 9.84 2 11 2c2.05 0 3.67 1.61 3.67 3.67 0 2.52-2.27 4.57-5.7 7.86L8 14.4z" />
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

export function CollectionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="9" height="6" rx="1.4" opacity="0.45" />
      <rect x="4.5" y="5" width="9" height="6" rx="1.4" opacity="0.7" />
      <rect x="2.5" y="7" width="11" height="6.4" rx="1.5" fill="currentColor" stroke="none" opacity="0.9" />
    </svg>
  );
}

const SMART_VIEWS = [
  { id: 'all', label: 'All', color: 'var(--icon-blue)', Icon: GridIcon },
  { id: 'favorites', label: 'Favorites', color: 'var(--icon-pink)', Icon: HeartIcon },
  { id: 'recent', label: 'Recent', color: 'var(--icon-yellow)', Icon: ClockIcon },
];

export default function Sidebar({
  view,
  onViewChange,
  collections = [],
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onReorderCollections,
  onToggleCollapse,
  onUpload,
  onOpenSettings,
  onOpenShortcuts,
  createCollectionSignal,
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, collection }

  const [draggingId, setDraggingId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);

  const createInputRef = useRef(null);
  const renameInputRef = useRef(null);

  function startCreating() {
    setCreating(true);
    setNewName('');
    requestAnimationFrame(() => createInputRef.current?.focus());
  }

  // Bumped signal counter from App when ⌘N fires; trigger the inline
  // creation flow whenever the value changes (skipping the initial
  // mount value).
  useEffect(() => {
    if (createCollectionSignal === undefined || createCollectionSignal === 0) return;
    startCreating();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createCollectionSignal]);

  function cancelCreating() {
    setCreating(false);
    setNewName('');
  }

  async function commitCreate() {
    const name = newName.trim();
    if (!name) { cancelCreating(); return; }
    await onCreateCollection({ name });
    cancelCreating();
  }

  function handleCreateKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitCreate(); }
    if (e.key === 'Escape') cancelCreating();
  }

  function startRename(collection) {
    setRenamingId(collection.id);
    setRenameValue(collection.name);
    requestAnimationFrame(() => renameInputRef.current?.select());
  }

  async function commitRename(id) {
    const name = renameValue.trim();
    if (name) await onRenameCollection({ id, name });
    setRenamingId(null);
  }

  function handleRenameKeyDown(e, id) {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(id); }
    if (e.key === 'Escape') setRenamingId(null);
  }

  function handleCollectionContextMenu(e, collection) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, collection });
  }

  // ── Drag-to-reorder ──────────────────────────────────────────────────────
  function handleDragStart(e, id) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Setting some data is required by Firefox/Electron for drag to start.
    e.dataTransfer.setData('text/moodmark-collection', id);
  }

  function handleDragOver(e, id) {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetId !== id) setDropTargetId(id);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDropTargetId(null);
  }

  async function handleDrop(e, targetId) {
    e.preventDefault();
    e.stopPropagation();
    const fromId = draggingId;
    handleDragEnd();
    if (!fromId || fromId === targetId) return;
    const ids = collections.map((c) => c.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, fromId);
    await onReorderCollections(reordered);
  }

  const ctxItems = ctxMenu
    ? [
        { label: 'Rename', onClick: () => startRename(ctxMenu.collection) },
        { label: 'Delete Collection', danger: true, onClick: () => onDeleteCollection(ctxMenu.collection.id) },
      ]
    : [];

  return (
    <aside className={styles.sidebar}>
      {onToggleCollapse && (
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          title="Collapse sidebar"
        >
          <CollapseSidebarIcon />
        </button>
      )}
      <div className={styles.sectionHeaderRow}>
        <span className={styles.sectionHeaderLabel}>Library</span>
        {onUpload && (
          <button
            type="button"
            className={styles.addBtn}
            onClick={onUpload}
            title="Upload image"
          >
            +
          </button>
        )}
      </div>

      <nav className={styles.section}>
        {SMART_VIEWS.map(({ id, label, Icon }) => {
          const active = view.type === id;
          return (
            <button
              key={id}
              className={`${styles.item} ${active ? styles.active : ''}`}
              onClick={() => onViewChange({ type: id })}
            >
              <span
                className={styles.icon}
                style={{ color: active ? '#fff' : 'var(--text-secondary)' }}
              >
                <Icon />
              </span>
              <span className={styles.label}>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className={styles.sectionHeaderRow}>
        <span className={styles.sectionHeaderLabel}>Collections</span>
        <button
          className={styles.addBtn}
          onClick={startCreating}
          title="New Collection"
        >
          +
        </button>
      </div>

      {creating && (
        <div className={styles.newCollectionForm}>
          <input
            ref={createInputRef}
            className={styles.newCollectionInput}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleCreateKeyDown}
            placeholder="Collection name"
          />
          <div className={styles.newCollectionBtns}>
            <button className={styles.formBtn} onClick={cancelCreating}>Cancel</button>
            <button
              className={`${styles.formBtn} ${styles.formBtnPrimary}`}
              onClick={commitCreate}
            >
              Create
            </button>
          </div>
        </div>
      )}

      <nav className={styles.section}>
        {collections.length === 0 && !creating ? (
          <div className={styles.empty}>No collections yet</div>
        ) : (
          collections.map((c) => {
            const active = view.type === 'collection' && view.id === c.id;
            const isDragging = draggingId === c.id;
            const isDropTarget = dropTargetId === c.id && draggingId && draggingId !== c.id;
            const itemClass = [
              styles.item,
              active && styles.active,
              isDragging && styles.dragging,
              isDropTarget && styles.dropTarget,
            ].filter(Boolean).join(' ');

            if (renamingId === c.id) {
              return (
                <div key={c.id} className={itemClass}>
                  <span className={styles.icon}>
                    <CollectionIcon />
                  </span>
                  <input
                    ref={renameInputRef}
                    className={styles.renameInput}
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => handleRenameKeyDown(e, c.id)}
                    onBlur={() => commitRename(c.id)}
                  />
                </div>
              );
            }
            return (
              <button
                key={c.id}
                data-collection-id={c.id}
                className={itemClass}
                onClick={() => onViewChange({ type: 'collection', id: c.id })}
                onContextMenu={(e) => handleCollectionContextMenu(e, c)}
                draggable
                onDragStart={(e) => handleDragStart(e, c.id)}
                onDragOver={(e) => handleDragOver(e, c.id)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDrop(e, c.id)}
              >
                <span
                  className={styles.icon}
                  style={{ color: active ? '#fff' : 'var(--text-tertiary)' }}
                >
                  <CollectionIcon />
                </span>
                <span className={styles.label}>{c.name}</span>
                {c.save_count > 0 && (
                  <span className={styles.count}>{c.save_count}</span>
                )}
              </button>
            );
          })
        )}
      </nav>

      {(onOpenSettings || onOpenShortcuts) && (
        <div className={styles.footer}>
          {onOpenSettings && (
            <button
              type="button"
              className={styles.footerBtn}
              onClick={onOpenSettings}
              title="Settings"
            >
              <span className={styles.footerIcon}><SettingsGearIcon /></span>
              <span className={styles.footerLabel}>Settings</span>
            </button>
          )}
          {onOpenShortcuts && (
            <button
              type="button"
              className={styles.footerBtn}
              onClick={onOpenShortcuts}
              title="Keyboard shortcuts"
            >
              <span className={styles.footerIcon}><KeyboardIcon /></span>
              <span className={styles.footerLabel}>Shortcuts</span>
            </button>
          )}
        </div>
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </aside>
  );
}
