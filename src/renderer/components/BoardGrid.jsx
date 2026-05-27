import React, { useMemo, useRef, useState } from 'react';
import { Frame, Pencil, Trash2, Plus } from 'lucide-react';
import styles from './BoardGrid.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import ContextMenu from './ContextMenu.jsx';
import Dropdown from './Dropdown.jsx';

const BOARD_SORT_OPTIONS = [
  { value: 'manual',    label: 'Manual order' },
  { value: 'recent',    label: 'Recently used' },
  { value: 'newest',    label: 'Newest' },
  { value: 'oldest',    label: 'Oldest' },
  { value: 'name_asc',  label: 'Name A→Z' },
  { value: 'name_desc', label: 'Name Z→A' },
];

const BOARD_SORT_STORAGE_KEY = 'moodmark.boards.sort';

function readStoredSort(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v) return v;
  } catch { /* localStorage unavailable */ }
  return fallback;
}

function sortBoards(boards, mode) {
  const arr = [...boards];
  switch (mode) {
    case 'recent':
      return arr.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    case 'newest':
      return arr.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    case 'oldest':
      return arr.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    case 'name_asc':
      return arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    case 'name_desc':
      return arr.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    case 'manual':
    default:
      return arr;
  }
}

function PencilIcon() { return <Pencil size={14} strokeWidth={1.6} aria-hidden="true" />; }
function TrashIcon()  { return <Trash2 size={14} strokeWidth={1.6} aria-hidden="true" />; }

// Relative-time label for the tile sub-line. Mirrors the way the
// FeaturedBuckets card shows "5 saves" — same rhythm, different
// content because spaces are time-keyed rather than count-keyed.
function relativeAgo(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return 'Just now';
  if (min < 60) return `Edited ${min}m ago`;
  if (hr < 24) return `Edited ${hr}h ago`;
  if (day < 30) return `Edited ${day}d ago`;
  if (day < 365) return `Edited ${Math.floor(day / 30)}mo ago`;
  return `Edited ${Math.floor(day / 365)}y ago`;
}

// Figma-style snapshot of the board's canvas. Each item — image,
// shape, text, sticky, frame, arrow — renders at its actual position
// inside an SVG sized to the items' bounding box, then preserveAspect-
// Ratio fits it into the tile. Same source data as BoardView so the
// thumbnail is always in sync with the canvas without a separate
// rasterisation step.
function BoardSnapshot({ items }) {
  if (!items || items.length === 0) return null;

  // Compute bounding box of all items. Includes a small padding so
  // edge-anchored items don't get clipped flush against the tile.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    if (!Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
    const w = Math.max(0, it.width || 0);
    const h = Math.max(0, it.height || 0);
    minX = Math.min(minX, it.x);
    minY = Math.min(minY, it.y);
    maxX = Math.max(maxX, it.x + w);
    maxY = Math.max(maxY, it.y + h);
  }
  if (!Number.isFinite(minX)) return null;
  const PAD = Math.max((maxX - minX), (maxY - minY)) * 0.05;
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
  const vbW = Math.max(1, maxX - minX);
  const vbH = Math.max(1, maxY - minY);

  return (
    <svg
      className={styles.snapshot}
      viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {items.map((it, i) => (
        <SnapshotItem key={i} item={it} viewBoxWidth={vbW} />
      ))}
    </svg>
  );
}

