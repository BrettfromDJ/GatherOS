import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  MousePointer2,
  ImagePlus,
  StickyNote,
  Type,
  Shapes,
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
  ChevronLeft,
  Download,
  Clipboard,
  ArrowUpToLine,
  ArrowDownToLine,
  Trash2,
  Square,
  Circle,
  Triangle,
  Lock,
  Unlock,
  Copy,
  MoveUpRight,
  Slash,
  CornerDownRight,
  Pencil,
} from 'lucide-react';
import styles from './BoardView.module.css';
import BoardCanvas from './BoardCanvas.jsx';
import BoardLibraryDrawer from './BoardLibraryDrawer.jsx';
import ContextMenu from './ContextMenu.jsx';
import { fileUrl } from '../lib/fileUrl.js';

const TOOL_ICON = { strokeWidth: 1.6, 'aria-hidden': true, size: 18 };

const TOOLS = [
  { id: 'select', label: 'Select (V)',         Icon: (p) => <MousePointer2 {...TOOL_ICON} {...p} /> },
  { id: 'image',  label: 'Image library (I)',  Icon: (p) => <ImagePlus {...TOOL_ICON} {...p} /> },
  { id: 'sticky', label: 'Sticky note (S)',    Icon: (p) => <StickyNote {...TOOL_ICON} {...p} /> },
  { id: 'text',   label: 'Text (T)',            Icon: (p) => <Type {...TOOL_ICON} {...p} /> },
  { id: 'shape',  label: 'Shapes & lines',      Icon: (p) => <Shapes {...TOOL_ICON} {...p} /> },
  { id: 'frame',  label: 'Frame (F)',            Icon: (p) => <Frame {...TOOL_ICON} {...p} /> },
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
const DEFAULT_SHAPE = { width: 180, height: 120 };
const DEFAULT_FRAME = { width: 600, height: 400 };
const FRAME_DEFAULT_DATA = {
  title: '',
  fill: '#FFFFFF',
};
const SHAPE_DEFAULT_DATA = {
  kind: 'rect',
  text: '',
  fontSize: 14,
  align: 'center',
  fill: '#FFFFFF',
  stroke: 'rgba(0, 0, 0, 0.85)',
  strokeWidth: 2,
};
const SHAPE_FILL_SWATCHES = [
  '#FFFFFF', '#F2F2F2', '#FFE7A8',
  '#D8EFFE', '#DDF6E0', '#FBD9CE',
  '#EFD8FE', '#FFD6E5', 'transparent',
];
const SHAPE_STROKE_SWATCHES = [
  '#0a0a0a', '#5a5a5a', '#9a9a9a',
  '#0a84ff', '#34c759', '#ff9500',
  '#ff3b30', '#af52de', 'transparent',
];

// Sticky colour palette. Each entry carries the gradient stops
// used to paint the paper (top -> bottom) plus a swatch colour for
// the picker. data.color = id; defaults to 'yellow'.
const STICKY_PALETTES = {
  yellow: { top: '#FFF6BC', bottom: '#FFE988', swatch: '#FFE988' },
  pink:   { top: '#FFE0EA', bottom: '#FFC2D1', swatch: '#FFC2D1' },
  green:  { top: '#DCF1E0', bottom: '#B8E0BF', swatch: '#B8E0BF' },
  blue:   { top: '#DCEAF8', bottom: '#B8D2EE', swatch: '#B8D2EE' },
  orange: { top: '#FFE0CB', bottom: '#FFC59E', swatch: '#FFC59E' },
  purple: { top: '#EFD9FF', bottom: '#DCB4FA', swatch: '#DCB4FA' },
};
const STICKY_COLOR_IDS = ['yellow', 'pink', 'green', 'blue', 'orange', 'purple'];

// Arrow tool defaults. Arrows store every vertex in data.points
// (world coords), with at minimum 2 points (start/end). The
// wrapper's x/y/width/height carry the bounding rect with a few
// px of padding so arrowheads aren't clipped. Stroke colour reuses
// the shape stroke palette.
const ARROW_DEFAULT_DATA = {
  kind: 'arrow', // 'line' | 'arrow' (elbow is a 3-point arrow at create-time)
  points: [],
  stroke: '#0a0a0a',
  strokeWidth: 2,
};
const ARROW_BBOX_PAD = 12;
const ARROW_STROKE_WIDTHS = [1, 2, 3, 5, 8];

// Curated font list for the text styler. Web-safe + system fonts so
// they render consistently without bundling.
const FONT_OPTIONS = [
  { label: 'Sans',  value: 'inherit' },
  { label: 'Serif', value: '"Iowan Old Style", "Apple Garamond", Georgia, serif' },
  // Hard-code the mono stack — --font-mono is aliased to the
  // proportional UI font globally, so reading from it here renders
  // Mono as a sans. Menlo ships on every Mac; the rest are fallbacks.
  { label: 'Mono',  value: 'Menlo, "SF Mono", ui-monospace, SFMono-Regular, monospace' },
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
          className={styles.tt_textColor}
          onClick={() => setShowColors((s) => !s)}
          data-tooltip="Text color"
          title="Text color"
          style={{ '--swatch': color }}
        >
          {/* "A" stacked over a colored underline bar (Word-style)
              so the user can read this as "text color" at a glance,
              distinct from shape fill / stroke swatches in the same
              row. Bar tracks the current text colour via --swatch. */}
          <span className={styles.tt_textColorStack}>
            <span className={styles.tt_textColorA}>A</span>
            <span className={styles.tt_textColorBar} />
          </span>
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

      {item.type === 'shape' && (
        <ShapeControls
          item={item}
          onUpdate={onUpdate}
        />
      )}

      {item.type === 'sticky' && (
        <StickyColorPicker
          item={item}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}

// Shape-specific controls slotted at the right end of the floating
// styler. Kind swap (rect / ellipse / triangle), fill swatch, stroke
// swatch. Each swatch opens its own popover; only one can be open at
// a time so they don't stack visually.
// Sticky-specific control: paper colour. Renders a swatch trigger
// + popover with the six sticky palettes. The selected colour fills
// the trigger so the user always sees what's active.
function StickyColorPicker({ item, onUpdate }) {
  const data = item.data || {};
  const colorId = data.stickyColor || 'yellow';
  const swatch = STICKY_PALETTES[colorId]?.swatch || STICKY_PALETTES.yellow.swatch;
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [item.id]);

  return (
    <>
      <div className={styles.tt_sep} />
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          className={styles.tt_color}
          onClick={() => setOpen((s) => !s)}
          data-tooltip="Sticky color"
          title="Sticky color"
          style={{ '--swatch': swatch }}
        >
          <span className={styles.tt_colorChip} />
          <ChevronDown size={12} strokeWidth={2} className={styles.tt_colorChevron} />
        </button>
        {open && (
          <div className={styles.tt_colorPopover}>
            {STICKY_COLOR_IDS.map((id) => {
              const p = STICKY_PALETTES[id];
              return (
                <button
                  key={id}
                  type="button"
                  className={styles.tt_swatch}
                  style={{ background: p.swatch }}
                  title={id}
                  onClick={() => {
                    onUpdate({ ...data, stickyColor: id });
                    setOpen(false);
                  }}
                />
              );
            })}
          </div>
        )}
      </span>
    </>
  );
}

function ShapeControls({ item, onUpdate }) {
  const data = item.data || {};
  const kind = data.kind || 'rect';
  const fill = data.fill || '#FFFFFF';
  const stroke = data.stroke || 'rgba(0, 0, 0, 0.85)';
  const [openPicker, setOpenPicker] = useState(null); // 'fill' | 'stroke' | null
  useEffect(() => { setOpenPicker(null); }, [item.id]);

  const set = (changes) => onUpdate({ ...data, ...changes });

  const KIND_BUTTONS = [
    { id: 'rect',     Icon: Square,   label: 'Rectangle' },
    { id: 'ellipse',  Icon: Circle,   label: 'Ellipse' },
    { id: 'triangle', Icon: Triangle, label: 'Triangle' },
  ];

  return (
    <>
      <div className={styles.tt_sep} />
      <div className={styles.tt_group}>
        {KIND_BUTTONS.map(({ id, Icon, label }) => (
          <button
            key={id}
            type="button"
            className={[
              styles.tt_btn,
              kind === id && styles.tt_btn_active,
            ].filter(Boolean).join(' ')}
            data-tooltip={label}
            title={label}
            onClick={() => set({ kind: id })}
          >
            <Icon size={14} strokeWidth={1.8} />
          </button>
        ))}
      </div>

      <div className={styles.tt_sep} />

      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          className={styles.tt_color}
          onClick={() => setOpenPicker((p) => (p === 'fill' ? null : 'fill'))}
          data-tooltip="Fill color"
          title="Fill color"
          style={{ '--swatch': fill }}
        >
          <span className={styles.tt_colorChip} />
          <ChevronDown size={12} strokeWidth={2} className={styles.tt_colorChevron} />
        </button>
        {openPicker === 'fill' && (
          <div className={styles.tt_colorPopover}>
            {SHAPE_FILL_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={[
                  styles.tt_swatch,
                  c === 'transparent' && styles.tt_swatchTransparent,
                ].filter(Boolean).join(' ')}
                style={c === 'transparent' ? undefined : { background: c }}
                title={c === 'transparent' ? 'No fill' : c}
                onClick={() => { set({ fill: c }); setOpenPicker(null); }}
              />
            ))}
          </div>
        )}
      </span>

      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          className={styles.tt_color}
          onClick={() => setOpenPicker((p) => (p === 'stroke' ? null : 'stroke'))}
          data-tooltip="Stroke color"
          title="Stroke color"
          style={{ '--swatch': stroke }}
        >
          <span className={[styles.tt_colorChip, styles.tt_colorChipRing].join(' ')} />
          <ChevronDown size={12} strokeWidth={2} className={styles.tt_colorChevron} />
        </button>
        {openPicker === 'stroke' && (
          <div className={styles.tt_colorPopover}>
            {SHAPE_STROKE_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={[
                  styles.tt_swatch,
                  c === 'transparent' && styles.tt_swatchTransparent,
                ].filter(Boolean).join(' ')}
                style={c === 'transparent' ? undefined : { background: c }}
                title={c === 'transparent' ? 'No stroke' : c}
                onClick={() => { set({ stroke: c }); setOpenPicker(null); }}
              />
            ))}
          </div>
        )}
      </span>
    </>
  );
}

