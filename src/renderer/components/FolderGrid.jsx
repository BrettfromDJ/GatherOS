import React, { useMemo, useRef, useState } from 'react';
import {
  Folder as FolderClosed, Pencil, Trash2, Plus, Eclipse as Layers,
  GripVertical, Clock, History, ArrowDownAZ, ArrowDownZA,
  ArrowDownWideNarrow, ArrowDownNarrowWide,
} from 'lucide-react';
import styles from './FolderGrid.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import ContextMenu from './ContextMenu.jsx';
import Dropdown from './Dropdown.jsx';
import { extractDropImageUrls } from '../lib/dropUrls.js';
import { useReshuffle } from '../hooks/useReshuffle.js';

const SAVE_DROP_MIME = 'application/x-moodmark-save-ids';

// Leading glyphs mirror the main library sort dropdown (clock / history
// / A→Z / Z→A), with collection-specific icons for manual order + count.
const COLLECTION_SORT_OPTIONS = [
  { value: 'manual',    label: 'Manual order',  Icon: GripVertical },
  { value: 'newest',    label: 'Newest',        Icon: Clock },
  { value: 'oldest',    label: 'Oldest',        Icon: History },
  { value: 'name_asc',  label: 'Name A→Z',      Icon: ArrowDownAZ },
  { value: 'name_desc', label: 'Name Z→A',      Icon: ArrowDownZA },
  { value: 'most',      label: 'Most saves',    Icon: ArrowDownWideNarrow },
  { value: 'fewest',    label: 'Fewest saves',  Icon: ArrowDownNarrowWide },
];

const COLLECTION_SORT_STORAGE_KEY = 'moodmark.collections.sort';

function readStoredSort(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v) return v;
  } catch { /* localStorage unavailable */ }
  return fallback;
}

function sortFolders(folders, mode) {
  const arr = [...folders];
  switch (mode) {
    case 'newest':
      return arr.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    case 'oldest':
      return arr.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    case 'name_asc':
      return arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    case 'name_desc':
      return arr.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    case 'most':
      return arr.sort((a, b) => (b.save_count || 0) - (a.save_count || 0));
    case 'fewest':
      return arr.sort((a, b) => (a.save_count || 0) - (b.save_count || 0));
    case 'manual':
    default:
      return arr;
  }
}