function SnapshotItem({ item, viewBoxWidth }) {
  const { type, x, y, width, height, rotation } = item;
  const w = Math.max(1, width || 0);
  const h = Math.max(1, height || 0);
  // Rotation is around the item's own centre (matches BoardView's
  // transform-origin). SVG's transform="rotate(angle cx cy)" handles
  // this directly.
  const transform = rotation
    ? `rotate(${rotation} ${x + w / 2} ${y + h / 2})`
    : undefined;
  // Stroke widths in the actual canvas are in CSS pixels; at the
  // snapshot's zoomed-out scale, the same value would render
  // invisibly thin. Scale to ~0.4% of the viewBox so outlines and
  // arrows stay visible regardless of canvas size.
  const strokeScale = Math.max(viewBoxWidth * 0.003, 1);

  if (type === 'image' && item.thumb_path) {
    return (
      <image
        href={fileUrl(item.thumb_path)}
        x={x} y={y} width={w} height={h}
        transform={transform}
        preserveAspectRatio="xMidYMid slice"
      />
    );
  }

  if (type === 'shape') {
    const fill = item.fill && item.fill !== 'transparent' ? item.fill : 'none';
    const stroke = item.stroke || 'rgba(0, 0, 0, 0.85)';
    const sw = (item.strokeWidth || 1.5) * strokeScale;
    if (item.kind === 'ellipse') {
      return (
        <ellipse
          cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2}
          fill={fill} stroke={stroke} strokeWidth={sw}
          transform={transform}
        />
      );
    }
    if (item.kind === 'triangle') {
      const points = `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`;
      return (
        <polygon
          points={points}
          fill={fill} stroke={stroke} strokeWidth={sw}
          transform={transform}
        />
      );
    }
    return (
      <rect
        x={x} y={y} width={w} height={h}
        fill={fill} stroke={stroke} strokeWidth={sw}
        transform={transform}
      />
    );
  }

  if (type === 'frame') {
    return (
      <rect
        x={x} y={y} width={w} height={h}
        fill={item.fill || '#ffffff'}
        stroke="rgba(0, 0, 0, 0.2)"
        strokeWidth={1 * strokeScale}
        transform={transform}
      />
    );
  }

  if (type === 'sticky') {
    return (
      <rect
        x={x} y={y} width={w} height={h}
        fill={item.fill || '#FFE680'}
        transform={transform}
      />
    );
  }

  if (type === 'text') {
    // Render as a couple of subtle horizontal bars so text reads as
    // "this is type" without trying to lay out actual glyphs at thumb
    // scale (which would be unreadable + slow).
    const lineH = Math.max(2, (item.fontSize || 16) * 0.7);
    return (
      <g transform={transform}>
        <rect x={x} y={y + h / 2 - lineH * 0.7} width={w * 0.8} height={lineH * 0.3} fill="rgba(0, 0, 0, 0.45)" />
        <rect x={x} y={y + h / 2 + lineH * 0.2} width={w * 0.5} height={lineH * 0.3} fill="rgba(0, 0, 0, 0.3)" />
      </g>
    );
  }

  if (type === 'arrow') {
    // The board stores arrows as x/y/w/h bounding boxes; render as a
    // diagonal line across that box. Direction won't always be exact
    // but the spatial cue is what matters at thumbnail scale.
    return (
      <line
        x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2}
        stroke="rgba(0, 0, 0, 0.6)"
        strokeWidth={2 * strokeScale}
        strokeLinecap="round"
        transform={transform}
      />
    );
  }

  return null;
}

function BoardTile({
  board,
  isRenaming,
  renameDraft,
  renameInputRef,
  onClick,
  onContextMenu,
  onRenameDraftChange,
  onRenameCommit,
  onRenameCancel,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  reorderHint,
  isReorderDragging,
  draggable = true,
}) {
  const items = Array.isArray(board.items) ? board.items : [];
  const hasItems = items.length > 0;
  return (
    <div
      className={[
        styles.tile,
        isReorderDragging && styles.tileDragging,
        reorderHint === 'before' && styles.tileReorderBefore,
        reorderHint === 'after' && styles.tileReorderAfter,
      ].filter(Boolean).join(' ')}
      role="button"
      draggable={draggable && !isRenaming}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
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
    >
      <div className={styles.tileArt}>
        {hasItems ? <BoardSnapshot items={items} /> : null}
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
          <span className={styles.tileName}>{board.name}</span>
        )}
        <span className={styles.tileSubtitle}>
          {relativeAgo(board.updated_at || board.created_at)}
        </span>
      </div>
    </div>
  );
}

function NewBoardTile({ onActivate }) {
  return (
    <button
      type="button"
      className={`${styles.tile} ${styles.tileNew}`}
      onClick={onActivate}
      title="New space"
      data-onboarding="new-space"
    >
      <div className={`${styles.tileArt} ${styles.tileArtNew}`}>
        <Plus size={28} strokeWidth={1.4} aria-hidden="true" />
      </div>
      <div className={styles.tileMeta}>
        <span className={`${styles.tileName} ${styles.tileNameMuted}`}>
          New space
        </span>
      </div>
    </button>
  );
}

const BOARD_REORDER_MIME = 'application/x-moodmark-board-reorder';

