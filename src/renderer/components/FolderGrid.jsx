import React, { useRef, useState } from 'react';
import { FolderClosed, Pencil, Trash2, Plus, Layers } from 'lucide-react';
import styles from './FolderGrid.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import ContextMenu from './ContextMenu.jsx';

const SAVE_DROP_MIME = 'application/x-moodmark-save-ids';

function PencilIcon() { return <Pencil size={14} strokeWidth={1.6} aria-hidden="true" />; }
function TrashIcon()  { return <Trash2 size={14} strokeWidth={1.6} aria-hidden="true" />; }

// One tile per folder. Promotes the bucketStackDeal hover-fan from
// an Easter egg in the sidebar into the primary navigation artwork.
// On hover the back/front cards spread further apart so the row
// reads as alive — same idiom we use everywhere a stack appears.
function FolderTile({
  folder,
  isRenaming,
  renameDraft,
  renameInputRef,
  onClick,
  onContextMenu,
  onRenameDraftChange,
  onRenameCommit,
  onRenameCancel,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  reorderHint,
  isReorderDragging,
}) {
  const thumbs = Array.isArray(folder.thumbs) ? folder.thumbs.slice(0, 4) : [];
  const count = folder.save_count || 0;
  return (
    <div
      className={[
        styles.tile,
        isDropTarget && styles.tileDropTarget,
        isReorderDragging && styles.tileDragging,
        reorderHint === 'before' && styles.tileReorderBefore,
        reorderHint === 'after' && styles.tileReorderAfter,
      ].filter(Boolean).join(' ')}
      role="button"
      draggable={!isRenaming}
      onDragStart={onDragStart}
      tabIndex={isRenaming ? -1 : 0}
      onClick={(e) => {
        if (isRenaming) return;
        if (e.target.closest(`.${styles.tileRenameInput}`)) return;
        onClick?.();
      }}
      onKeyDown={(e) => {
        if (isRenaming) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className={styles.tileArt}>
        {thumbs.length > 0 ? (
          <div className={styles.tileStack} aria-hidden="true">
            {thumbs.map((thumb, i) => (
              <img
                key={`${i}-${thumb}`}
                src={fileUrl(thumb)}
                className={styles.tileStackImg}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            ))}
          </div>
        ) : (
          <span className={styles.tileEmpty} aria-hidden="true">
            <FolderClosed size={32} strokeWidth={1.4} />
          </span>
        )}
      </div>
      <div className={styles.tileMeta}>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            autoFocus
            className={styles.tileRenameInput}
            value={renameDraft}
            onChange={(e) => onRenameDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onRenameCommit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onRenameCancel();
              }
            }}
            onBlur={onRenameCommit}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={styles.tileName}>{folder.name}</span>
        )}
        <span className={styles.tileCount}>
          <span className={styles.tileCountNum}>{count}</span>
          <span className={styles.tileCountLabel}> {count === 1 ? 'save' : 'saves'}</span>
        </span>
      </div>
    </div>
  );
}

// "+" affordance rendered as the first tile in the grid. Always
// available (alongside the empty-state CTA) so creating a new folder
// doesn't depend on sidebar chrome that's no longer there.
function NewFolderTile({ onActivate }) {
  return (
    <button
      type="button"
      className={`${styles.tile} ${styles.tileNew}`}
      onClick={onActivate}
      title="New collection"
    >
      <div className={`${styles.tileArt} ${styles.tileArtNew}`}>
        <Plus size={28} strokeWidth={1.4} aria-hidden="true" />
      </div>
      <div className={styles.tileMeta}>
        <span className={`${styles.tileName} ${styles.tileNameMuted}`}>
          New collection
        </span>
      </div>
    </button>
  );
}

const FOLDER_REORDER_MIME = 'application/x-moodmark-folder-reorder';

