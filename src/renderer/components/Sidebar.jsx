import React, { useRef, useState } from 'react';
import styles from './Sidebar.module.css';
import ContextMenu from './ContextMenu.jsx';

const COLLECTION_COLORS = [
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#007aff',
  '#5856d6',
  '#ff2d55',
  '#8e8e93',
];

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

export default function Sidebar({
  view,
  onViewChange,
  collections = [],
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLLECTION_COLORS[4]);

  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, collection }

  const createInputRef = useRef(null);
  const renameInputRef = useRef(null);

  function startCreating() {
    setCreating(true);
    setNewName('');
    setNewColor(COLLECTION_COLORS[4]);
    // Focus on next frame after render
    requestAnimationFrame(() => createInputRef.current?.focus());
  }

  function cancelCreating() {
    setCreating(false);
    setNewName('');
  }

  async function commitCreate() {
    const name = newName.trim();
    if (!name) { cancelCreating(); return; }
    await onCreateCollection({ name, color: newColor });
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

  const ctxItems = ctxMenu
    ? [
        { label: 'Rename', onClick: () => startRename(ctxMenu.collection) },
        { label: 'Delete Collection', danger: true, onClick: () => onDeleteCollection(ctxMenu.collection.id) },
      ]
    : [];

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
              <span className={styles.icon} style={{ color: active ? '#fff' : color }}>
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
          <div className={styles.colorPickerRow}>
            {COLLECTION_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={[
                  styles.colorPickerDot,
                  newColor === color && styles.colorPickerDotSelected,
                ].filter(Boolean).join(' ')}
                style={{ background: color }}
                onClick={() => setNewColor(color)}
                aria-label={color}
              />
            ))}
          </div>
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
            if (renamingId === c.id) {
              return (
                <div
                  key={c.id}
                  className={`${styles.item} ${active ? styles.active : ''}`}
                >
                  <span className={styles.dot} style={{ background: c.color }} />
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
                className={`${styles.item} ${active ? styles.active : ''}`}
                onClick={() => onViewChange({ type: 'collection', id: c.id })}
                onContextMenu={(e) => handleCollectionContextMenu(e, c)}
              >
                <span className={styles.dot} style={{ background: c.color }} />
                <span className={styles.label}>{c.name}</span>
                {c.save_count > 0 && (
                  <span className={styles.count}>{c.save_count}</span>
                )}
              </button>
            );
          })
        )}
      </nav>

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
