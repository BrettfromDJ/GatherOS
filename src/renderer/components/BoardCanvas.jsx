import React, { useEffect, useRef, useState } from 'react';
import styles from './BoardView.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Convert a screen-space point (relative to the canvas's top-left)
// into world coordinates given the current pan + zoom.
function screenToWorld(sx, sy, pan, zoom) {
  return {
    x: (sx - pan.x) / zoom,
    y: (sy - pan.y) / zoom,
  };
}

// Style props derived from item.data — used by both text and sticky
// items. Falls back to sensible per-type defaults when a field hasn't
// been customised yet.
function textStyleFor(item) {
  const isSticky = item.type === 'sticky';
  return {
    fontFamily: item.data?.fontFamily || 'inherit',
    fontSize: `${item.data?.fontSize || (isSticky ? 14 : 16)}px`,
    fontWeight: item.data?.bold ? 700 : 400,
    fontStyle: item.data?.italic ? 'italic' : 'normal',
    textAlign: item.data?.align || 'left',
    color: item.data?.color || (isSticky ? 'rgba(0, 0, 0, 0.85)' : 'var(--text-primary)'),
  };
}

// Editable text/sticky item. The contentEditable's text content is
// driven imperatively via ref to keep React from reconciling user
// keystrokes. Empty state shows a CSS-only ::before placeholder so
// the editor reads as "Type something" before the user types.
function EditableTextItem({
  item,
  selected,
  editing,
  baseStyle,
  onMouseDown,
  onBeginEdit,
  onCommitEdit,
}) {
  const ref = useRef(null);
  const cls = item.type === 'sticky' ? styles.itemSticky : styles.itemText;

  // Sync committed text → DOM when not editing. We deliberately do
  // NOT update during edit, otherwise React would clobber whatever
  // the user has typed so far.
  useEffect(() => {
    if (editing) return;
    const el = ref.current;
    if (!el) return;
    const next = item.data?.text || '';
    if (el.innerText !== next) el.innerText = next;
  }, [editing, item.data?.text]);

  // Entering edit mode: focus and put the cursor at the end of the
  // current text. The ::before placeholder is a pseudo-element so
  // it doesn't interfere with the cursor position.
  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const autosize = !item.width && item.type === 'text';

  return (
    <div
      data-item-id={item.id}
      className={[
        styles.item,
        selected && styles.itemSelected,
        autosize && styles.itemAutosize,
      ].filter(Boolean).join(' ')}
      style={baseStyle}
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onBeginEdit(item.id);
      }}
    >
      <div
        ref={ref}
        className={[cls, editing && styles.itemEditable].filter(Boolean).join(' ')}
        style={textStyleFor(item)}
        contentEditable={editing}
        suppressContentEditableWarning
        data-placeholder="Type something"
        onBlur={(e) => onCommitEdit(item.id, e.currentTarget.innerText)}
        onMouseDown={(e) => { if (editing) e.stopPropagation(); }}
        onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }}
      />
    </div>
  );
}

// Render one item by type. Each item is positioned absolutely in
// world coords; the parent .world div carries the pan/zoom transform.
function BoardItem({
  item,
  saves,
  selected,
  editing,
  onSelect,
  onMoveStart,
  onCommitEdit,
  onBeginEdit,
}) {
  const baseStyle = {
    left: item.x,
    top: item.y,
    width: item.width || undefined,
    height: item.height || undefined,
    transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
    zIndex: item.z_index ?? 0,
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    if (editing) return;
    e.stopPropagation();
    onSelect(item.id, e.shiftKey);
    onMoveStart(item, e);
  };

  if (item.type === 'image') {
    // Prefer the live save's path so a moved/restored file resolves
    // correctly; fall back to the saveId resolution and finally to
    // the URL stored in the item's data blob (legacy / unknown saves).
    const liveSave = saves.find((s) => s.id === item.data?.saveId);
    const src = liveSave
      ? fileUrl(liveSave.file_path)
      : item.data?.fileUrl || null;
    if (!src) return null;
    return (
      <div
        data-item-id={item.id}
        className={[styles.item, selected && styles.itemSelected].filter(Boolean).join(' ')}
        style={baseStyle}
        onMouseDown={handleMouseDown}
      >
        <img src={src} className={styles.itemImage} draggable={false} alt="" />
      </div>
    );
  }

  if (item.type === 'sticky' || item.type === 'text') {
    return (
      <EditableTextItem
        item={item}
        selected={selected}
        editing={editing}
        baseStyle={baseStyle}
        onMouseDown={handleMouseDown}
        onBeginEdit={onBeginEdit}
        onCommitEdit={onCommitEdit}
      />
    );
  }

  return null;
}

