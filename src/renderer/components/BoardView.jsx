import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  MousePointer2,
  ImagePlus,
  StickyNote,
  Type,
  Shapes,
  PenTool,
  Frame,
  Undo2,
  Redo2,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import styles from './BoardView.module.css';
import BoardCanvas from './BoardCanvas.jsx';
import { fileUrl } from '../lib/fileUrl.js';

const TOOL_ICON = { strokeWidth: 1.6, 'aria-hidden': true, size: 18 };

const TOOLS = [
  { id: 'select', label: 'Select (V)',         Icon: (p) => <MousePointer2 {...TOOL_ICON} {...p} /> },
  { id: 'image',  label: 'Image library (I)',  Icon: (p) => <ImagePlus {...TOOL_ICON} {...p} /> },
  { id: 'sticky', label: 'Sticky note (S)',    Icon: (p) => <StickyNote {...TOOL_ICON} {...p} /> },
  { id: 'text',   label: 'Text (T)',           Icon: (p) => <Type {...TOOL_ICON} {...p} /> },
  // Phase 2: shapes / pen / frame are placeholders for now. The
  // buttons render so the layout matches the final tool set; each
  // is disabled until its implementation lands.
  { id: 'shape',  label: 'Shapes — coming soon', Icon: (p) => <Shapes {...TOOL_ICON} {...p} />, disabled: true },
  { id: 'pen',    label: 'Pen — coming soon',    Icon: (p) => <PenTool {...TOOL_ICON} {...p} />, disabled: true },
  { id: 'frame',  label: 'Frame — coming soon',  Icon: (p) => <Frame {...TOOL_ICON} {...p} />, disabled: true },
];

const INITIAL_PAN = { x: 0, y: 0 };
const INITIAL_ZOOM = 1;

// Default sizes per item type (world-space pixels). Image items are
// resized to match their dropped save's intrinsic dimensions when
// available, capped to keep them readable on the canvas. Text items
// have no default size — the inner editor drives the bounding box
// until the user (or a future resize handle) commits a fixed size.
const DEFAULT_IMAGE_MAX = 360;
const DEFAULT_STICKY = { width: 180, height: 180 };
const DEFAULT_TEXT = { width: null, height: null };