export default function BoardGrid({
  boards,
  onPickBoard,
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
  onReorderBoards,
  // Optional ref-callback — when provided, App attaches its scroll
  // listener to our scroll container so the toolbar's drop-shadow
  // engages once the boards grid is scrolled past the top, matching
  // the Library screen's behaviour.
  scrollRef,
}) {
  const [ctxMenu, setCtxMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef(null);
  const [reorderState, setReorderState] = useState({ draggingId: null, overId: null, side: null });
  const [sortMode, setSortMode] = useState(() =>
    readStoredSort(BOARD_SORT_STORAGE_KEY, 'manual'));
  function handleSortChange(next) {
    setSortMode(next);
    try { localStorage.setItem(BOARD_SORT_STORAGE_KEY, next); } catch { /* unavailable */ }
  }
  const displayBoards = useMemo(
    () => sortBoards(boards || [], sortMode),
    [boards, sortMode],
  );
  // Drag-reorder only makes sense when the user's manual order is the
  // active arrangement; any other sort would just snap the dragged
  // tile back to its sorted position.
  const reorderEnabled = sortMode === 'manual';

  function handleTileReorderDragStart(e, id) {
    if (!onReorderBoards) return;
    e.dataTransfer.setData(BOARD_REORDER_MIME, id);
    e.dataTransfer.effectAllowed = 'move';
    setReorderState({ draggingId: id, overId: null, side: null });
  }
  function handleTileDragOver(e, id) {
    if (!e.dataTransfer.types.includes(BOARD_REORDER_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const side = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';
    if (reorderState.overId !== id || reorderState.side !== side) {
      setReorderState((prev) => ({ ...prev, overId: id, side }));
    }
  }
  function handleTileDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setReorderState((prev) => (prev.overId ? { ...prev, overId: null, side: null } : prev));
    }
  }
  function handleTileDrop(e, id) {
    if (!e.dataTransfer.types.includes(BOARD_REORDER_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData(BOARD_REORDER_MIME);
    const rect = e.currentTarget.getBoundingClientRect();
    const side = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';
    setReorderState({ draggingId: null, overId: null, side: null });
    if (!draggedId || draggedId === id) return;
    const ordered = boards.map((b) => b.id).filter((x) => x !== draggedId);
    const targetIdx = ordered.indexOf(id);
    if (targetIdx < 0) return;
    const insertAt = side === 'before' ? targetIdx : targetIdx + 1;
    ordered.splice(insertAt, 0, draggedId);
    onReorderBoards?.(ordered);
  }
  function handleTileDragEnd() {
    setReorderState({ draggingId: null, overId: null, side: null });
  }

  function startRename(board) {
    setRenamingId(board.id);
    setRenameDraft(board.name);
    requestAnimationFrame(() => renameInputRef.current?.select());
  }

  async function commitRename() {
    const next = renameDraft.trim();
    const id = renamingId;
    setRenamingId(null);
    setRenameDraft('');
    if (!id || !next) return;
    const original = boards.find((b) => b.id === id);
    if (!original || next === original.name) return;
    await onRenameBoard?.({ id, name: next });
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft('');
  }

  if (!boards || boards.length === 0) {
    return (
      <div className={styles.empty}>
        <Frame size={36} strokeWidth={1.3} className={styles.emptyIcon} />
        <div className={styles.emptyTitle}>No spaces yet</div>
        <div className={styles.emptyHint}>
          Spaces are infinite canvases — drop images, sticky notes, and
          shapes anywhere you want.
        </div>
        {onCreateBoard && (
          <button
            type="button"
            className={styles.emptyAction}
            onClick={onCreateBoard}
          >
            Create your first space
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
          options={BOARD_SORT_OPTIONS}
          onChange={handleSortChange}
          ariaLabel="Sort spaces by"
        />
      </div>
      <div className={styles.grid}>
        {onCreateBoard && (
          <NewBoardTile onActivate={onCreateBoard} />
        )}
        {displayBoards.map((board) => (
          <BoardTile
            key={board.id}
            board={board}
            isRenaming={renamingId === board.id}
            renameDraft={renameDraft}
            renameInputRef={renameInputRef}
            onClick={() => onPickBoard(board.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY, board });
            }}
            onRenameDraftChange={setRenameDraft}
            onRenameCommit={commitRename}
            onRenameCancel={cancelRename}
            isReorderDragging={reorderState.draggingId === board.id}
            reorderHint={reorderState.overId === board.id ? reorderState.side : null}
            draggable={reorderEnabled}
            onDragStart={reorderEnabled ? (e) => handleTileReorderDragStart(e, board.id) : undefined}
            onDragOver={reorderEnabled ? (e) => handleTileDragOver(e, board.id) : undefined}
            onDragLeave={reorderEnabled ? handleTileDragLeave : undefined}
            onDrop={reorderEnabled ? (e) => handleTileDrop(e, board.id) : undefined}
            onDragEnd={reorderEnabled ? handleTileDragEnd : undefined}
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
              onClick: () => startRename(ctxMenu.board),
            },
            {
              label: 'Delete Space',
              icon: <TrashIcon />,
              danger: true,
              onClick: () => onDeleteBoard?.(ctxMenu.board.id),
            },
          ]}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
