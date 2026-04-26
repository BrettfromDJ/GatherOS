import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './BoardCanvas.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// World-space units. Items position themselves with absolute pixel
// coordinates inside a transformed parent, so pan/zoom is just a CSS
// transform on the world container — no per-item math.

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;
const DEFAULT_IMG_WIDTH = 220;
const DEFAULT_TEXT_WIDTH = 200;
const DEFAULT_TEXT_HEIGHT = 40;

const MIME_BOARD_DRAG = 'application/x-moodmark-save';

export default function BoardCanvas({ board, allSaves, collections = [] }) {
  const [items, setItems] = useState([]);
  const [viewport, setViewport] = useState({
    x: board.viewport_x ?? 0,
    y: board.viewport_y ?? 0,
    z: board.viewport_z ?? 1,
  });
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [dropOver, setDropOver] = useState(false);
  const [tool, setTool] = useState('select'); // 'select' | 'text'
  const [editingTextId, setEditingTextId] = useState(null);

  const viewportRef = useRef(null);
  // Throttle viewport persistence — many micro-updates while panning.
  const viewportSaveTimer = useRef(null);

  // Reload items when board changes.
  useEffect(() => {
    let cancelled = false;
    window.moodmark.boards.getItems(board.id).then((rows) => {
      if (!cancelled) setItems(rows || []);
    });
    setSelectedIds(new Set());
    setEditingTextId(null);
    setTool('select');
    setViewport({
      x: board.viewport_x ?? 0,
      y: board.viewport_y ?? 0,
      z: board.viewport_z ?? 1,
    });
    return () => { cancelled = true; };
  }, [board.id]);

  // Persist viewport with a debounce so we don't write on every pixel.
  useEffect(() => {
    if (viewportSaveTimer.current) clearTimeout(viewportSaveTimer.current);
    viewportSaveTimer.current = setTimeout(() => {
      window.moodmark.boards.updateViewport({
        id: board.id, x: viewport.x, y: viewport.y, z: viewport.z,
      });
    }, 400);
    return () => {
      if (viewportSaveTimer.current) clearTimeout(viewportSaveTimer.current);
    };
  }, [viewport, board.id]);

  // ── Coordinate conversion ──────────────────────────────────────────────
  // Screen point → world point (the inverse of the world's CSS transform).
  const screenToWorld = useCallback((sx, sy) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (sx - rect.left - viewport.x) / viewport.z,
      y: (sy - rect.top - viewport.y) / viewport.z,
    };
  }, [viewport]);

  // ── Pan / click-to-place text ──────────────────────────────────────────
  const panState = useRef(null);
  const handleViewportPointerDown = useCallback(async (e) => {
    if (e.button !== 0) return;
    if (e.target !== viewportRef.current && !e.target.classList?.contains(styles.world)) {
      // Click landed on an item — let the item's own handler take over.
      return;
    }
    e.preventDefault();

    if (tool === 'text') {
      // Drop a fresh text label at the click point and immediately
      // enter edit mode so the user can start typing.
      const { x, y } = screenToWorld(e.clientX, e.clientY);
      const created = await window.moodmark.boards.createItem({
        boardId: board.id,
        type: 'text',
        x: x - 10,
        y: y - 10,
        width: DEFAULT_TEXT_WIDTH,
        height: DEFAULT_TEXT_HEIGHT,
        text: '',
      });
      if (created) {
        setItems((prev) => [...prev, created]);
        setSelectedIds(new Set([created.id]));
        setEditingTextId(created.id);
      }
      setTool('select');
      return;
    }

    setSelectedIds(new Set());
    setEditingTextId(null);
    panState.current = {
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startVx: viewport.x,
      startVy: viewport.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [tool, viewport, board.id, screenToWorld]);

  const handleViewportPointerMove = useCallback((e) => {
    if (!panState.current) return;
    const { startScreenX, startScreenY, startVx, startVy } = panState.current;
    setViewport((v) => ({
      ...v,
      x: startVx + (e.clientX - startScreenX),
      y: startVy + (e.clientY - startScreenY),
    }));
  }, []);

  const handleViewportPointerUp = useCallback((e) => {
    if (!panState.current) return;
    panState.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }, []);

  // ── Wheel: pan (no modifier) / zoom (cmd or ctrl) ──────────────────────
  // Magic Mouse + trackpad two-finger gestures fire wheel events with
  // deltaX/deltaY, so plain wheel pans the canvas. Pinch-to-zoom on
  // macOS arrives as ctrl+wheel, which we treat the same as cmd+wheel.
  // Has to be a native non-passive listener — React 17+ wheel handlers
  // are passive by default, so preventDefault would silently fail.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    function onWheel(e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        setViewport((v) => {
          const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
          const newZ = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z + delta));
          const wx = (cx - v.x) / v.z;
          const wy = (cy - v.y) / v.z;
          return {
            z: newZ,
            x: cx - wx * newZ,
            y: cy - wy * newZ,
          };
        });
      } else {
        setViewport((v) => ({
          ...v,
          x: v.x - e.deltaX,
          y: v.y - e.deltaY,
        }));
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Item drag ──────────────────────────────────────────────────────────
  const itemDragState = useRef(null);

  const handleItemPointerDown = useCallback((e, item) => {
    if (e.button !== 0) return;
    if (editingTextId === item.id) return; // don't drag the item being edited
    e.stopPropagation();
    setSelectedIds(new Set([item.id]));
    setEditingTextId(null);
    itemDragState.current = {
      itemId: item.id,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startX: item.x,
      startY: item.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setItems((prev) => {
      const max = prev.reduce((m, it) => Math.max(m, it.z_index || 0), 0);
      return prev.map((it) =>
        it.id === item.id ? { ...it, z_index: max + 1 } : it,
      );
    });
  }, [editingTextId]);

  const handleItemPointerMove = useCallback((e) => {
    const s = itemDragState.current;
    if (!s) return;
    const dx = (e.clientX - s.startScreenX) / viewport.z;
    const dy = (e.clientY - s.startScreenY) / viewport.z;
    if (Math.abs(dx) + Math.abs(dy) > 1) s.moved = true;
    setItems((prev) =>
      prev.map((it) =>
        it.id === s.itemId ? { ...it, x: s.startX + dx, y: s.startY + dy } : it,
      ),
    );
  }, [viewport.z]);

  const handleItemPointerUp = useCallback(async (e) => {
    const s = itemDragState.current;
    if (!s) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    itemDragState.current = null;
    if (!s.moved) return;
    const moved = items.find((it) => it.id === s.itemId);
    if (moved) {
      window.moodmark.boards.updateItem({
        id: moved.id, x: moved.x, y: moved.y, zIndex: moved.z_index,
      });
    }
  }, [items]);

  // ── Text resize (corner handles on selected text items) ───────────────
  // Dragging a corner scales the box AND the font_size proportionally
  // (so the text actually gets bigger, not just the wrap width). The
  // opposite-side edge stays anchored — drag right grows from the left,
  // drag left from the right. Vertical drag is ignored; height is auto.
  const resizeState = useRef(null);

  const handleResizeStart = useCallback((e, corner, item) => {
    e.stopPropagation();
    e.preventDefault();
    // Measure the rendered box at drag-start. Text items auto-size to
    // content so the stored width isn't authoritative; for images it
    // matches but reading from the DOM is uniform either way.
    const itemEl = e.currentTarget.parentElement;
    const rect = itemEl.getBoundingClientRect();
    resizeState.current = {
      itemId: item.id,
      type: item.type,
      corner, // 'tl' | 'tr' | 'bl' | 'br'
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: item.x,
      startY: item.y,
      startWidth: rect.width / viewport.z,
      startHeight: rect.height / viewport.z,
      startFontSize: item.font_size || 16,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [viewport.z]);

  const handleResizeMove = useCallback((e) => {
    const s = resizeState.current;
    if (!s) return;
    const dx = (e.clientX - s.startMouseX) / viewport.z;
    const dirX = s.corner.includes('r') ? 1 : -1;
    const dirY = s.corner.includes('b') ? 1 : -1;
    let newWidth = Math.max(20, s.startWidth + dx * dirX);

    // Snap threshold expressed in screen pixels so the snap "feel" is
    // the same at any zoom level.
    const SNAP_PX = 6;
    const snapWorld = SNAP_PX / viewport.z;

    if (s.type === 'text') {
      let scale = newWidth / s.startWidth;
      let newFontSize = Math.max(6, Math.min(240, s.startFontSize * scale));
      // Snap font size to other text items' font sizes when within
      // a few screen pixels of the rendered diff.
      let bestDiff = SNAP_PX / viewport.z; // font-size units
      for (const it of items) {
        if (it.id === s.itemId || it.type !== 'text') continue;
        const fs = it.font_size || 16;
        const diff = Math.abs(newFontSize - fs);
        if (diff < bestDiff) {
          bestDiff = diff;
          newFontSize = fs;
        }
      }
      // Recompute newWidth from the snapped font_size so the box layout
      // tracks the snap (left-anchor x shift uses this).
      scale = newFontSize / s.startFontSize;
      newWidth = s.startWidth * scale;
      const newX = dirX < 0 ? s.startX - (newWidth - s.startWidth) : s.startX;
      setItems((prev) => prev.map((it) =>
        it.id === s.itemId ? { ...it, font_size: newFontSize, x: newX } : it,
      ));
    } else {
      // Images keep aspect ratio. Snap newWidth to either another
      // image's width directly, or to the width that would produce
      // a matching height. Pick the closest.
      const aspect = s.startWidth / s.startHeight;
      let bestDiff = snapWorld;
      for (const it of items) {
        if (it.id === s.itemId || it.type !== 'image') continue;
        const wDiff = Math.abs(newWidth - it.width);
        if (wDiff < bestDiff) { bestDiff = wDiff; newWidth = it.width; }
        const candidateW = it.height * aspect;
        const hDiff = Math.abs(newWidth - candidateW);
        if (hDiff < bestDiff) { bestDiff = hDiff; newWidth = candidateW; }
      }
      const scale = newWidth / s.startWidth;
      const newHeight = Math.max(20, s.startHeight * scale);
      const newX = dirX < 0 ? s.startX - (newWidth - s.startWidth) : s.startX;
      const newY = dirY < 0 ? s.startY - (newHeight - s.startHeight) : s.startY;
      setItems((prev) => prev.map((it) =>
        it.id === s.itemId
          ? { ...it, width: newWidth, height: newHeight, x: newX, y: newY }
          : it,
      ));
    }
  }, [viewport.z, items]);

  const handleResizeEnd = useCallback(async (e) => {
    const s = resizeState.current;
    if (!s) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    resizeState.current = null;
    const item = items.find((it) => it.id === s.itemId);
    if (!item) return;
    if (item.type === 'text') {
      await window.moodmark.boards.updateItem({
        id: item.id, x: item.x, fontSize: item.font_size,
      });
    } else {
      await window.moodmark.boards.updateItem({
        id: item.id, x: item.x, y: item.y, width: item.width, height: item.height,
      });
    }
  }, [items]);

  // ── Text edit ──────────────────────────────────────────────────────────
  const handleItemDoubleClick = useCallback((item) => {
    if (item.type !== 'text') return;
    setEditingTextId(item.id);
    setSelectedIds(new Set([item.id]));
  }, []);

  const handleTextChange = useCallback((id, value) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, text: value } : it)));
  }, []);

  const handleStyleChange = useCallback((id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    // Persist immediately — formatting toggles are discrete clicks, not
    // a stream like text typing, so debouncing buys nothing.
    const ipcPatch = { id };
    if ('font_size' in patch) ipcPatch.fontSize = patch.font_size;
    if ('bold' in patch)      ipcPatch.bold = patch.bold;
    if ('italic' in patch)    ipcPatch.italic = patch.italic;
    if ('strike' in patch)    ipcPatch.strike = patch.strike;
    if ('align' in patch)     ipcPatch.align = patch.align;
    if ('color' in patch)     ipcPatch.color = patch.color;
    window.moodmark.boards.updateItem(ipcPatch);
  }, []);

  const handleTextCommit = useCallback(async (id) => {
    setEditingTextId((curr) => (curr === id ? null : curr));
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const trimmed = (item.text || '').trim();
    if (!trimmed) {
      // Empty text labels would just be dead placeholders; delete instead.
      await window.moodmark.boards.deleteItem(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    await window.moodmark.boards.updateItem({ id, text: item.text });
  }, [items]);

  // ── Drop from library drawer ───────────────────────────────────────────
  const handleDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes(MIME_BOARD_DRAG)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDropOver(false);
  }, []);

  const handleDrop = useCallback(async (e) => {
    setDropOver(false);
    const saveId = e.dataTransfer.getData(MIME_BOARD_DRAG);
    if (!saveId) return;
    e.preventDefault();
    const save = allSaves.find((s) => s.id === saveId);
    if (!save) return;
    const aspect = save.width && save.height ? save.width / save.height : 4 / 3;
    const width = DEFAULT_IMG_WIDTH;
    const height = width / aspect;
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const created = await window.moodmark.boards.createItem({
      boardId: board.id,
      type: 'image',
      saveId,
      x: x - width / 2,
      y: y - height / 2,
      width,
      height,
    });
    if (created) {
      setItems((prev) => [
        ...prev,
        { ...created, save_file_path: save.file_path, save_thumb_path: save.thumb_path },
      ]);
    }
  }, [allSaves, board.id, screenToWorld]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') {
        // Escape exits the text tool and ends any in-progress text edit.
        if (editingTextId) {
          // Let the textarea's own onBlur fire so we hit the commit path.
          e.target?.blur?.();
          return;
        }
        setTool('select');
        return;
      }

      if (inField) return;

      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setTool((t) => (t === 'text' ? 'select' : 'text'));
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        const ids = [...selectedIds];
        Promise.all(ids.map((id) => window.moodmark.boards.deleteItem(id))).then(() => {
          setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)));
          setSelectedIds(new Set());
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, editingTextId]);

  const sortedItems = [...items].sort(
    (a, b) => (a.z_index || 0) - (b.z_index || 0),
  );

  const viewportClass = [
    styles.viewport,
    dropOver && styles.viewportDropOver,
    tool === 'text' && styles.viewportText,
  ].filter(Boolean).join(' ');

  // The text-formatting toolbar follows whichever text item is active —
  // either being edited, or selected on its own. Positioned in screen
  // space so it stays a fixed size regardless of zoom.
  const activeTextItem = (() => {
    if (editingTextId) return items.find((it) => it.id === editingTextId);
    if (selectedIds.size === 1) {
      const id = [...selectedIds][0];
      const it = items.find((x) => x.id === id);
      if (it && it.type === 'text') return it;
    }
    return null;
  })();

  return (
    <div className={styles.canvas}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarTitle}>{board.name}</div>
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={[styles.toolbarBtn, tool === 'text' && styles.toolbarBtnActive]
              .filter(Boolean).join(' ')}
            onClick={() => setTool((t) => (t === 'text' ? 'select' : 'text'))}
            title="Add text (T)"
          >
            T
          </button>
          <span className={styles.zoomLabel}>{Math.round(viewport.z * 100)}%</span>
          <button
            type="button"
            className={styles.toolbarBtn}
            onClick={() => setViewport({ x: 0, y: 0, z: 1 })}
            title="Reset view"
          >
            Reset
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <LibraryDrawer allSaves={allSaves} collections={collections} />

        <div
          ref={viewportRef}
          className={viewportClass}
          style={{
            '--zoom': viewport.z,
            '--pan-x': `${viewport.x}px`,
            '--pan-y': `${viewport.y}px`,
          }}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handleViewportPointerMove}
          onPointerUp={handleViewportPointerUp}
          onPointerCancel={handleViewportPointerUp}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div
            className={styles.world}
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.z})`,
              '--zoom': viewport.z,
            }}
          >
            {sortedItems.map((item) => (
              <BoardItem
                key={item.id}
                item={item}
                selected={selectedIds.has(item.id)}
                editing={editingTextId === item.id}
                onPointerDown={handleItemPointerDown}
                onPointerMove={handleItemPointerMove}
                onPointerUp={handleItemPointerUp}
                onDoubleClick={handleItemDoubleClick}
                onTextChange={handleTextChange}
                onTextCommit={handleTextCommit}
                onResizeStart={handleResizeStart}
                onResizeMove={handleResizeMove}
                onResizeEnd={handleResizeEnd}
              />
            ))}
            {items.length === 0 && (
              <div className={styles.emptyHint}>
                Drag images from the library on the left, or press T to add text.
              </div>
            )}
          </div>

          {activeTextItem && (
            <TextFormatToolbar
              item={activeTextItem}
              viewport={viewport}
              onChange={(patch) => handleStyleChange(activeTextItem.id, patch)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function BoardItem({
  item, selected, editing,
  onPointerDown, onPointerMove, onPointerUp,
  onDoubleClick, onTextChange, onTextCommit,
  onResizeStart, onResizeMove, onResizeEnd,
}) {
  if (item.type === 'image') {
    const style = {
      transform: `translate(${item.x}px, ${item.y}px)`,
      width: `${item.width}px`,
      height: `${item.height}px`,
      zIndex: item.z_index || 0,
    };
    const cls = [styles.item, selected && styles.itemSelected].filter(Boolean).join(' ');
    const src = item.save_file_path ? fileUrl(item.save_file_path) : null;
    return (
      <div
        className={cls}
        style={style}
        onPointerDown={(e) => onPointerDown(e, item)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {src ? (
          <img src={src} alt={item.save_title || ''} draggable={false} />
        ) : (
          <div className={styles.itemPlaceholder}>image deleted</div>
        )}
        {selected && (
          <>
            {['tl', 'tr', 'bl', 'br'].map((corner) => (
              <div
                key={corner}
                className={[styles.resizeHandle, styles[`handle_${corner}`]].join(' ')}
                onPointerDown={(e) => onResizeStart(e, corner, item)}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeEnd}
                onPointerCancel={onResizeEnd}
              />
            ))}
          </>
        )}
      </div>
    );
  }

  if (item.type === 'text') {
    return (
      <TextItem
        item={item}
        selected={selected}
        editing={editing}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onTextChange={onTextChange}
        onTextCommit={onTextCommit}
        onResizeStart={onResizeStart}
        onResizeMove={onResizeMove}
        onResizeEnd={onResizeEnd}
      />
    );
  }

  return null;
}

function TextItem({
  item, selected, editing,
  onPointerDown, onPointerMove, onPointerUp,
  onDoubleClick, onTextChange, onTextCommit,
  onResizeStart, onResizeMove, onResizeEnd,
}) {
  const textareaRef = useRef(null);

  // Autofocus + select all when entering edit mode. CSS handles sizing
  // (textarea uses `field-sizing: content`).
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  // No width/height in style — the box auto-sizes to its text content.
  const style = {
    transform: `translate(${item.x}px, ${item.y}px)`,
    zIndex: item.z_index || 0,
  };
  const cls = [
    styles.textItem,
    selected && styles.textItemSelected,
    editing && styles.textItemEditing,
  ].filter(Boolean).join(' ');

  const textStyle = {
    fontSize: `${item.font_size || 16}px`,
    fontWeight: item.bold ? 700 : 400,
    fontStyle: item.italic ? 'italic' : 'normal',
    textDecoration: item.strike ? 'line-through' : 'none',
    textAlign: item.align || 'left',
    color: item.color || undefined,
  };

  return (
    <div
      className={cls}
      style={style}
      onPointerDown={(e) => { if (!editing) onPointerDown(e, item); }}
      onPointerMove={(e) => { if (!editing) onPointerMove(e); }}
      onPointerUp={(e) => { if (!editing) onPointerUp(e); }}
      onPointerCancel={(e) => { if (!editing) onPointerUp(e); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(item); }}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          className={styles.textInput}
          style={textStyle}
          value={item.text || ''}
          placeholder="Add Text"
          onChange={(e) => onTextChange(item.id, e.target.value)}
          onBlur={() => onTextCommit(item.id)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              e.target.blur();
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className={styles.textDisplay} style={textStyle}>
          {item.text
            ? item.text
            : <span className={styles.textPlaceholder}>Add Text</span>}
        </div>
      )}
      {selected && !editing && (
        <>
          {['tl', 'tr', 'bl', 'br'].map((corner) => (
            <div
              key={corner}
              className={[styles.resizeHandle, styles[`handle_${corner}`]].join(' ')}
              onPointerDown={(e) => onResizeStart(e, corner, item)}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              onPointerCancel={onResizeEnd}
            />
          ))}
        </>
      )}
    </div>
  );
}

// Floating toolbar that hovers above the active text item with the
// formatting controls — color, size, bold/italic/strike, alignment.
// Positioned in screen space (sibling of the world container) so it
// doesn't scale with zoom and stays at a fixed visual size.
const SIZE_PRESETS = [
  { label: 'Small',  value: 10 },
  { label: 'Medium', value: 18 },
  { label: 'Large',  value: 36 },
  { label: 'Huge',   value: 64 },
];
const COLOR_SWATCHES = [
  '#1c1c1e', '#8e8e93', '#ff3b30', '#ff9500',
  '#ffcc00', '#34c759', '#0a84ff', '#af52de',
];

function TextFormatToolbar({ item, viewport, onChange }) {
  const [colorOpen, setColorOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);

  // World → screen position. Sit just above the item with a small gap.
  const screenX = viewport.x + item.x * viewport.z;
  const screenY = viewport.y + item.y * viewport.z;
  const style = {
    left: `${screenX}px`,
    top: `${screenY - 52}px`,
  };

  // Stop pointer/mousedown from bubbling so the canvas pan handler and
  // the textarea's blur both leave us alone while clicking the toolbar.
  const swallow = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const currentSize = item.font_size || 16;
  const currentSizeLabel =
    SIZE_PRESETS.find((s) => s.value === currentSize)?.label
    ?? `${Math.round(currentSize)}`;
  const currentAlign = item.align || 'left';

  return (
    <div className={styles.fmtToolbar} style={style} onMouseDown={swallow}>
      <div className={styles.fmtGroup}>
        <button
          type="button"
          className={styles.fmtBtn}
          onClick={() => { setColorOpen((v) => !v); setSizeOpen(false); setAlignOpen(false); }}
          title="Text color"
        >
          <span
            className={styles.fmtColorChip}
            style={{ background: item.color || '#ffffff', borderColor: item.color ? 'transparent' : 'rgba(255,255,255,0.4)' }}
          />
          <Chevron />
        </button>
        {colorOpen && (
          <div className={styles.fmtPopover}>
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.fmtSwatch}
                style={{ background: c }}
                onClick={() => { onChange({ color: c }); setColorOpen(false); }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.fmtDivider} />

      <div className={styles.fmtGroup}>
        <button
          type="button"
          className={styles.fmtBtn}
          onClick={() => { setSizeOpen((v) => !v); setColorOpen(false); setAlignOpen(false); }}
          title="Text size"
        >
          <span className={styles.fmtSizeLabel}>{currentSizeLabel}</span>
          <Chevron />
        </button>
        {sizeOpen && (
          <div className={styles.fmtPopoverList}>
            {SIZE_PRESETS.map((s) => (
              <button
                key={s.value}
                type="button"
                className={[styles.fmtMenuItem, currentSize === s.value && styles.fmtMenuItemActive].filter(Boolean).join(' ')}
                onClick={() => { onChange({ font_size: s.value }); setSizeOpen(false); }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.fmtDivider} />

      <button
        type="button"
        className={[styles.fmtBtn, item.bold && styles.fmtBtnActive].filter(Boolean).join(' ')}
        onClick={() => onChange({ bold: !item.bold })}
        title="Bold"
      >
        <span style={{ fontWeight: 700 }}>B</span>
      </button>
      <button
        type="button"
        className={[styles.fmtBtn, item.italic && styles.fmtBtnActive].filter(Boolean).join(' ')}
        onClick={() => onChange({ italic: !item.italic })}
        title="Italic"
      >
        <span style={{ fontStyle: 'italic', fontFamily: 'serif' }}>I</span>
      </button>
      <button
        type="button"
        className={[styles.fmtBtn, item.strike && styles.fmtBtnActive].filter(Boolean).join(' ')}
        onClick={() => onChange({ strike: !item.strike })}
        title="Strikethrough"
      >
        <span style={{ textDecoration: 'line-through' }}>S</span>
      </button>

      <div className={styles.fmtDivider} />

      <div className={styles.fmtGroup}>
        <button
          type="button"
          className={styles.fmtBtn}
          onClick={() => { setAlignOpen((v) => !v); setColorOpen(false); setSizeOpen(false); }}
          title="Alignment"
        >
          <AlignIcon align={currentAlign} />
          <Chevron />
        </button>
        {alignOpen && (
          <div className={styles.fmtPopoverList}>
            {['left', 'center', 'right'].map((a) => (
              <button
                key={a}
                type="button"
                className={[styles.fmtMenuItem, currentAlign === a && styles.fmtMenuItemActive].filter(Boolean).join(' ')}
                onClick={() => { onChange({ align: a }); setAlignOpen(false); }}
              >
                <AlignIcon align={a} />
                <span style={{ marginLeft: 8, textTransform: 'capitalize' }}>{a}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg width="8" height="6" viewBox="0 0 8 6" aria-hidden="true">
      <path d="M0 0l4 6 4-6z" fill="currentColor" />
    </svg>
  );
}

function AlignIcon({ align }) {
  const lines = {
    left:   [{ x: 1, w: 12 }, { x: 1, w: 8 }, { x: 1, w: 12 }, { x: 1, w: 6 }],
    center: [{ x: 2, w: 12 }, { x: 4, w: 8 }, { x: 2, w: 12 }, { x: 5, w: 6 }],
    right:  [{ x: 3, w: 12 }, { x: 7, w: 8 }, { x: 3, w: 12 }, { x: 9, w: 6 }],
  }[align] || [];
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      {lines.map((l, i) => (
        <rect key={i} x={l.x} y={1 + i * 3} width={l.w} height="1.5" rx="0.5" fill="currentColor" />
      ))}
    </svg>
  );
}

// Slim drawer of library thumbnails the user can drag onto the canvas.
// Top-of-drawer dropdown filters which saves are shown (All / Favorites
// / Recent / each Collection). HTML5 drag with a custom MIME so the
// canvas's drop handler distinguishes Moodmark drops from Finder drops.
function LibraryDrawer({ allSaves, collections }) {
  const [filterValue, setFilterValue] = useState('all');
  const [filteredSaves, setFilteredSaves] = useState(allSaves);

  // Re-derive the visible list whenever the filter or the source list
  // changes. For non-"all" filters we hit the backend so collection
  // membership / favorites / recent semantics match the rest of the
  // app exactly, with no client-side reimplementation.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (filterValue === 'all') {
        if (!cancelled) setFilteredSaves(allSaves);
        return;
      }
      const opts = {};
      if (filterValue === 'favorites' || filterValue === 'recent') {
        opts.filter = filterValue;
      } else {
        opts.collectionId = filterValue;
      }
      const data = await window.moodmark.saves.getAll(opts);
      if (!cancelled) setFilteredSaves(data || []);
    }
    run();
    return () => { cancelled = true; };
  }, [filterValue, allSaves]);

  return (
    <aside className={styles.drawer}>
      <div className={styles.drawerHeader}>
        <select
          className={styles.drawerSelect}
          value={filterValue}
          onChange={(e) => setFilterValue(e.target.value)}
        >
          <option value="all">All</option>
          <option value="favorites">Favorites</option>
          <option value="recent">Recent</option>
          {collections.length > 0 && (
            <optgroup label="Collections">
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <div className={styles.drawerList}>
        {filteredSaves.map((save) => (
          <div
            key={save.id}
            className={styles.drawerItem}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'copy';
              e.dataTransfer.setData(MIME_BOARD_DRAG, save.id);
            }}
            title={save.title || 'Drag onto board'}
          >
            <img
              src={fileUrl(save.thumb_path || save.file_path)}
              alt={save.title || ''}
              draggable={false}
            />
          </div>
        ))}
        {filteredSaves.length === 0 && (
          <div className={styles.drawerEmpty}>Nothing here.</div>
        )}
      </div>
    </aside>
  );
}