export default function FolderGrid({
  folders,
  parentId = null,
  onPickFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onReorderFolders,
  onAddSavesToBucket,
  onDropFilesToBucket,
  onSetAppDragging,
  onOpenCollectionAsSpace,
}) {
  const visible = (folders || []).filter(
    (f) => (f.parent_id || null) === parentId,
  );

  const [ctxMenu, setCtxMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  // Drag-to-reorder state: { id, hintBefore, hintAfter } — only one
  // hint position renders at a time, on whichever side the cursor sits.
  const [reorderState, setReorderState] = useState({ draggingId: null, overId: null, side: null });

  function startRename(folder) {
    setRenamingId(folder.id);
    setRenameDraft(folder.name);
    requestAnimationFrame(() => renameInputRef.current?.select());
  }

  async function commitRename() {
    const next = renameDraft.trim();
    const id = renamingId;
    setRenamingId(null);
    setRenameDraft('');
    if (!id || !next) return;
    const original = folders.find((f) => f.id === id);
    if (!original || next === original.name) return;
    await onRenameFolder?.({ id, name: next });
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft('');
  }

  function isSaveDrag(e) {
    return e.dataTransfer.types.includes(SAVE_DROP_MIME);
  }
  function isFileDrag(e) {
    return e.dataTransfer.types.includes('Files');
  }
  function isReorderDrag(e) {
    return e.dataTransfer.types.includes(FOLDER_REORDER_MIME);
  }

  function handleTileReorderDragStart(e, id) {
    if (!onReorderFolders) return;
    e.dataTransfer.setData(FOLDER_REORDER_MIME, id);
    e.dataTransfer.effectAllowed = 'move';
    setReorderState({ draggingId: id, overId: null, side: null });
  }

  function handleTileDragOver(e, id) {
    if (isReorderDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const side = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';
      if (reorderState.overId !== id || reorderState.side !== side) {
        setReorderState((prev) => ({ ...prev, overId: id, side }));
      }
      return;
    }
    if (!isSaveDrag(e) && !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (dropTargetId !== id) setDropTargetId(id);
    // Suppress the global "Drop to save" overlay while the drag hovers
    // a real drop target — the tile's own outline + lift signals where
    // the drop will land, the full-screen tint is redundant. The
    // stopPropagation above prevents the App-shell onDragOver (which
    // re-arms the overlay on every move) from firing.
    onSetAppDragging?.(false);
  }
  function handleTileDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDropTargetId(null);
      setReorderState((prev) => (prev.overId ? { ...prev, overId: null, side: null } : prev));
    }
  }
  async function handleTileDrop(e, id) {
    if (isReorderDrag(e)) {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = e.dataTransfer.getData(FOLDER_REORDER_MIME);
      const rect = e.currentTarget.getBoundingClientRect();
      const side = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';
      setReorderState({ draggingId: null, overId: null, side: null });
      if (!draggedId || draggedId === id) return;
      const ordered = visible.map((f) => f.id).filter((x) => x !== draggedId);
      const targetIdx = ordered.indexOf(id);
      if (targetIdx < 0) return;
      const insertAt = side === 'before' ? targetIdx : targetIdx + 1;
      ordered.splice(insertAt, 0, draggedId);
      onReorderFolders?.(ordered);
      return;
    }
    if (!isSaveDrag(e) && !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    // Tile owns this drop, so the global "Drop to save" overlay must
    // not linger on screen after release.
    onSetAppDragging?.(false);
    if (isFileDrag(e) && e.dataTransfer.files?.length > 0) {
      await onDropFilesToBucket?.(id, e.dataTransfer.files);
      return;
    }
    let ids;
    try { ids = JSON.parse(e.dataTransfer.getData(SAVE_DROP_MIME) || '[]'); }
    catch { return; }
    if (!Array.isArray(ids) || ids.length === 0) return;
    await onAddSavesToBucket?.(id, ids);
  }

  function handleTileDragEnd() {
    setReorderState({ draggingId: null, overId: null, side: null });
  }

  if (visible.length === 0) {
    return (
      <div className={styles.empty}>
        <FolderClosed size={36} strokeWidth={1.3} className={styles.emptyIcon} />
        <div className={styles.emptyTitle}>No collections yet</div>
        <div className={styles.emptyHint}>
          Collections organise saves by project, mood, or anything else.
        </div>
        {onCreateFolder && (
          <button
            type="button"
            className={styles.emptyAction}
            onClick={onCreateFolder}
          >
            Create your first collection
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.scroll}>
      <div className={styles.grid}>
        {onCreateFolder && (
          <NewFolderTile onActivate={onCreateFolder} />
        )}
        {visible.map((folder) => (
          <FolderTile
            key={folder.id}
            folder={folder}
            isRenaming={renamingId === folder.id}
            renameDraft={renameDraft}
            renameInputRef={renameInputRef}
            onClick={() => onPickFolder(folder.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY, folder });
            }}
            onRenameDraftChange={setRenameDraft}
            onRenameCommit={commitRename}
            onRenameCancel={cancelRename}
            isDropTarget={dropTargetId === folder.id}
            isReorderDragging={reorderState.draggingId === folder.id}
            reorderHint={reorderState.overId === folder.id ? reorderState.side : null}
            onDragStart={(e) => handleTileReorderDragStart(e, folder.id)}
            onDragOver={(e) => handleTileDragOver(e, folder.id)}
            onDragLeave={handleTileDragLeave}
            onDrop={(e) => handleTileDrop(e, folder.id)}
            onDragEnd={handleTileDragEnd}
          />
        ))}
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            {
              label: 'Rename',
              icon: <PencilIcon />,
              onClick: () => startRename(ctxMenu.folder),
            },
            ...(onOpenCollectionAsSpace ? [{
              label: 'Open as space',
              icon: <Layers size={14} strokeWidth={1.6} aria-hidden="true" />,
              onClick: () => onOpenCollectionAsSpace(ctxMenu.folder.id),
            }] : []),
            {
              label: 'Delete collection',
              icon: <TrashIcon />,
              danger: true,
              onClick: () => onDeleteFolder?.(ctxMenu.folder.id),
            },
          ]}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
