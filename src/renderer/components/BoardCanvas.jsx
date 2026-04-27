import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './BoardCanvas.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// World-space units. Items position themselves with absolute pixel
// coordinates inside a transformed parent, so pan/zoom is just a CSS
// transform on the world container — no per-item math.

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;
const DEFAULT_IMG_WIDTH = 320;
const DEFAULT_TEXT_WIDTH = 200;
const DEFAULT_TEXT_HEIGHT = 40;

const MIME_BOARD_DRAG = 'application/x-moodmark-save';

// Approximate world-space bounds for an item. Images use stored
// width/height directly; text is estimated from font_size and the
// longest line — close enough for the union bbox without paying for
// a DOM measurement round-trip.
function getItemBounds(item) {
  if (item.type === 'image') {
    return { x: item.x, y: item.y, width: item.width, height: item.height };
  }
  const fs = item.font_size || 16;
  const text = item.text || 'Add Text';
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const width = Math.max(40, longest * fs * 0.55) + 12;
  const height = lines.length * fs * 1.3 + 8;
  return { x: item.x, y: item.y, width, height };
}

function unionBounds(items) {
  if (!items.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    const b = getItemBounds(it);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export default function BoardCanvas({ board, allSaves, collections = [] }) {
  const [items, setItems] = useState([]);
  const [viewport, setViewport] = useState({
    x: board.viewport_x ?? 0,
    y: board.viewport_y ?? 0,
    z: board.viewport_z ?? 1,
  });
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [dropOver, setDropOver] = useState(false);
  const [tool, setTool] = useState('select'); // 'select' | 'hand' | 'text'
  const [editingTextId, setEditingTextId] = useState(null);
  // Marquee (rubber-band) selection rectangle in world coords.
  const [marquee, setMarquee] = useState(null);

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

  // ── Viewport pointer (pan / marquee / drop text) ──────────────────────
  const panState = useRef(null);
  const marqueeRef = useRef(null);

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

    if (tool === 'hand') {
      // Pan the canvas — no selection changes.
      panState.current = {
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        startVx: viewport.x,
        startVy: viewport.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Select tool: start a marquee. Without shift we clear the existing
    // selection up front; with shift we preserve it as a baseline that
    // the marquee adds to.
    setEditingTextId(null);
    if (!e.shiftKey) setSelectedIds(new Set());
    const start = screenToWorld(e.clientX, e.clientY);
    marqueeRef.current = {
      startX: start.x,
      startY: start.y,
      shift: e.shiftKey,
      baseSelection: new Set(selectedIds),
    };
    setMarquee({ x: start.x, y: start.y, width: 0, height: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [tool, viewport, board.id, screenToWorld, selectedIds]);

  const handleViewportPointerMove = useCallback((e) => {
    if (panState.current) {
      const { startScreenX, startScreenY, startVx, startVy } = panState.current;
      setViewport((v) => ({
        ...v,
        x: startVx + (e.clientX - startScreenX),
        y: startVy + (e.clientY - startScreenY),
      }));
      return;
    }
    if (marqueeRef.current) {
      const m = marqueeRef.current;
      const cur = screenToWorld(e.clientX, e.clientY);
      setMarquee({
        x: Math.min(m.startX, cur.x),
        y: Math.min(m.startY, cur.y),
        width: Math.abs(cur.x - m.startX),
        height: Math.abs(cur.y - m.startY),
      });
    }
  }, [screenToWorld]);

  const handleViewportPointerUp = useCallback((e) => {
    if (panState.current) {
      panState.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      return;
    }
    if (marqueeRef.current) {
      const m = marqueeRef.current;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      // Resolve final marquee bounds and select everything that
      // intersects. Sub-2px boxes are treated as a click — no items.
      setMarquee((cur) => {
        if (cur && (cur.width > 2 || cur.height > 2)) {
          const hit = items.filter((it) => {
            const b = getItemBounds(it);
            return !(b.x + b.width < cur.x
                  || b.x > cur.x + cur.width
                  || b.y + b.height < cur.y
                  || b.y > cur.y + cur.height);
          });
          setSelectedIds(() => {
            const next = m.shift ? new Set(m.baseSelection) : new Set();
            for (const it of hit) next.add(it.id);
            return next;
          });
        }
        return null;
      });
      marqueeRef.current = null;
    }
  }, [items]);

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

  // ── Item drag (single + multi-select) ─────────────────────────────────
  const itemDragState = useRef(null);

  const handleItemPointerDown = useCallback((e, item) => {
    if (e.button !== 0) return;
    if (editingTextId === item.id) return; // don't drag the item being edited
    e.stopPropagation();

    if (e.shiftKey) {
      // Toggle this item in the selection; don't begin a drag.
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      setEditingTextId(null);
      return;
    }

    // No shift: keep the multi-selection if this item is part of it,
    // otherwise replace selection with just this item. Drag follows.
    const inGroup = selectedIds.has(item.id) && selectedIds.size > 1;
    const dragIds = inGroup ? [...selectedIds] : [item.id];
    if (!inGroup) setSelectedIds(new Set([item.id]));
    setEditingTextId(null);

    const startPositions = {};
    for (const it of items) {
      if (dragIds.includes(it.id)) startPositions[it.id] = { x: it.x, y: it.y };
    }

    itemDragState.current = {
      primaryId: item.id,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startPositions,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    // Bump z only on the clicked item, not the whole group.
    setItems((prev) => {
      const max = prev.reduce((m, it) => Math.max(m, it.z_index || 0), 0);
      return prev.map((it) =>
        it.id === item.id ? { ...it, z_index: max + 1 } : it,
      );
    });
  }, [editingTextId, selectedIds, items]);

  const handleItemPointerMove = useCallback((e) => {
    const s = itemDragState.current;
    if (!s) return;
    const dx = (e.clientX - s.startScreenX) / viewport.z;
    const dy = (e.clientY - s.startScreenY) / viewport.z;
    if (Math.abs(dx) + Math.abs(dy) > 1) s.moved = true;
    setItems((prev) => prev.map((it) => {
      const start = s.startPositions[it.id];
      if (!start) return it;
      return { ...it, x: start.x + dx, y: start.y + dy };
    }));
  }, [viewport.z]);

  const handleItemPointerUp = useCallback(async (e) => {
    const s = itemDragState.current;
    if (!s) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    itemDragState.current = null;
    if (!s.moved) return;
    const moved = items.filter((it) => s.startPositions[it.id]);
    await Promise.all(moved.map((it) =>
      window.moodmark.boards.updateItem({
        id: it.id,
        x: it.x,
        y: it.y,
        ...(it.id === s.primaryId ? { zIndex: it.z_index } : {}),
      }),
    ));
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
    // Handles now live on the SelectionFrame layer, not inside the item,
    // so we use the item's logical bounds directly (image: stored
    // width/height; text: approximation from font_size + content).
    const b = getItemBounds(item);
    resizeState.current = {
      itemId: item.id,
      type: item.type,
      corner, // 'tl' | 'tr' | 'bl' | 'br'
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: item.x,
      startY: item.y,
      startWidth: b.width,
      startHeight: b.height,
      startFontSize: item.font_size || 16,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

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

  // ── Group resize (multi-selection union bbox) ─────────────────────────
  const groupResizeState = useRef(null);

  const handleGroupResizeStart = useCallback((e, corner) => {
    e.stopPropagation();
    e.preventDefault();
    const selected = items.filter((it) => selectedIds.has(it.id));
    const u = unionBounds(selected);
    if (!u) return;
    groupResizeState.current = {
      corner,
      startMouseX: e.clientX,
      startBox: u,
      startItems: selected.map((it) => ({
        id: it.id,
        type: it.type,
        x: it.x,
        y: it.y,
        width: it.width,
        height: it.height,
        font_size: it.font_size || 16,
      })),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [items, selectedIds]);

  const handleGroupResizeMove = useCallback((e) => {
    const s = groupResizeState.current;
    if (!s) return;
    const dx = (e.clientX - s.startMouseX) / viewport.z;
    const dirX = s.corner.includes('r') ? 1 : -1;
    const dirY = s.corner.includes('b') ? 1 : -1;
    const newBoxWidth = Math.max(20, s.startBox.width + dx * dirX);
    const scale = newBoxWidth / s.startBox.width;
    // Anchor on the opposite corner of the group bbox.
    const anchorX = dirX > 0 ? s.startBox.x : s.startBox.x + s.startBox.width;
    const anchorY = dirY > 0 ? s.startBox.y : s.startBox.y + s.startBox.height;
    const startMap = new Map(s.startItems.map((it) => [it.id, it]));
    setItems((prev) => prev.map((it) => {
      const start = startMap.get(it.id);
      if (!start) return it;
      const newX = anchorX + (start.x - anchorX) * scale;
      const newY = anchorY + (start.y - anchorY) * scale;
      if (start.type === 'image') {
        return {
          ...it,
          x: newX, y: newY,
          width: Math.max(20, start.width * scale),
          height: Math.max(20, start.height * scale),
        };
      }
      return {
        ...it,
        x: newX, y: newY,
        font_size: Math.max(6, Math.min(240, start.font_size * scale)),
      };
    }));
  }, [viewport.z]);

  const handleGroupResizeEnd = useCallback(async (e) => {
    const s = groupResizeState.current;
    if (!s) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    groupResizeState.current = null;
    const ids = new Set(s.startItems.map((it) => it.id));
    const toUpdate = items.filter((it) => ids.has(it.id));
    await Promise.all(toUpdate.map((it) => {
      if (it.type === 'image') {
        return window.moodmark.boards.updateItem({
          id: it.id, x: it.x, y: it.y, width: it.width, height: it.height,
        });
      }
      return window.moodmark.boards.updateItem({
        id: it.id, x: it.x, y: it.y, fontSize: it.font_size,
      });
    }));
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
  const zoomBy = useCallback((delta) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Anchor zoom on the viewport center for keyboard shortcuts.
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setViewport((v) => {
      const newZ = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z + delta));
      if (newZ === v.z) return v;
      const wx = (cx - v.x) / v.z;
      const wy = (cy - v.y) / v.z;
      return {
        z: newZ,
        x: cx - wx * newZ,
        y: cy - wy * newZ,
      };
    });
  }, []);

  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Zoom shortcuts work everywhere on the canvas, even while
      // editing text — they're modifier combos, not typeable keys.
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          zoomBy(0.2);
          return;
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          zoomBy(-0.2);
          return;
        }
        if (e.key === '0') {
          e.preventDefault();
          setViewport({ x: 0, y: 0, z: 1 });
          return;
        }
      }

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
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setTool('select');
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setTool('hand');
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
  }, [selectedIds, editingTextId, zoomBy]);

  const sortedItems = [...items].sort(
    (a, b) => (a.z_index || 0) - (b.z_index || 0),
  );

  const viewportClass = [
    styles.viewport,
    dropOver && styles.viewportDropOver,
    tool === 'text' && styles.viewportText,
    tool === 'hand' && styles.viewportHand,
    tool === 'select' && styles.viewportSelect,
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
            className={[styles.toolbarBtn, tool === 'select' && styles.toolbarBtnActive]
              .filter(Boolean).join(' ')}
            onClick={() => setTool('select')}
            title="Select (V)"
          >
            V
          </button>
          <button
            type="button"
            className={[styles.toolbarBtn, tool === 'hand' && styles.toolbarBtnActive]
              .filter(Boolean).join(' ')}
            onClick={() => setTool('hand')}
            title="Hand — pan (H)"
          >
            H
          </button>
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
                editing={editingTextId === item.id}
                onPointerDown={handleItemPointerDown}
                onPointerMove={handleItemPointerMove}
                onPointerUp={handleItemPointerUp}
                onDoubleClick={handleItemDoubleClick}
                onTextChange={handleTextChange}
                onTextCommit={handleTextCommit}
              />
            ))}
            {(() => {
              if (selectedIds.size === 0) return null;
              const sel = items.filter((it) => selectedIds.has(it.id));
              const isGroup = sel.length > 1;
              const bbox = isGroup
                ? unionBounds(sel)
                : (sel[0] ? getItemBounds(sel[0]) : null);
              if (!bbox) return null;
              const onCornerDown = isGroup
                ? (e, corner) => handleGroupResizeStart(e, corner)
                : (e, corner) => handleResizeStart(e, corner, sel[0]);
              const onCornerMove = isGroup ? handleGroupResizeMove : handleResizeMove;
              const onCornerUp   = isGroup ? handleGroupResizeEnd  : handleResizeEnd;
              return (
                <SelectionFrame
                  bounds={bbox}
                  onCornerDown={onCornerDown}
                  onCornerMove={onCornerMove}
                  onCornerUp={onCornerUp}
                />
              );
            })()}
            {marquee && (
              <div
                className={styles.marquee}
                style={{
                  transform: `translate(${marquee.x}px, ${marquee.y}px)`,
                  width: `${marquee.width}px`,
                  height: `${marquee.height}px`,
                }}
              />
            )}
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
  item, editing,
  onPointerDown, onPointerMove, onPointerUp,
  onDoubleClick, onTextChange, onTextCommit,
}) {
  if (item.type === 'image') {
    const style = {
      transform: `translate(${item.x}px, ${item.y}px)`,
      width: `${item.width}px`,
      height: `${item.height}px`,
      zIndex: item.z_index || 0,
    };
    const src = item.save_file_path ? fileUrl(item.save_file_path) : null;
    return (
      <div
        className={styles.item}
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
      </div>
    );
  }

  if (item.type === 'text') {
    return (
      <TextItem
        item={item}
        editing={editing}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onTextChange={onTextChange}
        onTextCommit={onTextCommit}
      />
    );
  }

  return null;
}

function TextItem({
  item, editing,
  onPointerDown, onPointerMove, onPointerUp,
  onDoubleClick, onTextChange, onTextCommit,
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
    </div>
  );
}

// Selection chrome: blue outline + four corner resize handles. Lives
// on a top layer in the world container so it always renders above
// items, regardless of their z-index.
function SelectionFrame({ bounds, onCornerDown, onCornerMove, onCornerUp }) {
  return (
    <div
      className={styles.selectionFrame}
      style={{
        transform: `translate(${bounds.x}px, ${bounds.y}px)`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      }}
    >
      {['tl', 'tr', 'bl', 'br'].map((corner) => (
        <div
          key={corner}
          className={[styles.resizeHandle, styles[`handle_${corner}`]].join(' ')}
          onPointerDown={(e) => onCornerDown(e, corner)}
          onPointerMove={onCornerMove}
          onPointerUp={onCornerUp}
          onPointerCancel={onCornerUp}
        />
      ))}
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