// Curated font list for the text styler. Web-safe + system fonts so
// they render consistently without bundling.
const FONT_OPTIONS = [
  { label: 'Sans',       value: 'inherit' },
  { label: 'Serif',      value: '"Iowan Old Style", "Apple Garamond", Georgia, serif' },
  { label: 'Mono',       value: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' },
  { label: 'Display',    value: '"Helvetica Neue", "Inter", system-ui, sans-serif' },
];

// Curated text colors for the styler. Black + the same accent palette
// the rest of the app uses, so colours stay coherent.
const COLOR_SWATCHES = [
  '#0a0a0a', '#5a5a5a', '#9a9a9a',
  '#0a84ff', '#34c759', '#ff9500',
  '#ff3b30', '#af52de', '#ff2d55',
  '#ffd60a', '#5ac8fa', '#bf5af2',
];

// Floating styling toolbar that hovers above the selected (or
// editing) text / sticky item. Pure presentation — every change
// is dispatched up via onUpdate so persistence stays in BoardView.
//
// Curated to the controls that actually matter for moodboard text:
// font, size, bold, italic, alignment, color. Skipped from the
// reference design: lists, links, comments, lock, AI, "more" — none
// of those map onto a single-user board's text affordances.
function TextStyler({ item, rootEl, pan, zoom, onUpdate }) {
  const [showColors, setShowColors] = useState(false);
  const [pos, setPos] = useState(null);
  // Close the color popover whenever the active item changes so a
  // click on a different text doesn't leave the previous one's
  // popover orphaned somewhere on screen.
  useEffect(() => { setShowColors(false); }, [item.id]);

  // Position above the item via the DOM rect — works for fixed-size
  // and content-driven (autosize) items alike. ResizeObserver keeps
  // the toolbar tracking the item if its content grows during edit.
  useLayoutEffect(() => {
    if (!rootEl) return;
    const itemEl = document.querySelector(`[data-item-id="${item.id}"]`);
    if (!itemEl) {
      setPos(null);
      return;
    }
    const compute = () => {
      const rootRect = rootEl.getBoundingClientRect();
      const itemRect = itemEl.getBoundingClientRect();
      setPos({
        left: itemRect.left - rootRect.left + itemRect.width / 2,
        top: itemRect.top - rootRect.top - 10,
      });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(itemEl);
    return () => ro.disconnect();
  }, [item.id, rootEl, pan, zoom, item.x, item.y, item.width, item.height]);

  if (!pos) return null;
  const { left, top } = pos;

  const data = item.data || {};
  const fontFamily = data.fontFamily || 'inherit';
  const fontSize = data.fontSize || (item.type === 'sticky' ? 14 : 16);
  const align = data.align || 'left';
  const color = data.color
    || (item.type === 'sticky' ? 'rgba(0, 0, 0, 0.85)' : '#0a0a0a');

  const set = (changes) => onUpdate({ ...data, ...changes });

  return (
    <div
      className={styles.textToolbar}
      style={{ left, top, transform: 'translate(-50%, -100%)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <select
        className={styles.tt_select}
        value={fontFamily}
        onChange={(e) => set({ fontFamily: e.target.value })}
        title="Font"
      >
        {FONT_OPTIONS.map((f) => (
          <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
            {f.label}
          </option>
        ))}
      </select>

      <div className={styles.tt_size}>
        <input
          className={styles.tt_sizeInput}
          type="number"
          min="8"
          max="200"
          value={fontSize}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n) && n > 0) set({ fontSize: n });
          }}
        />
        <div className={styles.tt_sizeStep}>
          <button
            type="button"
            aria-label="Increase font size"
            onClick={() => set({ fontSize: Math.min(200, fontSize + 1) })}
          >
            <ChevronUp size={10} strokeWidth={2.25} />
          </button>
          <button
            type="button"
            aria-label="Decrease font size"
            onClick={() => set({ fontSize: Math.max(8, fontSize - 1) })}
          >
            <ChevronDown size={10} strokeWidth={2.25} />
          </button>
        </div>
      </div>

      <div className={styles.tt_sep} />

      <button
        type="button"
        className={[styles.tt_btn, data.bold && styles.tt_btn_active].filter(Boolean).join(' ')}
        onClick={() => set({ bold: !data.bold })}
        title="Bold"
      >
        <Bold size={14} strokeWidth={2.5} />
      </button>
      <button
        type="button"
        className={[styles.tt_btn, data.italic && styles.tt_btn_active].filter(Boolean).join(' ')}
        onClick={() => set({ italic: !data.italic })}
        title="Italic"
      >
        <Italic size={14} strokeWidth={2} />
      </button>

      <div className={styles.tt_sep} />

      <div className={styles.tt_group}>
        <button
          type="button"
          className={[styles.tt_btn, align === 'left' && styles.tt_btn_active].filter(Boolean).join(' ')}
          onClick={() => set({ align: 'left' })}
          title="Align left"
        >
          <AlignLeft size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={[styles.tt_btn, align === 'center' && styles.tt_btn_active].filter(Boolean).join(' ')}
          onClick={() => set({ align: 'center' })}
          title="Align center"
        >
          <AlignCenter size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={[styles.tt_btn, align === 'right' && styles.tt_btn_active].filter(Boolean).join(' ')}
          onClick={() => set({ align: 'right' })}
          title="Align right"
        >
          <AlignRight size={14} strokeWidth={1.8} />
        </button>
      </div>

      <div className={styles.tt_sep} />

      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          className={styles.tt_color}
          onClick={() => setShowColors((s) => !s)}
          title="Text color"
          style={{ '--swatch': color }}
        >
          <span className={styles.tt_colorChip} />
          <ChevronDown size={12} strokeWidth={2} className={styles.tt_colorChevron} />
        </button>
        {showColors && (
          <div className={styles.tt_colorPopover}>
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.tt_swatch}
                style={{ background: c }}
                title={c}
                onClick={() => { set({ color: c }); setShowColors(false); }}
              />
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

function nextZ(items) {
  if (items.length === 0) return 1;
  return Math.max(...items.map((i) => i.z_index ?? 0)) + 1;
}

function uuid() {
  // crypto.randomUUID is available in Electron's renderer.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback unlikely to ever fire here but keeps the function pure.
  return `b_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export default function BoardView({ boardId, saves, onRenameBoard }) {
  const [board, setBoard] = useState(null);
  const [items, setItems] = useState([]);
  const [tool, setTool] = useState('select');
  const [pan, setPan] = useState(INITIAL_PAN);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [editingItemId, setEditingItemId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const rootRef = useRef(null);

  // Load the board metadata + items when the board changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [b, its] = await Promise.all([
        window.moodmark.boards.get(boardId),
        window.moodmark.boards.getItems(boardId),
      ]);
      if (cancelled) return;
      setBoard(b);
      setItems(Array.isArray(its) ? its : []);
      setTitleDraft(b?.name || '');
      // Reset view per board so each opens at its origin.
      setPan(INITIAL_PAN);
      setZoom(INITIAL_ZOOM);
      setSelectedIds(new Set());
      setEditingItemId(null);
    })();
    return () => { cancelled = true; };
  }, [boardId]);

  // Single-item upsert helper used by add/move/edit paths. Persists
  // immediately; for batch drag-moves the canvas calls onItemsChange
  // with persist: true on mouseup so we don't hit IPC every frame.
  const persistItem = useCallback((item) => {
    return window.moodmark.boards.upsertItem({ boardId, item });
  }, [boardId]);

  const persistMany = useCallback((batch) => {
    if (!batch.length) return Promise.resolve();
    return window.moodmark.boards.bulkUpdateItems({ boardId, items: batch });
  }, [boardId]);

  const handleItemsChange = useCallback((next, { movingIds, persist } = {}) => {
    setItems(next);
    if (persist && Array.isArray(movingIds) && movingIds.length > 0) {
      const moved = next.filter((it) => movingIds.includes(it.id));
      persistMany(moved);
    }
  }, [persistMany]);

  // Drop an image from the library drawer: resolve the save record
  // for its natural dimensions, scale down to a sensible default,
  // and add a new image item centered on the drop point.
  const handleDropImage = useCallback(({ saveId, world }) => {
    const save = saves.find((s) => s.id === saveId);
    if (!save) return;
    const aspect = save.width && save.height ? save.width / save.height : 1;
    let w = save.width || DEFAULT_IMAGE_MAX;
    let h = save.height || DEFAULT_IMAGE_MAX;
    if (w > DEFAULT_IMAGE_MAX || h > DEFAULT_IMAGE_MAX) {
      if (aspect >= 1) { w = DEFAULT_IMAGE_MAX; h = w / aspect; }
      else { h = DEFAULT_IMAGE_MAX; w = h * aspect; }
    }
    const item = {
      id: uuid(),
      board_id: boardId,
      type: 'image',
      x: world.x - w / 2,
      y: world.y - h / 2,
      width: w,
      height: h,
      rotation: 0,
      z_index: nextZ(items),
      data: { saveId, fileUrl: fileUrl(save.file_path) },
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    setItems((prev) => [...prev, item]);
    setSelectedIds(new Set([item.id]));
    persistItem(item);
  }, [saves, items, boardId, persistItem]);

  // Click on the canvas with a non-select tool: spawn the tool's
  // item type at that world position. Empty clicks under unsupported
  // tools just deselect.
  const handleCanvasClick = useCallback((world, activeTool) => {
    if (activeTool !== 'sticky' && activeTool !== 'text') {
      setSelectedIds(new Set());
      return;
    }
    const size = activeTool === 'sticky' ? DEFAULT_STICKY : DEFAULT_TEXT;
    // Text items launch unsized so the inner editor drives the
    // bounding box (matching the reference: a small "Type something"
    // pill rather than a fixed-width slab). Sticky stays square.
    const w = size.width || 0;
    const h = size.height || 0;
    const item = {
      id: uuid(),
      board_id: boardId,
      type: activeTool,
      // For autosize text the spawn point becomes the top-left rather
      // than the centre — there's no width yet to centre against.
      x: world.x - w / 2,
      y: world.y - h / 2,
      width: size.width,
      height: size.height,
      rotation: 0,
      z_index: nextZ(items),
      data: { text: '' },
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    // flushSync forces React to commit the new item to the DOM
    // synchronously inside the original mousedown handler. Without
    // it, React's normal async commit lands AFTER the user's mouseup,
    // so the browser's default mouseup-over-contentEditable focus
    // step has nothing focusable to land on, and the caret never
    // takes — the user has to click again. With flushSync, the
    // contentEditable exists and is focused before mouseup fires.
    flushSync(() => {
      setItems((prev) => [...prev, item]);
      setSelectedIds(new Set([item.id]));
      setEditingItemId(item.id);
    });
    const el = document.querySelector(
      `[data-item-id="${item.id}"] [contenteditable="true"]`,
    );
    if (el) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    persistItem(item);
    // Fall back to select after placing — single-click-to-add feels
    // more natural than staying armed and accidentally laying down
    // a chain of stickies.
    setTool('select');
  }, [boardId, items, persistItem]);

  const handleCommitEdit = useCallback((itemId, text) => {
    setItems((prev) => prev.map((it) => {
      if (it.id !== itemId) return it;
      const next = { ...it, data: { ...(it.data || {}), text }, updated_at: Date.now() };
      persistItem(next);
      return next;
    }));
    setEditingItemId(null);
  }, [persistItem]);

  // Delete selected items via Delete / Backspace. Skipped while a
  // text/sticky is being edited so the editor handles the keystroke.
  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (editingItemId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size === 0) return;
        e.preventDefault();
        const ids = Array.from(selectedIds);
        setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)));
        setSelectedIds(new Set());
        window.moodmark.boards.deleteItems({ boardId, itemIds: ids });
      } else if (e.key === 'Escape') {
        // Confirm any in-progress text edit, then drop selection
        // and clear edit state so the bounding box, handles, and
        // floating styler all dismiss together.
        if (editingItemId) {
          const el = document.querySelector(
            `[data-item-id="${editingItemId}"] [contenteditable="true"]`,
          );
          if (el) el.blur();
        }
        setSelectedIds(new Set());
        setEditingItemId(null);
        setTool('select');
      } else if (e.key === 'v' || e.key === 'V') {
        setTool('select');
      } else if (e.key === 't' || e.key === 'T') {
        setTool('text');
      } else if (e.key === 's' || e.key === 'S') {
        setTool('sticky');
      } else if (e.key === 'i' || e.key === 'I') {
        setTool('image');
        setDrawerOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, boardId, editingItemId]);

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === board?.name) {
      setTitleDraft(board?.name || '');
      return;
    }
    onRenameBoard?.({ id: boardId, name: trimmed });
    setBoard((b) => (b ? { ...b, name: trimmed } : b));
  };

  const zoomReadout = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom]);

  // Active styler target: the editing text/sticky if any, else a
  // single-selected text/sticky. Anything else (image, multi-select,
  // nothing) hides the toolbar.
  const stylerItem = useMemo(() => {
    const isTextish = (it) => it && (it.type === 'text' || it.type === 'sticky');
    if (editingItemId) {
      const it = items.find((x) => x.id === editingItemId);
      return isTextish(it) ? it : null;
    }
    if (selectedIds.size === 1) {
      const id = Array.from(selectedIds)[0];
      const it = items.find((x) => x.id === id);
      return isTextish(it) ? it : null;
    }
    return null;
  }, [editingItemId, selectedIds, items]);

  const handleStyleUpdate = useCallback((nextData) => {
    if (!stylerItem) return;
    setItems((prev) => prev.map((it) => {
      if (it.id !== stylerItem.id) return it;
      const next = { ...it, data: nextData, updated_at: Date.now() };
      persistItem(next);
      return next;
    }));
  }, [stylerItem, persistItem]);

  return (
    <div ref={rootRef} className={styles.root}>
      <div className={styles.titleBar}>
        <input
          className={styles.titleInput}
          value={titleDraft}
          /* size acts as the universal fallback for browsers that
             don't honor field-sizing: content. Track the longer of
             the typed value or the placeholder so an empty title
             still has room for the placeholder text. */
          size={Math.max(8, (titleDraft || 'Untitled board').length)}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setTitleDraft(board?.name || '');
              e.currentTarget.blur();
            }
          }}
          placeholder="Untitled board"
        />
      </div>

      <div className={styles.toolbar}>
        {TOOLS.map(({ id, label, Icon, disabled }) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            className={[
              styles.toolBtn,
              tool === id && !disabled && styles.toolBtnActive,
            ].filter(Boolean).join(' ')}
            title={label}
            onClick={() => {
              if (disabled) return;
              setTool(id);
              if (id === 'image') setDrawerOpen(true);
            }}
          >
            <Icon />
          </button>
        ))}
        <div className={styles.toolDivider} />
        <button type="button" className={styles.toolBtn} title="Undo (coming soon)" disabled>
          <Undo2 {...TOOL_ICON} />
        </button>
        <button type="button" className={styles.toolBtn} title="Redo (coming soon)" disabled>
          <Redo2 {...TOOL_ICON} />
        </button>
      </div>

      <BoardCanvas
        items={items}
        saves={saves}
        pan={pan}
        zoom={zoom}
        onPanZoomChange={({ pan: p, zoom: z }) => { setPan(p); setZoom(z); }}
        selectedIds={selectedIds}
        onSelectIds={setSelectedIds}
        editingItemId={editingItemId}
        onBeginEdit={setEditingItemId}
        onCommitEdit={handleCommitEdit}
        onItemsChange={handleItemsChange}
        onCanvasClick={handleCanvasClick}
        onDropImage={handleDropImage}
        tool={tool}
      />

      {drawerOpen && (
        <div className={styles.drawer}>
          <div className={styles.drawerHeader}>
            <span className={styles.drawerTitle}>Library</span>
            <button
              type="button"
              className={styles.drawerClose}
              onClick={() => setDrawerOpen(false)}
              title="Close library"
            >
              ×
            </button>
          </div>
          <div className={styles.drawerGrid}>
            {saves.length === 0 ? (
              <div className={styles.drawerEmpty}>No saves yet</div>
            ) : (
              saves.map((s) => (
                <div
                  key={s.id}
                  className={styles.drawerThumb}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData(
                      'application/x-moodmark-board-save',
                      JSON.stringify({ saveId: s.id }),
                    );
                  }}
                  title={s.title || ''}
                >
                  <img
                    src={fileUrl(s.thumb_path || s.file_path)}
                    alt=""
                    draggable={false}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {stylerItem && (
        <TextStyler
          item={stylerItem}
          rootEl={rootRef.current}
          pan={pan}
          zoom={zoom}
          onUpdate={handleStyleUpdate}
        />
      )}

      <div className={styles.zoomReadout}>
        <button
          type="button"
          className={styles.zoomBtn}
          onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
          title="Zoom out"
        >−</button>
        <span>{zoomReadout}</span>
        <button
          type="button"
          className={styles.zoomBtn}
          onClick={() => setZoom((z) => Math.min(4, z + 0.1))}
          title="Zoom in"
        >+</button>
        <button
          type="button"
          className={styles.zoomBtn}
          onClick={() => { setPan(INITIAL_PAN); setZoom(INITIAL_ZOOM); }}
          title="Reset view"
        >⤒</button>
      </div>
    </div>
  );
}
