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

// Bucket icon — trapezoid pail with a handle. Used for every bucket
// entry in the sidebar (the colored swatch comes from the bucket's
// own color setting and tints the icon via currentColor).
export function CollectionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      {/* handle */}
      <path d="M5 5.4 C5 3.5, 11 3.5, 11 5.4" />
      {/* pail body */}
      <path d="M3.6 5.6 L4.6 13 a1 1 0 0 0 1 0.9 h4.8 a1 1 0 0 0 1 -0.9 L12.4 5.6 Z" fill="currentColor" fillOpacity="0.18" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.4 9.5 L4 3.5 a1 1 0 0 1 1 -0.7 h6 a1 1 0 0 1 1 0.7 L13.6 9.5" />
      <path d="M2.4 9.5 H6 l1 1.5 h2 l1 -1.5 h3.6 V12.6 a1 1 0 0 1 -1 1 H3.4 a1 1 0 0 1 -1 -1 Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5 H13" />
      <path d="M6.4 4.5 V3.4 a0.8 0.8 0 0 1 0.8 -0.8 h1.6 a0.8 0.8 0 0 1 0.8 0.8 V4.5" />
      <path d="M4.4 4.5 L5.1 13 a1 1 0 0 0 1 0.9 h3.8 a1 1 0 0 0 1 -0.9 L11.6 4.5" />
      <path d="M6.8 7 V11.5 M9.2 7 V11.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 2.5 L13.5 5 L5.5 13 H3 V10.5 Z" />
      <path d="M9.5 4 L12 6.5" />
    </svg>
  );
}

const SMART_VIEWS = [
  { id: 'all',      label: 'All',      color: 'var(--icon-blue)',   Icon: GridIcon },
  { id: 'unsorted', label: 'Unsorted', color: 'var(--icon-yellow)', Icon: InboxIcon },
  { id: 'trash',    label: 'Trash',    color: 'var(--text-tertiary)', Icon: TrashIcon },
];