export default function BoardCanvas({
  items,
  saves,
  pan,
  zoom,
  onPanZoomChange,
  selectedIds,
  onSelectIds,
  editingItemId,
  onBeginEdit,
  onCommitEdit,
  onItemsChange,
  onCanvasClick,
  onDropImage,
  tool,
}) {
  const canvasRef = useRef(null);
  // While the user is panning the canvas (drag empty space with the
  // select tool, or hold space/middle-click) we track the start
  // pointer + initial pan so the offset feels 1:1.
  const panState = useRef(null);
  // While the user is dragging an item, track which items are moving
  // and the world-space offset between cursor and each item's origin.
  const moveState = useRef(null);
  const [isPanning, setIsPanning] = useState(false);

  // Wheel = zoom toward cursor. Pinch on a trackpad fires wheel events
  // with ctrlKey (browsers expose pinch as ctrl-wheel); pure wheel
  // scrolls. Treat any wheel inside the canvas as a zoom request so
  // there's a single, predictable gesture.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Anchor zoom at the cursor: world point under cursor stays
      // pinned, so the user feels they're zooming "into" what they're
      // pointing at.
      const factor = Math.exp(-e.deltaY * 0.0015);
      const nextZoom = Math.max(0.1, Math.min(4, zoom * factor));
      const wp = screenToWorld(mx, my, pan, zoom);
      const nextPan = {
        x: mx - wp.x * nextZoom,
        y: my - wp.y * nextZoom,
      };
      onPanZoomChange({ pan: nextPan, zoom: nextZoom });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pan, zoom, onPanZoomChange]);

  // Pan: mousedown on empty canvas with middle button, or with select
  // tool + space, or with select tool + alt. Keep it simple: middle
  // button anywhere, or left button on empty canvas with select tool.
  const handleCanvasMouseDown = (e) => {
    if (e.button === 1 || (e.button === 0 && tool === 'select' && e.target === e.currentTarget)) {
      e.preventDefault();
      panState.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialPan: { ...pan },
      };
      setIsPanning(true);
      // Clear selection when clicking empty canvas with select tool.
      if (e.button === 0 && !e.shiftKey) onSelectIds(new Set());
    } else if (e.button === 0 && e.target === e.currentTarget) {
      // Click on empty canvas with non-select tool: dispatch up so the
      // parent can decide what to add (sticky / text at click point).
      // The parent owns selection for these clicks — we'd otherwise
      // wipe the selection it just set on a freshly-created item.
      const rect = canvasRef.current.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, pan, zoom);
      onCanvasClick?.(world, tool);
    }
  };

  // Item move: started by BoardItem.onMouseDown, completed/tracked here
  // via window-level listeners so the cursor can wander outside the
  // canvas during a drag without the move getting stuck.
  const handleItemMoveStart = (item, e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cursor = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, pan, zoom);

    // If the user starts dragging a non-selected item, snap selection
    // to just that item; otherwise drag the whole current selection.
    let movingIds;
    if (selectedIds.has(item.id)) {
      movingIds = Array.from(selectedIds);
    } else {
      movingIds = [item.id];
      onSelectIds(new Set([item.id]));
    }

    const offsets = new Map();
    for (const id of movingIds) {
      const it = items.find((x) => x.id === id);
      if (it) offsets.set(id, { dx: it.x - cursor.x, dy: it.y - cursor.y });
    }
    moveState.current = { offsets, movingIds };
  };

  useEffect(() => {
    function onMove(e) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (panState.current) {
        const dx = e.clientX - panState.current.startX;
        const dy = e.clientY - panState.current.startY;
        onPanZoomChange({
          pan: {
            x: panState.current.initialPan.x + dx,
            y: panState.current.initialPan.y + dy,
          },
          zoom,
        });
      } else if (moveState.current) {
        const cursor = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, pan, zoom);
        const offsets = moveState.current.offsets;
        const movingIds = moveState.current.movingIds;
        const updated = items.map((it) => {
          if (!offsets.has(it.id)) return it;
          const o = offsets.get(it.id);
          return { ...it, x: cursor.x + o.dx, y: cursor.y + o.dy };
        });
        onItemsChange(updated, { movingIds, persist: false });
      }
    }
    function onUp() {
      if (panState.current) {
        panState.current = null;
        setIsPanning(false);
      }
      if (moveState.current) {
        const { movingIds } = moveState.current;
        moveState.current = null;
        // Persist the final positions of the moved items.
        onItemsChange(items, { movingIds, persist: true });
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [items, pan, zoom, onPanZoomChange, onItemsChange]);

  // Drop: a thumbnail dragged from the library drawer (data with
  // saveId) or external image drops via the host's drop handler. We
  // resolve to world coords and forward saveId + position upward.
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-moodmark-board-save')
      || e.dataTransfer.getData('application/x-moodmark-save-ids');
    if (!raw) return;
    let saveId = null;
    try {
      const parsed = JSON.parse(raw);
      saveId = Array.isArray(parsed) ? parsed[0] : parsed.saveId || parsed;
    } catch {
      saveId = raw;
    }
    if (!saveId) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, pan, zoom);
    onDropImage?.({ saveId, world });
  };

  return (
    <div
      ref={canvasRef}
      className={[
        styles.canvas,
        isPanning && styles.canvasPanning,
        tool === 'text' && styles.canvasTextTool,
        tool === 'sticky' && styles.canvasStickyTool,
      ].filter(Boolean).join(' ')}
      style={{
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
      onMouseDown={handleCanvasMouseDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        className={styles.world}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        {items.map((item) => (
          <BoardItem
            key={item.id}
            item={item}
            saves={saves}
            selected={selectedIds.has(item.id)}
            editing={editingItemId === item.id}
            onSelect={(id, additive) => {
              if (additive) {
                const next = new Set(selectedIds);
                if (next.has(id)) next.delete(id); else next.add(id);
                onSelectIds(next);
              } else if (!selectedIds.has(id)) {
                onSelectIds(new Set([id]));
              }
            }}
            onMoveStart={handleItemMoveStart}
            onBeginEdit={onBeginEdit}
            onCommitEdit={onCommitEdit}
          />
        ))}
      </div>

      {items.length === 0 && (
        <div className={styles.empty}>
          Drag images from the library, or click the canvas with the text /
          sticky tool.
          <div className={styles.emptyHint}>
            Scroll to zoom • Middle-click drag, or empty-canvas drag with the
            select tool, to pan
          </div>
        </div>
      )}
    </div>
  );
}