function PencilIcon() { return <Pencil size={14} strokeWidth={1.6} aria-hidden="true" />; }
function TrashIcon()  { return <Trash2 size={14} strokeWidth={1.6} aria-hidden="true" />; }
function PlusIcon()   { return <Plus size={14} strokeWidth={1.6} aria-hidden="true" />; }

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
  draggable = true,
  childCount = 0,
}) {
  const thumbs = Array.isArray(folder.thumbs) ? folder.thumbs.slice(0, 4) : [];
  const count = folder.save_count || 0;
  // Re-deal the cover collage whenever the newest saves change.
  const shuffling = useReshuffle(thumbs.join('\x01'));
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
      draggable={draggable && !isRenaming}
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
          <div
            className={[styles.tileStack, shuffling && styles.tileStackShuffle]
              .filter(Boolean).join(' ')}
            aria-hidden="true"
          >
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
          {childCount > 0 && (
            <span className={styles.tileCountLabel}> · {childCount} inside</span>
          )}
          {isDropTarget && (
            <span className={styles.tileCountAdd} aria-hidden="true">+1</span>
          )}
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
  // Handles browser drags (text/uri-list) onto a folder tile. Routed
  // through App's handleExternalDropToBucket, which already knows how
  // to deal with mixed file + url payloads.
  onExternalDropToBucket,
  onSetAppDragging,
  onOpenCollectionAsSpace,
  // Drill-in nesting: creates a child inside the right-clicked folder.
  onCreateChildFolder,
  // Same hook BoardGrid uses — App attaches its scroll listener here
  // so the toolbar's drop-shadow engages once the collections grid is
  // scrolled past the top.
  scrollRef,
}) {
  const visible = (folders || []).filter(
    (f) => (f.parent_id || null) === parentId,
  );
  // Children per parent, for the "· N inside" tile meta. Computed off
  // the FULL list — `visible` has already filtered children out.
  const childCounts = new Map();
  for (const f of folders || []) {
    if (f.parent_id) childCounts.set(f.parent_id, (childCounts.get(f.parent_id) || 0) + 1);
  }

  const [ctxMenu, setCtxMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  // Drag-to-reorder state: { id, hintBefore, hintAfter } — only one
  // hint position renders at a time, on whichever side the cursor sits.
  const [reorderState, setReorderState] = useState({ draggingId: null, overId: null, side: null });
  const [sortMode, setSortMode] = useState(() =>
    readStoredSort(COLLECTION_SORT_STORAGE_KEY, 'manual'));
  function handleSortChange(next) {
    setSortMode(next);
    try { localStorage.setItem(COLLECTION_SORT_STORAGE_KEY, next); } catch { /* unavailable */ }
  }
  const displayFolders = useMemo(
    () => sortFolders(visible, sortMode),
    [visible, sortMode],
  );
  const reorderEnabled = sortMode === 'manual';

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
  // Browser image drag: tab-image-onto-app supplies text/uri-list
  // (and usually text/html with the <img> wrapper). Either signal
  // is enough to know the drop carries a URL we can hand off to
  // saves.dropUrl on the main process.
  function isUrlDrag(e) {
    const t = e.dataTransfer.types;
    return t.includes('text/uri-list') || t.includes('text/html');
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
    if (!isSaveDrag(e) && !isFileDrag(e) && !isUrlDrag(e)) return;
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
    if (!isSaveDrag(e) && !isFileDrag(e) && !isUrlDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    // Tile owns this drop, so the global "Drop to save" overlay must
    // not linger on screen after release.
    onSetAppDragging?.(false);
    // External-source drops: Finder files (text/uri-list isn't set)
    // OR browser images (no Files but text/uri-list / text/html).
    // Some browsers attach BOTH a synthetic File and a uri-list — in
    // that case we prefer the URL because the synthesised File is
    // usually a tiny <img> screenshot, not the original asset.
    const files = isFileDrag(e) ? [...e.dataTransfer.files] : [];
    const urls = isUrlDrag(e) ? extractDropImageUrls(e.dataTransfer) : [];
    if (files.length > 0 || urls.length > 0) {
      if (onExternalDropToBucket) {
        await onExternalDropToBucket(id, { files, urls });
      } else if (files.length > 0) {
        // Fallback to the file-only callback if the parent hasn't
        // wired up the unified handler yet.
        await onDropFilesToBucket?.(id, e.dataTransfer.files);
      }
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
    <div className={styles.scroll} ref={scrollRef}>
      <div className={styles.gridHeader}>
        <Dropdown
          value={sortMode}
          options={COLLECTION_SORT_OPTIONS}
          onChange={handleSortChange}
          ariaLabel="Sort collections by"
        />
      </div>
      <div className={styles.grid}>
        {onCreateFolder && (
          <NewFolderTile onActivate={onCreateFolder} />
        )}
        {displayFolders.map((folder) => (
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
            draggable={reorderEnabled}
            onDragStart={reorderEnabled ? (e) => handleTileReorderDragStart(e, folder.id) : undefined}
            onDragOver={(e) => handleTileDragOver(e, folder.id)}
            onDragLeave={handleTileDragLeave}
            onDrop={(e) => handleTileDrop(e, folder.id)}
            onDragEnd={handleTileDragEnd}
            childCount={childCounts.get(folder.id) || 0}
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
            // One level of nesting only — children can't have children,
            // so the entry hides on child folders (parent_id set).
            ...(onCreateChildFolder && !ctxMenu.folder.parent_id ? [{
              label: 'New child collection',
              icon: <PlusIcon />,
              onClick: () => onCreateChildFolder(ctxMenu.folder.id),
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