export default function Sidebar({
  view,
  onViewChange,
  collections = [],
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onReorderCollections,
  onAddSavesToBucket,
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

  // Inline "add child bucket" form, anchored under a top-level bucket.
  const [creatingChildOf, setCreatingChildOf] = useState(null); // parent id
  const [newChildName, setNewChildName] = useState('');
  const childInputRef = useRef(null);

  function startCreatingChild(parentId) {
    setCreatingChildOf(parentId);
    setNewChildName('');
    requestAnimationFrame(() => childInputRef.current?.focus());
  }

  function cancelCreatingChild() {
    setCreatingChildOf(null);
    setNewChildName('');
  }

  async function commitCreateChild() {
    const name = newChildName.trim();
    const parentId = creatingChildOf;
    if (!name || !parentId) { cancelCreatingChild(); return; }
    try {
      await onCreateCollection({ name, parentId });
    } catch (err) {
      console.error('Create child bucket failed:', err);
    } finally {
      cancelCreatingChild();
    }
  }

  function handleChildKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitCreateChild(); }
    if (e.key === 'Escape') cancelCreatingChild();
  }

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

  // ── Drag-saves-into-bucket ───────────────────────────────────────────────
  // The grid cards drag with the SAVE_DROP_MIME payload (a JSON array
  // of save ids). These handlers light up a bucket on hover and call
  // back to App on drop so the addSave + flyToCollection happens once.
  const SAVE_DROP_MIME = 'application/x-moodmark-save-ids';
  const [saveDropTargetId, setSaveDropTargetId] = useState(null);

  function isSaveDrag(e) {
    return e.dataTransfer.types.includes(SAVE_DROP_MIME);
  }

  function handleSaveDragOver(e, bucketId) {
    if (!isSaveDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (saveDropTargetId !== bucketId) setSaveDropTargetId(bucketId);
  }

  function handleSaveDragLeave(e) {
    // dragleave fires when entering child elements too — only reset if
    // we really left the row.
    if (!e.currentTarget.contains(e.relatedTarget)) setSaveDropTargetId(null);
  }

  async function handleSaveDrop(e, bucketId) {
    if (!isSaveDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setSaveDropTargetId(null);
    let ids;
    try { ids = JSON.parse(e.dataTransfer.getData(SAVE_DROP_MIME) || '[]'); }
    catch { return; }
    if (!Array.isArray(ids) || ids.length === 0) return;
    await onAddSavesToBucket?.(bucketId, ids);
  }

  const ctxItems = ctxMenu
    ? [
        ...(ctxMenu.collection.parent_id
          ? []
          : [{
              label: 'Add Child Bucket',
              icon: <CollectionIcon />,
              onClick: () => startCreatingChild(ctxMenu.collection.id),
            }]),
        { label: 'Rename', icon: <PencilIcon />, onClick: () => startRename(ctxMenu.collection) },
        { label: 'Delete Bucket', icon: <TrashIcon />, danger: true, onClick: () => onDeleteCollection(ctxMenu.collection.id) },
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
        <span className={styles.sectionHeaderLabel}>Buckets</span>
        <button
          className={styles.addBtn}
          onClick={startCreating}
          title="New Bucket"
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
            placeholder="Bucket name"
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
        {(() => {
          const topLevel = collections.filter((c) => !c.parent_id);
          const childrenOf = (parentId) => collections.filter((c) => c.parent_id === parentId);
          if (topLevel.length === 0 && !creating) {
            return <div className={styles.empty}>No buckets yet</div>;
          }
          const renderItem = (c, isChild) => {
            const active = view.type === 'collection' && view.id === c.id;
            const isDragging = draggingId === c.id;
            const isDropTarget = dropTargetId === c.id && draggingId && draggingId !== c.id;
            const itemClass = [
              styles.item,
              isChild && styles.itemChild,
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
            const isSaveDropTarget = saveDropTargetId === c.id;
            const itemClassWithDrop = [itemClass, isSaveDropTarget && styles.saveDropTarget]
              .filter(Boolean).join(' ');
            return (
              <button
                key={c.id}
                data-collection-id={c.id}
                className={itemClassWithDrop}
                onClick={() => onViewChange({ type: 'collection', id: c.id })}
                onContextMenu={(e) => handleCollectionContextMenu(e, c)}
                draggable={!isChild}
                onDragStart={!isChild ? (e) => handleDragStart(e, c.id) : undefined}
                onDragOver={(e) => {
                  // Save drag (HTML5 from grid) takes precedence — it
                  // arrives with our custom MIME. Bucket reorder (only
                  // for top-level) uses the local draggingId state.
                  handleSaveDragOver(e, c.id);
                  if (!isChild) handleDragOver(e, c.id);
                }}
                onDragLeave={handleSaveDragLeave}
                onDragEnd={!isChild ? handleDragEnd : undefined}
                onDrop={(e) => {
                  if (isSaveDrag(e)) {
                    handleSaveDrop(e, c.id);
                  } else if (!isChild) {
                    handleDrop(e, c.id);
                  }
                }}
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
          };
          return topLevel.map((c) => (
            <React.Fragment key={c.id}>
              {renderItem(c, false)}
              {childrenOf(c.id).map((child) => renderItem(child, true))}
              {creatingChildOf === c.id && (
                <div className={`${styles.newCollectionForm} ${styles.newChildForm}`}>
                  <input
                    ref={childInputRef}
                    className={styles.newCollectionInput}
                    value={newChildName}
                    onChange={(e) => setNewChildName(e.target.value)}
                    onKeyDown={handleChildKeyDown}
                    placeholder="Sub-bucket name"
                  />
                  <div className={styles.newCollectionBtns}>
                    <button className={styles.formBtn} onClick={cancelCreatingChild}>Cancel</button>
                    <button
                      className={`${styles.formBtn} ${styles.formBtnPrimary}`}
                      onClick={commitCreateChild}
                    >
                      Create
                    </button>
                  </div>
                </div>
              )}
            </React.Fragment>
          ));
        })()}
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