function nextZ(items) {
  if (items.length === 0) return 1;
  return Math.max(...items.map((i) => i.z_index ?? 0)) + 1;
}

// Combined shape + arrow tool button. Clicking the icon opens a
// vertical flyout split into two sections (shapes / lines), divided
// by a thin separator. Picking any row activates the appropriate
// tool with the corresponding kind. Active highlight follows the
// current tool + kind so the flyout always shows what's armed.
function ShapeToolButton({
  activeTool,
  shapeKind,
  arrowKind,
  onPickShape,
  onPickArrow,
  Icon,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Single ordered list with a section field; we render a divider
  // between the last 'shape' and the first 'arrow' row.
  const ROWS = [
    { section: 'shape', kind: 'rect',     Icon: Square,           label: 'Rectangle', kbd: 'R' },
    { section: 'shape', kind: 'ellipse',  Icon: Circle,           label: 'Ellipse',   kbd: 'E' },
    { section: 'shape', kind: 'triangle', Icon: Triangle,         label: 'Triangle',  kbd: 'Y' },
    { section: 'arrow', kind: 'line',     Icon: Slash,            label: 'Line',      kbd: 'L' },
    { section: 'arrow', kind: 'arrow',    Icon: MoveUpRight,      label: 'Arrow',     kbd: 'A' },
    { section: 'arrow', kind: 'elbow',    Icon: CornerDownRight,  label: 'Elbow arrow', kbd: 'B' },
  ];

  const isActive = (row) => (
    (row.section === 'shape' && activeTool === 'shape' && shapeKind === row.kind) ||
    (row.section === 'arrow' && activeTool === 'arrow' && arrowKind === row.kind)
  );

  const masterActive = activeTool === 'shape' || activeTool === 'arrow';

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className={[
          styles.toolBtn,
          masterActive && styles.toolBtnActive,
        ].filter(Boolean).join(' ')}
        title="Shapes & lines"
        onClick={() => setOpen((s) => !s)}
      >
        <Icon />
      </button>
      {open && (
        <div className={styles.shapeToolFlyout} role="menu">
          {ROWS.map((row, idx) => {
            const prev = ROWS[idx - 1];
            const showDivider = prev && prev.section !== row.section;
            return (
              <React.Fragment key={row.kind}>
                {showDivider && <div className={styles.shapeToolFlyoutSep} />}
                <button
                  type="button"
                  className={[
                    styles.shapeToolFlyoutBtn,
                    isActive(row) && styles.shapeToolFlyoutBtnActive,
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    if (row.section === 'shape') onPickShape(row.kind);
                    else onPickArrow(row.kind);
                    setOpen(false);
                  }}
                >
                  <span className={styles.shapeToolFlyoutBtnIcon}>
                    <row.Icon size={16} strokeWidth={1.8} />
                  </span>
                  <span className={styles.shapeToolFlyoutBtnLabel}>{row.label}</span>
                  <span className={styles.shapeToolFlyoutBtnKbd}>{row.kbd}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </span>
  );
}

// Floating action bar for selected arrows. Same positioning logic
// as the other styler bars; controls cover kind swap, stroke color,
// stroke width.
function ArrowActionBar({
  item,
  rootEl,
  pan,
  zoom,
  onUpdate,
  onBringToFront,
  onSendToBack,
  onRemoveFromBoard,
}) {
  const [pos, setPos] = useState(null);
  const [openPicker, setOpenPicker] = useState(null); // 'color' | 'width' | null
  useEffect(() => { setOpenPicker(null); }, [item.id]);
  useLayoutEffect(() => {
    if (!rootEl) return;
    const itemEl = document.querySelector(`[data-item-id="${item.id}"]`);
    if (!itemEl) { setPos(null); return; }
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

  const data = item.data || {};
  const stroke = data.stroke || '#0a0a0a';
  const strokeWidth = data.strokeWidth || 2;

  const set = (changes) => onUpdate({ ...data, ...changes });

  return (
    <div
      className={styles.textToolbar}
      style={{ left: pos.left, top: pos.top, transform: 'translate(-50%, -100%)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          className={styles.tt_color}
          onClick={() => setOpenPicker((p) => (p === 'color' ? null : 'color'))}
          data-tooltip="Stroke color"
          title="Stroke color"
          style={{ '--swatch': stroke }}
        >
          <span className={styles.tt_colorChip} />
          <ChevronDown size={12} strokeWidth={2} className={styles.tt_colorChevron} />
        </button>
        {openPicker === 'color' && (
          <div className={styles.tt_colorPopover}>
            {SHAPE_STROKE_SWATCHES.filter((c) => c !== 'transparent').map((c) => (
              <button
                key={c}
                type="button"
                className={styles.tt_swatch}
                style={{ background: c }}
                title={c}
                onClick={() => { set({ stroke: c }); setOpenPicker(null); }}
              />
            ))}
          </div>
        )}
      </span>

      <div className={styles.tt_sep} />

      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          className={styles.tt_btn}
          data-tooltip="Stroke width"
          title="Stroke width"
          onClick={() => setOpenPicker((p) => (p === 'width' ? null : 'width'))}
        >
          <span className={styles.tt_widthIndicator} style={{ height: Math.min(8, strokeWidth) }} />
        </button>
        {openPicker === 'width' && (
          <div className={[styles.tt_colorPopover, styles.tt_widthPopover].join(' ')}>
            {ARROW_STROKE_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className={[
                  styles.tt_widthOption,
                  strokeWidth === w && styles.tt_widthOptionActive,
                ].filter(Boolean).join(' ')}
                title={`${w}px`}
                onClick={() => { set({ strokeWidth: w }); setOpenPicker(null); }}
              >
                <span style={{ height: w }} />
              </button>
            ))}
          </div>
        )}
      </span>

      <div className={styles.tt_sep} />

      <button
        type="button"
        className={styles.tt_btn}
        data-tooltip="Bring to front"
        title="Bring to front"
        onClick={onBringToFront}
      >
        <ArrowUpToLine size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className={styles.tt_btn}
        data-tooltip="Send to back"
        title="Send to back"
        onClick={onSendToBack}
      >
        <ArrowDownToLine size={14} strokeWidth={1.8} />
      </button>

      <div className={styles.tt_sep} />

      <button
        type="button"
        className={styles.tt_btn}
        data-tooltip="Remove from board"
        title="Remove from board"
        onClick={onRemoveFromBoard}
      >
        <Trash2 size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

// Floating action bar for selected image items. Mirrors TextStyler's
// positioning logic so the bar tracks the item's screen rect via a
// useLayoutEffect + ResizeObserver. Buttons cover z-order (bring-to-
// front / send-to-back), library affordances (Download, Copy image),
// and removal — Remove-from-board keeps the underlying save in the
// library; trashing the underlying save itself happens elsewhere.
function ImageActionBar({
  item,
  rootEl,
  pan,
  zoom,
  onBringToFront,
  onSendToBack,
  onDownload,
  onCopyImage,
  onToggleLock,
  onRemoveFromBoard,
}) {
  const [pos, setPos] = useState(null);
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

  return (
    <div
      className={styles.textToolbar}
      style={{ left: pos.left, top: pos.top, transform: 'translate(-50%, -100%)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={styles.tt_btn}
        data-tooltip="Download"
        title="Download"
        onClick={onDownload}
      >
        <Download size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className={styles.tt_btn}
        data-tooltip="Copy image"
        title="Copy image"
        onClick={onCopyImage}
      >
        <Clipboard size={14} strokeWidth={1.8} />
      </button>
      <div className={styles.tt_sep} />
      <button
        type="button"
        className={styles.tt_btn}
        data-tooltip="Bring to front"
        title="Bring to front"
        onClick={onBringToFront}
      >
        <ArrowUpToLine size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className={styles.tt_btn}
        data-tooltip="Send to back"
        title="Send to back"
        onClick={onSendToBack}
      >
        <ArrowDownToLine size={14} strokeWidth={1.8} />
      </button>
      <div className={styles.tt_sep} />
      <button
        type="button"
        className={`${styles.tt_btn} ${item.data?.locked ? styles.tt_btn_active : ''}`}
        data-tooltip={item.data?.locked ? 'Unlock' : 'Lock'}
        aria-label={item.data?.locked ? 'Unlock' : 'Lock'}
        aria-pressed={!!item.data?.locked}
        onClick={onToggleLock}
      >
        {item.data?.locked
          ? <Lock size={14} strokeWidth={1.8} />
          : <Unlock size={14} strokeWidth={1.8} />}
      </button>
      <div className={styles.tt_sep} />
      <button
        type="button"
        className={styles.tt_btn}
        data-tooltip="Remove from board"
        title="Remove from board"
        onClick={onRemoveFromBoard}
      >
        <Trash2 size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

function uuid() {
  // crypto.randomUUID is available in Electron's renderer.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback unlikely to ever fire here but keeps the function pure.
  return `b_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export default function BoardView({
  boardId,
  saves,
  collections = [],
  onRenameBoard,
  onExit,
  onShowToast,
  onSetAppDragging,
  onLibraryReload,
}) {
  const [board, setBoard] = useState(null);
  const [items, setItems] = useState([]);

  // Tell the BoardLibraryDrawer (and any other listener) whenever the
  // board's items change, so the "in this space" badge on the
  // drawer's thumbs can refresh without polling.
  useEffect(() => {
    if (!boardId) return;
    window.dispatchEvent(new CustomEvent('moodmark:board-items-changed', {
      detail: { boardId },
    }));
  }, [boardId, items]);
  const [tool, setTool] = useState('select');
  // Active shape kind for the shape tool. Persists across multiple
  // spawns so the user can place several rectangles in a row without
  // re-picking each time. Swapped from the floating shape styler.
  const [shapeKind, setShapeKind] = useState('rect');
  // Active arrow kind, same idea — line / arrow / elbow.
  const [arrowKind, setArrowKind] = useState('arrow');
  const [pan, setPan] = useState(INITIAL_PAN);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  // Ref filled by BoardCanvas via the new ref prop below — gives us
  // the canvas DOM rect for the PNG capture region.
  const canvasNodeRef = useRef(null);

  // Both export paths flip body[data-board-print] before sampling
  // the page so the print-mode CSS rules can hide the board's
  // chrome (left tool rail, title pill, drawer, back button, etc.)
  // while leaving the canvas and its items visible. Two animation
  // frames is enough for the new layout to settle.
  const withPrintMode = useCallback(async (run) => {
    document.body.dataset.boardPrint = 'true';
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    try {
      await run();
    } finally {
      delete document.body.dataset.boardPrint;
    }
  }, []);

  const exportBoardPng = useCallback(async () => {
    if (exporting) return;
    const el = canvasNodeRef.current;
    if (!el) return;
    setExporting(true);
    try {
      await withPrintMode(async () => {
        // Re-measure inside the print-mode pass so the rect reflects
        // the post-hide layout. capturePage samples whatever's
        // currently painted, so chrome that was visible at click time
        // would otherwise leak into the PNG.
        const r = el.getBoundingClientRect();
        await window.moodmark.boards.exportPng({
          rect: { x: r.left, y: r.top, width: r.width, height: r.height },
          defaultName: `${(board?.name || 'board').replace(/[/\\?*:|"<>]/g, '_')}.png`,
        });
      });
    } finally {
      setExporting(false);
    }
  }, [exporting, board, withPrintMode]);

  const [editingItemId, setEditingItemId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const titleInputRef = useRef(null);
  const rootRef = useRef(null);

  // Drop any items whose underlying save was just trashed. Trash
  // also deletes the corresponding board_items rows server-side, so
  // this keeps the local UI in sync without needing a full reload.
  useEffect(() => {
    return window.moodmark.on('save:deleted', ({ ids }) => {
      if (!Array.isArray(ids) || ids.length === 0) return;
      const dead = new Set(ids);
      setItems((prev) => prev.filter((it) => {
        if (it.type !== 'image') return true;
        return !dead.has(it.data?.saveId);
      }));
      setSelectedIds((prev) => {
        const next = new Set();
        for (const id of prev) {
          const it = items.find((x) => x.id === id);
          if (!it || it.type !== 'image' || !dead.has(it.data?.saveId)) {
            next.add(id);
          }
        }
        return next;
      });
    });
    // intentionally not including `items` — listener uses live state
    // via setters and stale-closure reads through `items` (only used
    // for selection cleanup, where slight staleness is fine).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const list = Array.isArray(its) ? its : [];
      setItems(list);
      setTitleDraft(b?.name || '');
      setZoom(INITIAL_ZOOM);
      setSelectedIds(new Set());
      setEditingItemId(null);

      // Auto-centre the viewport on the items' bounding box so newly-
      // opened boards (especially "Open as space" results, which lay
      // items out around the world origin) appear with content
      // already in view. requestAnimationFrame so canvasNodeRef has
      // been populated by the just-rendered <BoardCanvas>.
      if (list.length === 0) {
        setPan(INITIAL_PAN);
        return;
      }
      requestAnimationFrame(() => {
        if (cancelled) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const it of list) {
          const x = it.x || 0;
          const y = it.y || 0;
          const w = it.width || 0;
          const h = it.height || 0;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x + w > maxX) maxX = x + w;
          if (y + h > maxY) maxY = y + h;
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const el = canvasNodeRef.current;
        const rect = el ? el.getBoundingClientRect() : { width: 1200, height: 800 };
        setPan({
          x: rect.width / 2 - cx,
          y: rect.height / 2 - cy,
        });
      });
    })();
    return () => { cancelled = true; };
  }, [boardId]);

  // ── Clipboard + history state ────────────────────────────────
  // Internal clipboard + ⌘Z/⌘⇧Z snapshot stacks live up here so
  // every other handler (drop, click-spawn, style update, drag end,
  // delete, etc.) can call pushHistory() before mutating items.
  const [clipboard, setClipboard] = useState(null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  // Bumped after every push/pop so the toolbar enable/disable
  // state stays in sync with the (ref-based) stacks.
  const [historyVer, setHistoryVer] = useState(0);

  const pushHistory = useCallback(() => {
    const snap = items.map((it) => ({ ...it, data: { ...(it.data || {}) } }));
    undoStack.current.push(snap);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setHistoryVer((v) => v + 1);
  }, [items]);

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

  // First mousemove of a drag/resize hasn't snapshotted the BEFORE
  // state yet — use a flag to push history exactly once per gesture
  // (the canvas calls onItemsChange repeatedly during the drag, but
  // only the very first call needs to record the pre-move snapshot).
  const movingGestureRef = useRef(false);
  const handleItemsChange = useCallback((next, { movingIds, persist } = {}) => {
    if (Array.isArray(movingIds) && movingIds.length > 0 && !persist && !movingGestureRef.current) {
      // Snapshot from `items` (the pre-mousemove state) not `next`.
      const snap = items.map((it) => ({ ...it, data: { ...(it.data || {}) } }));
      undoStack.current.push(snap);
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
      setHistoryVer((v) => v + 1);
      movingGestureRef.current = true;
    }
    setItems(next);
    if (persist && Array.isArray(movingIds) && movingIds.length > 0) {
      const moved = next.filter((it) => movingIds.includes(it.id));
      persistMany(moved);
      movingGestureRef.current = false;
    }
  }, [items, persistMany]);

  // Drop an image onto the canvas. Accepts either:
  //   - { saveId, world }     — internal drag from the library
  //                              drawer or the masonry grid; the
  //                              save is already in the library.
  //   - { saveRecord, world } — external file/URL drop the canvas
  //                              just routed through saves.dropFile
  //                              / saves.dropUrl, so the live saves
  //                              list might not have it yet.
  // Either way we resolve to a save record, derive a sensible
  // default size from its intrinsic dimensions, and spawn an image
  // item centered on the drop point.
  const handleDropImage = useCallback(({ saveId, saveRecord, world }) => {
    const save = saveRecord || saves.find((s) => s.id === saveId);
    if (!save?.id) return;
    pushHistory();
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
      data: {
        // save.id covers both branches: the internal saveId path
        // and the saveRecord path (external file/URL drop).
        saveId: save.id,
        fileUrl: fileUrl(save.file_path),
        // Stash the source image's natural dimensions so the
        // wrapper can always lock to its aspect ratio even if the
        // referenced save is later deleted from the library.
        naturalWidth: save.width || null,
        naturalHeight: save.height || null,
      },
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    setItems((prev) => [...prev, item]);
    setSelectedIds(new Set([item.id]));
    persistItem(item);
  }, [saves, items, boardId, persistItem, pushHistory]);

  // Listen for the global "add saves to this board" event fired by
  // the BoardLibraryDrawer when the user clicks a thumb to drop it
  // onto the canvas. When the active boardId matches, drop each save
  // onto the viewport's current world centre with a small wrapping
  // offset so
  // multiple drops don't stack on the same point.
  useEffect(() => {
    function onAddSaves(e) {
      const { boardId: targetId, ids } = e.detail || {};
      if (targetId !== boardId || !Array.isArray(ids) || ids.length === 0) return;
      const el = canvasNodeRef.current;
      const rect = el ? el.getBoundingClientRect() : { width: 800, height: 600 };
      const centerWorld = {
        x: (rect.width / 2 - pan.x) / zoom,
        y: (rect.height / 2 - pan.y) / zoom,
      };
      const cols = Math.min(ids.length, 5);
      const cell = 240;
      const gap = 24;
      const totalW = cols * cell + (cols - 1) * gap;
      ids.forEach((saveId, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const dx = col * (cell + gap) - totalW / 2 + cell / 2;
        const dy = row * (cell + gap);
        handleDropImage({
          saveId,
          world: { x: centerWorld.x + dx, y: centerWorld.y + dy },
        });
      });
    }
    window.addEventListener('moodmark:add-saves-to-board', onAddSaves);
    return () => window.removeEventListener('moodmark:add-saves-to-board', onAddSaves);
  }, [boardId, pan, zoom, handleDropImage]);

  // ── Undo / redo ──────────────────────────────────────────────
  // Apply a snapshot to the items state and persist the diff: any
  // items present in the snapshot are upserted; any items currently
  // on the board but missing from the snapshot are deleted.
  const applySnapshot = useCallback(async (snapshot) => {
    const snapIds = new Set(snapshot.map((it) => it.id));
    const currentIds = items.map((it) => it.id);
    const toDelete = currentIds.filter((id) => !snapIds.has(id));
    setItems(snapshot);
    setSelectedIds(new Set());
    if (toDelete.length > 0) {
      await window.moodmark.boards.deleteItems({ boardId, itemIds: toDelete });
    }
    if (snapshot.length > 0) {
      await persistMany(snapshot);
    }
  }, [items, boardId, persistMany]);

  const handleUndo = useCallback(async () => {
    if (undoStack.current.length === 0) return;
    const cur = items.map((it) => ({ ...it, data: { ...(it.data || {}) } }));
    redoStack.current.push(cur);
    const prev = undoStack.current.pop();
    setHistoryVer((v) => v + 1);
    await applySnapshot(prev);
  }, [items, applySnapshot]);

  const handleRedo = useCallback(async () => {
    if (redoStack.current.length === 0) return;
    const cur = items.map((it) => ({ ...it, data: { ...(it.data || {}) } }));
    undoStack.current.push(cur);
    const next = redoStack.current.pop();
    setHistoryVer((v) => v + 1);
    await applySnapshot(next);
  }, [items, applySnapshot]);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;
  // Force re-renders for the toolbar enabled state when refs change.
  void historyVer;

  // ── Copy / paste / duplicate / select-all ────────────────────
  const handleCopy = useCallback(() => {
    if (selectedIds.size === 0) return;
    const copied = items
      .filter((it) => selectedIds.has(it.id))
      .map((it) => ({ ...it, data: { ...(it.data || {}) } }));
    setClipboard(copied);
  }, [items, selectedIds]);

  // Paste flow: prefer the internal board clipboard so cmd-c/cmd-v
  // duplicates whatever the user just copied (offset by 24px so it
  // doesn't pile under the original). If the internal clipboard is
  // empty, fall back to the system clipboard — pull the first image
  // MIME type, save to library via dropFile, and spawn on the board.
  const handlePaste = useCallback(async () => {
    if (clipboard && clipboard.length > 0) {
      pushHistory();
      const OFFSET = 24;
      const newIds = [];
      const dupes = clipboard.map((it) => {
        const id = uuid();
        newIds.push(id);
        return {
          ...it,
          id,
          board_id: boardId,
          x: (it.x || 0) + OFFSET,
          y: (it.y || 0) + OFFSET,
          z_index: nextZ(items),
          created_at: Date.now(),
          updated_at: Date.now(),
        };
      });
      setItems((prev) => [...prev, ...dupes]);
      setSelectedIds(new Set(newIds));
      persistMany(dupes);
      // Cascade subsequent pastes so two cmd-V in a row chain
      // instead of stacking on top of each other.
      setClipboard(dupes.map((it) => ({ ...it, data: { ...(it.data || {}) } })));
      return;
    }
    if (!navigator.clipboard?.read) return;
    try {
      const ciList = await navigator.clipboard.read();
      for (const ci of ciList) {
        for (const type of ci.types) {
          if (!type.startsWith('image/')) continue;
          const blob = await ci.getType(type);
          const ext = type.split('/')[1] || 'png';
          const file = new File([blob], `paste-${Date.now()}.${ext}`, { type });
          const record = await window.moodmark.saves.dropFile(file);
          if (record?.id) {
            pushHistory();
            handleDropImage({ saveRecord: record, world: { x: 0, y: 0 } });
            onShowToast?.('Pasted from clipboard');
            return;
          }
        }
      }
    } catch (err) {
      console.error('System clipboard paste failed:', err);
    }
  }, [clipboard, items, boardId, persistMany, pushHistory, handleDropImage, onShowToast]);

  const handleDuplicate = useCallback(() => {
    if (selectedIds.size === 0) return;
    pushHistory();
    const OFFSET = 24;
    const newIds = [];
    const dupes = items
      .filter((it) => selectedIds.has(it.id))
      .map((it) => {
        const id = uuid();
        newIds.push(id);
        return {
          ...it,
          id,
          board_id: boardId,
          x: (it.x || 0) + OFFSET,
          y: (it.y || 0) + OFFSET,
          z_index: nextZ(items),
          created_at: Date.now(),
          updated_at: Date.now(),
        };
      });
    setItems((prev) => [...prev, ...dupes]);
    setSelectedIds(new Set(newIds));
    persistMany(dupes);
  }, [items, selectedIds, boardId, persistMany, pushHistory]);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((it) => it.id)));
  }, [items]);

  // Drag-to-create: the canvas dispatches start + end world coords
  // when the user finishes drawing an arrow. Build the polyline
  // (line/arrow = 2 points; elbow = 3 points with auto-routed
  // corner), compute the bbox, and persist.
  const handleArrowCreate = useCallback(({ start, end }) => {
    pushHistory();
    let points;
    let renderKind;
    if (arrowKind === 'elbow') {
      // Auto-routed corner: horizontal first, then vertical. Once
      // placed, the arrow stores three points and behaves like any
      // other polyline arrow (vertex/midpoint dragging works).
      points = [
        { x: start.x, y: start.y },
        { x: end.x, y: start.y },
        { x: end.x, y: end.y },
      ];
      renderKind = 'arrow';
    } else {
      points = [
        { x: start.x, y: start.y },
        { x: end.x, y: end.y },
      ];
      renderKind = arrowKind; // 'line' | 'arrow'
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs) - ARROW_BBOX_PAD;
    const minY = Math.min(...ys) - ARROW_BBOX_PAD;
    const maxX = Math.max(...xs) + ARROW_BBOX_PAD;
    const maxY = Math.max(...ys) + ARROW_BBOX_PAD;
    const item = {
      id: uuid(),
      board_id: boardId,
      type: 'arrow',
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      rotation: 0,
      z_index: nextZ(items),
      data: {
        ...ARROW_DEFAULT_DATA,
        kind: renderKind,
        points,
      },
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    setItems((prev) => [...prev, item]);
    setSelectedIds(new Set([item.id]));
    persistItem(item);
    setTool('select');
  }, [arrowKind, items, boardId, persistItem, pushHistory]);

  // Frame creation from the canvas drag-to-draw gesture. If the user
  // dragged a meaningful distance we honor those bounds; if they
  // just clicked we drop a default-sized frame centered on the
  // click point.
  const handleFrameCreate = useCallback(({ start, end }) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const MIN_DRAG = 6;
    let x;
    let y;
    let width;
    let height;
    if (Math.hypot(dx, dy) < MIN_DRAG) {
      width = DEFAULT_FRAME.width;
      height = DEFAULT_FRAME.height;
      x = start.x - width / 2;
      y = start.y - height / 2;
    } else {
      x = Math.min(start.x, end.x);
      y = Math.min(start.y, end.y);
      width = Math.abs(dx);
      height = Math.abs(dy);
    }
    pushHistory();
    const frameCount = items.filter((it) => it.type === 'frame').length + 1;
    const item = {
      id: uuid(),
      board_id: boardId,
      type: 'frame',
      x,
      y,
      width,
      height,
      rotation: 0,
      z_index: nextZ(items),
      data: { ...FRAME_DEFAULT_DATA, title: `Frame ${frameCount}` },
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    setItems((prev) => [...prev, item]);
    setSelectedIds(new Set([item.id]));
    persistItem(item);
    setTool('select');
  }, [items, boardId, persistItem, pushHistory]);

  // Click on the canvas with a non-select tool: spawn the tool's
  // item type at that world position. Empty clicks under unsupported
  // tools just deselect.
  const handleCanvasClick = useCallback((world, activeTool) => {
    if (activeTool !== 'sticky' && activeTool !== 'text' && activeTool !== 'shape') {
      setSelectedIds(new Set());
      return;
    }
    pushHistory();
    const size = activeTool === 'sticky'
      ? DEFAULT_STICKY
      : activeTool === 'shape'
        ? (shapeKind === 'ellipse' ? { width: 140, height: 140 } : DEFAULT_SHAPE)
        : DEFAULT_TEXT;
    // Text items launch unsized so the inner editor drives the
    // bounding box (matching the reference: a small "Type something"
    // pill rather than a fixed-width slab). Sticky and shape get
    // their default sized rectangles.
    const w = size.width || 0;
    const h = size.height || 0;
    const data = activeTool === 'shape'
      ? { ...SHAPE_DEFAULT_DATA, kind: shapeKind }
      : { text: '' };
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
      data,
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
  }, [boardId, items, persistItem, pushHistory, shapeKind]);

  const handleCommitEdit = useCallback((itemId, text) => {
    setItems((prev) => {
      const it = prev.find((x) => x.id === itemId);
      if (!it) return prev;
      // Frames store the editable string in data.title; everything
      // else uses data.text. Pick the right field per item type.
      const field = it.type === 'frame' ? 'title' : 'text';
      // Only push history if the value actually changed.
      if ((it.data?.[field] || '') !== text) {
        const snap = prev.map((p) => ({ ...p, data: { ...(p.data || {}) } }));
        undoStack.current.push(snap);
        if (undoStack.current.length > 100) undoStack.current.shift();
        redoStack.current = [];
        setHistoryVer((v) => v + 1);
      }
      return prev.map((p) => {
        if (p.id !== itemId) return p;
        const next = { ...p, data: { ...(p.data || {}), [field]: text }, updated_at: Date.now() };
        persistItem(next);
        return next;
      });
    });
    setEditingItemId(null);
  }, [persistItem]);

  // Keyboard shortcuts. Skipped while a text/sticky is being edited
  // so typing into the contentEditable doesn't trigger tool changes,
  // and skipped while focus is in any other input/textarea so the
  // user can type into the title pill, library search, etc.
  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (editingItemId) return;

      const cmd = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      // ⌘Z — undo, ⌘⇧Z — redo
      if (cmd && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      // ⌘C / ⌘V / ⌘X / ⌘D / ⌘A
      if (cmd && k === 'c') { e.preventDefault(); handleCopy(); return; }
      if (cmd && k === 'v') { e.preventDefault(); handlePaste(); return; }
      if (cmd && k === 'd') {
        e.preventDefault();
        handleDuplicate();
        return;
      }
      if (cmd && k === 'a') { e.preventDefault(); handleSelectAll(); return; }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size === 0) return;
        e.preventDefault();
        pushHistory();
        const ids = Array.from(selectedIds);
        setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)));
        setSelectedIds(new Set());
        window.moodmark.boards.deleteItems({ boardId, itemIds: ids });
        // Drop back to select so the toolbar doesn't keep the
        // previous draw tool (e.g. frame) lit up after the delete.
        setTool('select');
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
      } else if (!cmd && (k === 'v')) {
        setTool('select');
      } else if (!cmd && (k === 's')) {
        setTool('sticky');
      } else if (!cmd && (k === 'i')) {
        setTool('image');
        setDrawerOpen(true);
      }
      // Shape + arrow kind shortcuts — each switches to the matching
      // tool *and* sets the kind in one keystroke, so the next
      // canvas click drops that shape / arrow.
      else if (!cmd && (k === 'r')) {
        setTool('shape');
        setShapeKind('rect');
      } else if (!cmd && (k === 'e')) {
        setTool('shape');
        setShapeKind('ellipse');
      } else if (!cmd && (k === 't')) {
        setTool('text');
      } else if (!cmd && (k === 'y')) {
        setTool('shape');
        setShapeKind('triangle');
      } else if (!cmd && (k === 'a')) {
        setTool('arrow');
        setArrowKind('arrow');
      } else if (!cmd && (k === 'l')) {
        setTool('arrow');
        setArrowKind('line');
      } else if (!cmd && (k === 'b')) {
        // B for "bend" — elbow arrow.
        setTool('arrow');
        setArrowKind('elbow');
      } else if (!cmd && (k === 'f')) {
        setTool('frame');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selectedIds, boardId, editingItemId, tool,
    handleUndo, handleRedo, handleCopy, handlePaste, handleDuplicate, handleSelectAll, pushHistory,
  ]);

  const commitTitle = () => {
    setTitleEditing(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === board?.name) {
      setTitleDraft(board?.name || '');
      return;
    }
    onRenameBoard?.({ id: boardId, name: trimmed });
    setBoard((b) => (b ? { ...b, name: trimmed } : b));
  };

  const beginTitleEdit = () => {
    setTitleDraft(board?.name || '');
    setTitleEditing(true);
    // Defer focus to next tick so the input has rendered.
    setTimeout(() => {
      const el = titleInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }, 0);
  };

  const zoomReadout = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom]);

  // Active styler target: the editing text/sticky if any, else a
  // single-selected text/sticky. Anything else (image, multi-select,
  // nothing) hides the toolbar.
  const stylerItem = useMemo(() => {
    const isTextish = (it) =>
      it && (it.type === 'text' || it.type === 'sticky' || it.type === 'shape');
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
    pushHistory();
    setItems((prev) => prev.map((it) => {
      if (it.id !== stylerItem.id) return it;
      const next = { ...it, data: nextData, updated_at: Date.now() };
      persistItem(next);
      return next;
    }));
  }, [stylerItem, persistItem, pushHistory]);

  // Single-selected image item drives the floating image action bar.
  const imageBarItem = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    const id = Array.from(selectedIds)[0];
    const it = items.find((x) => x.id === id);
    return it?.type === 'image' ? it : null;
  }, [selectedIds, items]);

  // Single-selected arrow drives the floating arrow action bar.
  const arrowBarItem = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    const id = Array.from(selectedIds)[0];
    const it = items.find((x) => x.id === id);
    return it?.type === 'arrow' ? it : null;
  }, [selectedIds, items]);

  const handleArrowUpdate = useCallback((nextData) => {
    if (!arrowBarItem) return;
    pushHistory();
    setItems((prev) => prev.map((it) => {
      if (it.id !== arrowBarItem.id) return it;
      const next = { ...it, data: nextData, updated_at: Date.now() };
      persistItem(next);
      return next;
    }));
  }, [arrowBarItem, persistItem, pushHistory]);

  const handleArrowBringToFront = useCallback(() => {
    if (!arrowBarItem) return;
    pushHistory();
    const maxZ = items.reduce((m, it) => Math.max(m, it.z_index ?? 0), 0);
    const next = { ...arrowBarItem, z_index: maxZ + 1, updated_at: Date.now() };
    setItems((prev) => prev.map((it) => (it.id === arrowBarItem.id ? next : it)));
    persistItem(next);
  }, [arrowBarItem, items, persistItem, pushHistory]);

  const handleArrowSendToBack = useCallback(() => {
    if (!arrowBarItem) return;
    pushHistory();
    const minZ = items.reduce((m, it) => Math.min(m, it.z_index ?? 0), 0);
    const next = { ...arrowBarItem, z_index: minZ - 1, updated_at: Date.now() };
    setItems((prev) => prev.map((it) => (it.id === arrowBarItem.id ? next : it)));
    persistItem(next);
  }, [arrowBarItem, items, persistItem, pushHistory]);

  const handleArrowRemove = useCallback(() => {
    if (!arrowBarItem) return;
    pushHistory();
    const id = arrowBarItem.id;
    setItems((prev) => prev.filter((it) => it.id !== id));
    setSelectedIds(new Set());
    window.moodmark.boards.deleteItem({ boardId, itemId: id });
  }, [arrowBarItem, boardId, pushHistory]);

  const handleBringToFront = useCallback(() => {
    if (!imageBarItem) return;
    pushHistory();
    const maxZ = items.reduce((m, it) => Math.max(m, it.z_index ?? 0), 0);
    const next = { ...imageBarItem, z_index: maxZ + 1, updated_at: Date.now() };
    setItems((prev) => prev.map((it) => (it.id === imageBarItem.id ? next : it)));
    persistItem(next);
  }, [imageBarItem, items, persistItem, pushHistory]);

  const handleSendToBack = useCallback(() => {
    if (!imageBarItem) return;
    pushHistory();
    const minZ = items.reduce((m, it) => Math.min(m, it.z_index ?? 0), 0);
    const next = { ...imageBarItem, z_index: minZ - 1, updated_at: Date.now() };
    setItems((prev) => prev.map((it) => (it.id === imageBarItem.id ? next : it)));
    persistItem(next);
  }, [imageBarItem, items, persistItem, pushHistory]);

  const handleDownloadItem = useCallback(() => {
    const save = saves.find((s) => s.id === imageBarItem?.data?.saveId);
    if (!save?.file_path) return;
    const ext = (save.file_path.split('.').pop() || 'png').toLowerCase();
    const name = save.title
      ? `${save.title}.${ext}`
      : `gatheros-${save.id.slice(0, 8)}.${ext}`;
    window.moodmark.image.export(save.file_path, name);
  }, [imageBarItem, saves]);

  const handleCopyImageItem = useCallback(async () => {
    const save = saves.find((s) => s.id === imageBarItem?.data?.saveId);
    if (!save?.file_path) return;
    const result = await window.moodmark.image.copyToClipboard(save.file_path);
    onShowToast?.(result?.ok ? 'Copied to clipboard' : 'Could not copy image');
  }, [imageBarItem, saves, onShowToast]);

  const handleRemoveFromBoard = useCallback(() => {
    if (!imageBarItem) return;
    pushHistory();
    const id = imageBarItem.id;
    setItems((prev) => prev.filter((it) => it.id !== id));
    setSelectedIds(new Set());
    window.moodmark.boards.deleteItem({ boardId, itemId: id });
  }, [imageBarItem, boardId, pushHistory]);

  // ── Context menu (right-click) ───────────────────────────────
  // Held as { x, y, items } when open. Builder pulls from the
  // current selection so the menu acts on the full set even when
  // the user only right-clicked one of them.
  const [boardCtx, setBoardCtx] = useState(null);

  const removeIdsFromBoard = useCallback((ids) => {
    if (!ids.length) return;
    pushHistory();
    setItems((prev) => prev.filter((it) => !ids.includes(it.id)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    window.moodmark.boards.deleteItems({ boardId, itemIds: ids });
    setTool('select');
  }, [boardId, pushHistory]);

  const setLockOnIds = useCallback((ids, locked) => {
    if (!ids.length) return;
    pushHistory();
    setItems((prev) => prev.map((it) => {
      if (!ids.includes(it.id)) return it;
      const next = { ...it, data: { ...(it.data || {}), locked }, updated_at: Date.now() };
      persistItem(next);
      return next;
    }));
  }, [persistItem, pushHistory]);

  const buildBoardCtxItems = useCallback((target) => {
    // If the right-clicked item is in the current selection, the
    // menu acts on every selected item; otherwise just on the one.
    const targetIds = selectedIds.has(target.id)
      ? Array.from(selectedIds)
      : [target.id];
    const isMulti = targetIds.length > 1;
    const suffix = isMulti ? ` (${targetIds.length})` : '';
    const targets = items.filter((it) => targetIds.includes(it.id));
    const allLocked = targets.every((it) => it.data?.locked);
    const anyShape = targets.some((it) => it.type === 'shape');

    const out = [];

    out.push({
      label: `Copy${suffix}`,
      icon: <Copy size={14} strokeWidth={1.7} />,
      onClick: () => {
        const copied = targets.map((it) => ({ ...it, data: { ...(it.data || {}) } }));
        setClipboard(copied);
      },
    });
    out.push({
      label: `Duplicate${suffix}`,
      icon: <Copy size={14} strokeWidth={1.7} />,
      onClick: () => {
        // Same logic as ⌘D, scoped to targetIds rather than the
        // current selection so a right-click on an unselected item
        // still does the right thing.
        pushHistory();
        const OFFSET = 24;
        const newIds = [];
        const dupes = targets.map((it) => {
          const id = uuid();
          newIds.push(id);
          return {
            ...it,
            id,
            board_id: boardId,
            x: (it.x || 0) + OFFSET,
            y: (it.y || 0) + OFFSET,
            z_index: nextZ(items),
            created_at: Date.now(),
            updated_at: Date.now(),
          };
        });
        setItems((prev) => [...prev, ...dupes]);
        setSelectedIds(new Set(newIds));
        persistMany(dupes);
      },
    });

    out.push({ type: 'separator' });

    out.push({
      label: `Bring to front${suffix}`,
      icon: <ArrowUpToLine size={14} strokeWidth={1.7} />,
      onClick: () => {
        pushHistory();
        let z = items.reduce((m, it) => Math.max(m, it.z_index ?? 0), 0);
        const next = items.map((it) => {
          if (!targetIds.includes(it.id)) return it;
          z += 1;
          const updated = { ...it, z_index: z, updated_at: Date.now() };
          persistItem(updated);
          return updated;
        });
        setItems(next);
      },
    });
    out.push({
      label: `Send to back${suffix}`,
      icon: <ArrowDownToLine size={14} strokeWidth={1.7} />,
      onClick: () => {
        pushHistory();
        let z = items.reduce((m, it) => Math.min(m, it.z_index ?? 0), 0);
        const next = items.map((it) => {
          if (!targetIds.includes(it.id)) return it;
          z -= 1;
          const updated = { ...it, z_index: z, updated_at: Date.now() };
          persistItem(updated);
          return updated;
        });
        setItems(next);
      },
    });

    // Shape kind swap — only when every target is a shape.
    if (anyShape && targets.every((it) => it.type === 'shape')) {
      out.push({ type: 'separator' });
      out.push({
        label: 'Shape: Rectangle',
        icon: <Square size={14} strokeWidth={1.7} />,
        onClick: () => {
          pushHistory();
          setItems((prev) => prev.map((it) => {
            if (!targetIds.includes(it.id)) return it;
            const next = { ...it, data: { ...(it.data || {}), kind: 'rect' }, updated_at: Date.now() };
            persistItem(next);
            return next;
          }));
        },
      });
      out.push({
        label: 'Shape: Ellipse',
        icon: <Circle size={14} strokeWidth={1.7} />,
        onClick: () => {
          pushHistory();
          setItems((prev) => prev.map((it) => {
            if (!targetIds.includes(it.id)) return it;
            const next = { ...it, data: { ...(it.data || {}), kind: 'ellipse' }, updated_at: Date.now() };
            persistItem(next);
            return next;
          }));
        },
      });
      out.push({
        label: 'Shape: Triangle',
        icon: <Triangle size={14} strokeWidth={1.7} />,
        onClick: () => {
          pushHistory();
          setItems((prev) => prev.map((it) => {
            if (!targetIds.includes(it.id)) return it;
            const next = { ...it, data: { ...(it.data || {}), kind: 'triangle' }, updated_at: Date.now() };
            persistItem(next);
            return next;
          }));
        },
      });
    }

    out.push({ type: 'separator' });

    out.push({
      label: allLocked ? `Unlock${suffix}` : `Lock${suffix}`,
      icon: allLocked
        ? <Unlock size={14} strokeWidth={1.7} />
        : <Lock size={14} strokeWidth={1.7} />,
      onClick: () => setLockOnIds(targetIds, !allLocked),
    });

    out.push({ type: 'separator' });

    out.push({
      label: `Remove from board${suffix}`,
      icon: <Trash2 size={14} strokeWidth={1.7} />,
      danger: true,
      onClick: () => removeIdsFromBoard(targetIds),
    });

    return out;
  }, [
    items, selectedIds, boardId,
    persistItem, persistMany, pushHistory,
    removeIdsFromBoard, setLockOnIds,
  ]);

  const handleItemContextMenu = useCallback((target, x, y) => {
    setBoardCtx({ x, y, items: buildBoardCtxItems(target) });
  }, [buildBoardCtxItems]);


  return (
    <div ref={rootRef} className={styles.root}>
      {onExit && (
        <button
          type="button"
          className={styles.backBtn}
          onClick={onExit}
          aria-label="Back to library"
          title="Back to library"
        >
          <ChevronLeft size={18} strokeWidth={1.6} aria-hidden="true" />
        </button>
      )}

      <div className={styles.titleBar}>
        {titleEditing ? (
          <input
            ref={titleInputRef}
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
        ) : (
          <>
            <span
              className={styles.titleText}
              onDoubleClick={beginTitleEdit}
              title="Double-click to rename"
            >
              {board?.name || 'Untitled board'}
            </span>
            <button
              type="button"
              className={styles.titleEditBtn}
              onClick={beginTitleEdit}
              title="Rename board"
              aria-label="Rename board"
            >
              <Pencil size={12} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div className={styles.toolbar}>
        {TOOLS.map(({ id, label, Icon, disabled }) => {
          // Shapes button gets a flyout — clicking it both activates
          // the shape tool and opens a kind picker so the user
          // chooses rect / ellipse / triangle before clicking the
          // canvas. The currently-active kind highlights inside.
          if (id === 'shape') {
            return (
              <ShapeToolButton
                key={id}
                activeTool={tool}
                shapeKind={shapeKind}
                arrowKind={arrowKind}
                onPickShape={(k) => { setShapeKind(k); setTool('shape'); }}
                onPickArrow={(k) => { setArrowKind(k); setTool('arrow'); }}
                Icon={Icon}
              />
            );
          }
          return (
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
          );
        })}
        <div className={styles.toolDivider} />
        <button
          type="button"
          className={styles.toolBtn}
          title="Undo (⌘Z)"
          onClick={handleUndo}
          disabled={!canUndo}
        >
          <Undo2 {...TOOL_ICON} />
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          title="Redo (⌘⇧Z)"
          onClick={handleRedo}
          disabled={!canRedo}
        >
          <Redo2 {...TOOL_ICON} />
        </button>
        <div className={styles.toolDivider} />
        <button
          type="button"
          className={styles.toolBtn}
          title="Export PNG"
          onClick={exportBoardPng}
          disabled={exporting}
        >
          <Download {...TOOL_ICON} />
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
        onCanvasMount={(el) => { canvasNodeRef.current = el; }}
        onExternalImageSaved={(n) => {
          onShowToast?.(
            n === 1 ? 'Added to library' : `Added ${n} images to library`,
          );
          // Belt-and-suspenders refresh: the save:created event
          // already triggers useLibrary to reload, but being
          // explicit here guarantees the masonry library list
          // reflects the new save by the time the user navigates
          // back to the All view.
          onLibraryReload?.();
        }}
        onSetAppDragging={onSetAppDragging}
        onItemContextMenu={handleItemContextMenu}
        onArrowCreate={handleArrowCreate}
        arrowKind={arrowKind}
        onFrameCreate={handleFrameCreate}
        tool={tool}
      />

      {drawerOpen && (
        <BoardLibraryDrawer
          collections={collections}
          boardId={boardId}
          onClose={() => {
            setDrawerOpen(false);
            // Closing the image drawer pops the tool back to select so
            // the cursor doesn't linger in image-pick mode (which would
            // otherwise keep the next canvas click "image-armed").
            setTool('select');
          }}
        />
      )}

      {boardCtx && (
        <ContextMenu
          x={boardCtx.x}
          y={boardCtx.y}
          items={boardCtx.items}
          onClose={() => setBoardCtx(null)}
        />
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

      {imageBarItem && (
        <ImageActionBar
          item={imageBarItem}
          rootEl={rootRef.current}
          pan={pan}
          zoom={zoom}
          onBringToFront={handleBringToFront}
          onSendToBack={handleSendToBack}
          onDownload={handleDownloadItem}
          onCopyImage={handleCopyImageItem}
          onToggleLock={() => setLockOnIds([imageBarItem.id], !imageBarItem.data?.locked)}
          onRemoveFromBoard={handleRemoveFromBoard}
        />
      )}

      {arrowBarItem && (
        <ArrowActionBar
          item={arrowBarItem}
          rootEl={rootRef.current}
          pan={pan}
          zoom={zoom}
          onUpdate={handleArrowUpdate}
          onBringToFront={handleArrowBringToFront}
          onSendToBack={handleArrowSendToBack}
          onRemoveFromBoard={handleArrowRemove}
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
      </div>
    </div>
  );
}
