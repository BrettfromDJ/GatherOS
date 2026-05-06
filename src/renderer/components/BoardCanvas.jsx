import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

// Inner editable for text/sticky items. The contentEditable's text
// content is driven imperatively via ref so React doesn't reconcile
// away the user's keystrokes during edit. Empty state shows a
// CSS-only ::before placeholder so the editor reads as "Type
// something" before the user types.
function EditableTextContent({ item, editing, onCommitEdit }) {
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
  // current text. Use useLayoutEffect so the focus runs synchronously
  // after the DOM commit (before paint) — using a regular useEffect
  // here causes a race where the user's mouseup lands before the
  // focus settles, leaving the contentEditable un-focused and the
  // user has to click a second time before typing works.
  useLayoutEffect(() => {
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

  return (
    <div
      ref={ref}
      className={[cls, editing && styles.itemEditable].filter(Boolean).join(' ')}
      style={textStyleFor(item)}
      contentEditable={editing}
      suppressContentEditableWarning
      // Explicit tabIndex so the contentEditable is unambiguously
      // focusable on every browser (Chromium occasionally refuses
      // .focus() on a contentEditable that's just been promoted from
      // contentEditable=false without a tabindex).
      tabIndex={editing ? 0 : -1}
      data-placeholder="Type something"
      onBlur={(e) => {
        onCommitEdit(item.id, e.currentTarget.innerText);
        // Clear any text the user had highlighted inside the editor
        // before clicking out — without this the highlight stays
        // painted on the deselected item until they click again.
        const sel = window.getSelection();
        if (sel && sel.anchorNode && e.currentTarget.contains(sel.anchorNode)) {
          sel.removeAllRanges();
        }
      }}
      onMouseDown={(e) => { if (editing) e.stopPropagation(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }}
    />
  );
}

// 4 corner handles, rendered when the item is selected. Each
// handle dispatches its corner identifier so the canvas's resize
// math knows which edges are anchored vs moving.
function SelectionHandles({ onResizeStart }) {
  const start = (corner) => (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onResizeStart(corner, e);
  };
  return (
    <>
      <span className={`${styles.handle} ${styles.handleNw}`} onMouseDown={start('nw')} />
      <span className={`${styles.handle} ${styles.handleNe}`} onMouseDown={start('ne')} />
      <span className={`${styles.handle} ${styles.handleSw}`} onMouseDown={start('sw')} />
      <span className={`${styles.handle} ${styles.handleSe}`} onMouseDown={start('se')} />
    </>
  );
}

// Render one item by type. Each item is positioned absolutely in
// world coords; the parent .world div carries the pan/zoom transform.
// All types share the same wrapper so selection ring + corner
// handles + move/double-click semantics are identical.
function BoardItem({
  item,
  saves,
  selected,
  editing,
  onSelect,
  onMoveStart,
  onResizeStart,
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

  let content = null;
  let isTextish = false;
  if (item.type === 'image') {
    // Prefer the live save's path so a moved/restored file resolves
    // correctly; fall back to the URL stored on the item.
    const liveSave = saves.find((s) => s.id === item.data?.saveId);
    const src = liveSave
      ? fileUrl(liveSave.file_path)
      : item.data?.fileUrl || null;
    if (!src) return null;
    content = (
      <img src={src} className={styles.itemImage} draggable={false} alt="" />
    );
  } else if (item.type === 'text' || item.type === 'sticky') {
    isTextish = true;
    content = (
      <EditableTextContent
        item={item}
        editing={editing}
        onCommitEdit={onCommitEdit}
      />
    );
  } else {
    return null;
  }

  const autosize = isTextish && !item.width && item.type === 'text';

  return (
    <div
      data-item-id={item.id}
      className={[
        styles.item,
        selected && styles.itemSelected,
        autosize && styles.itemAutosize,
      ].filter(Boolean).join(' ')}
      style={baseStyle}
      onMouseDown={handleMouseDown}
      onDoubleClick={isTextish ? (e) => { e.stopPropagation(); onBeginEdit(item.id); } : undefined}
    >
      {content}
      {selected && (
        <SelectionHandles
          onResizeStart={(corner, e) => onResizeStart(item, corner, e)}
        />
      )}
    </div>
  );
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
  // While the user is dragging a resize handle, track which corner
  // is anchored, the item's starting rect, and (for text) starting
  // font size so we can scale the text uniformly with the resize.
  const resizeState = useRef(null);
  const [isPanning, setIsPanning] = useState(false);

  // Wheel handling matches the standard canvas convention:
  //   - plain trackpad / mouse scroll  → pan (deltaX, deltaY apply
  //     directly to the pan offset, so two-finger trackpad scroll
  //     drags the canvas around);
  //   - Cmd/Ctrl + scroll              → zoom toward the cursor;
  //   - trackpad pinch                 → zoom toward the cursor.
  //     (Browsers expose pinch as a wheel event with ctrlKey=true,
  //     so the same modifier branch handles both.)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        // Anchor zoom at the cursor: the world point under the
        // cursor stays pinned. 0.005 is a middle ground that feels
        // responsive for trackpad pinches (deltaY ~ 1–10) without
        // being twitchy for Cmd+wheel (deltaY ~ 100).
        const factor = Math.exp(-e.deltaY * 0.005);
        const nextZoom = Math.max(0.1, Math.min(4, zoom * factor));
        const wp = screenToWorld(mx, my, pan, zoom);
        const nextPan = {
          x: mx - wp.x * nextZoom,
          y: my - wp.y * nextZoom,
        };
        onPanZoomChange({ pan: nextPan, zoom: nextZoom });
      } else {
        onPanZoomChange({
          pan: { x: pan.x - e.deltaX, y: pan.y - e.deltaY },
          zoom,
        });
      }
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
      // Also explicitly blur any focused contentEditable so the
      // editor's onBlur handler fires onCommitEdit → editingItemId
      // clears, hiding the cursor + floating styler. Without this
      // the preventDefault above suppresses the browser's own
      // focus-management blur and the cursor lingers in the editor.
      if (e.button === 0 && !e.shiftKey) {
        const editing = document.querySelector('[contenteditable="true"]');
        if (editing) editing.blur();
        onSelectIds(new Set());
      }
    } else if (e.button === 0 && e.target === e.currentTarget) {
      // Click on empty canvas with non-select tool: dispatch up so
      // the parent can decide what to add (sticky / text at click
      // point). preventDefault is critical — without it the browser's
      // default mousedown behaviour clears focus from any element
      // *after* our handler returns, which means the contentEditable
      // we just created and focused gets blurred a few microseconds
      // later, leaving the user unable to type until they click
      // again. The preventDefault keeps focus exactly where we put it.
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, pan, zoom);
      onCanvasClick?.(world, tool);
    }
  };

  // Resize drag: capture the initial rect (filling in measured size
  // for autosize text items that have width/height = null), the
  // active corner, and starting font size. The window-level
  // mousemove listener below applies dx/dy to the right edges and
  // anchors the opposite corner.
  const handleItemResizeStart = (item, corner, e) => {
    const itemEl = canvasRef.current.querySelector(`[data-item-id="${item.id}"]`);
    let measuredW = item.width;
    let measuredH = item.height;
    if ((!measuredW || !measuredH) && itemEl) {
      const r = itemEl.getBoundingClientRect();
      // Convert measured screen size back to world units.
      measuredW = measuredW || r.width / zoom;
      measuredH = measuredH || r.height / zoom;
    }
    resizeState.current = {
      itemId: item.id,
      type: item.type,
      corner,
      startMouse: { x: e.clientX, y: e.clientY },
      initial: {
        x: item.x,
        y: item.y,
        width: measuredW || 100,
        height: measuredH || 40,
        fontSize: item.data?.fontSize || (item.type === 'sticky' ? 14 : 16),
        data: item.data || {},
      },
    };
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
      } else if (resizeState.current) {
        const { itemId, type, corner, startMouse, initial } = resizeState.current;
        // Convert pointer delta into world units up front so the math
        // below stays in the item's coordinate space.
        const dxW = (e.clientX - startMouse.x) / zoom;
        const dyW = (e.clientY - startMouse.y) / zoom;

        // Decide which directions each corner pulls. The opposite
        // corner stays anchored — its world position never changes.
        const anchorRight = corner === 'nw' || corner === 'sw';
        const anchorBottom = corner === 'nw' || corner === 'ne';
        const dxSigned = anchorRight ? -dxW : dxW;
        const dySigned = anchorBottom ? -dyW : dyW;

        const MIN = 24;
        let newW = Math.max(MIN, initial.width + dxSigned);
        let newH = Math.max(MIN, initial.height + dySigned);

        // For text/sticky we resize uniformly so the text stays
        // legible (and so font scaling has a single ratio to apply).
        // For images we keep the user's free aspect.
        if (type === 'text' || type === 'sticky') {
          // Use the larger axis ratio so the user feels the corner
          // they're holding actually moves under their cursor.
          const sx = newW / initial.width;
          const sy = newH / initial.height;
          const s = Math.max(sx, sy);
          newW = Math.max(MIN, initial.width * s);
          newH = Math.max(MIN, initial.height * s);
        }

        // Anchor the opposite corner: shift x/y so the corner the
        // user is NOT holding stays put.
        const newX = anchorRight ? initial.x + (initial.width - newW) : initial.x;
        const newY = anchorBottom ? initial.y + (initial.height - newH) : initial.y;

        const updated = items.map((it) => {
          if (it.id !== itemId) return it;
          // Text items don't carry an explicit width or height — only
          // fontSize. The wrapper's width/height come from the text
          // itself (max-content + auto), so the bounding box always
          // hugs every side of the content exactly. newW / newH are
          // still used to anchor the opposite corner during the drag,
          // but never written back onto the item.
          if (type === 'text') {
            const scale = newW / initial.width;
            return {
              ...it,
              x: newX,
              y: newY,
              width: null,
              height: null,
              data: {
                ...initial.data,
                fontSize: Math.max(8, Math.min(200, Math.round(initial.fontSize * scale))),
              },
            };
          }
          // Sticky and image: traditional explicit-size resize. Sticky
          // keeps its body type at the default fontSize — only the
          // box grows.
          return {
            ...it,
            x: newX,
            y: newY,
            width: newW,
            height: newH,
          };
        });
        onItemsChange(updated, { movingIds: [itemId], persist: false });
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
      if (resizeState.current) {
        const id = resizeState.current.itemId;
        resizeState.current = null;
        onItemsChange(items, { movingIds: [id], persist: true });
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
            onResizeStart={handleItemResizeStart}
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
            Two-finger scroll to pan • Pinch or ⌘+scroll to zoom
          </div>
        </div>
      )}
    </div>
  );
}
