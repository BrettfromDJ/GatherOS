import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from './BoardView.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { extractDropImageUrls } from '../lib/dropUrls.js';

// World-space padding around an arrow's bounding rect so the SVG
// has room to draw the arrowhead beyond the line endpoint without
// being clipped by the wrapper's overflow: visible. Mirrors the
// constant in BoardView so endpoint drags stay in sync.
const ARROW_BBOX_PAD = 12;

// Pull the arrow's points out of item.data, handling the legacy
// shape ({x1,y1,x2,y2}) by deriving a 2-point array. Going forward
// every persisted arrow stores data.points; the legacy keys are
// only honoured when no points array is present.
function getArrowPoints(item) {
  const pts = item?.data?.points;
  if (Array.isArray(pts) && pts.length >= 2) return pts;
  return [
    { x: item?.data?.x1 ?? 0, y: item?.data?.y1 ?? 0 },
    { x: item?.data?.x2 ?? 0, y: item?.data?.y2 ?? 0 },
  ];
}

// Bounding rect of an arrow given its points, padded so the
// arrowhead has room to draw past the last point.
function arrowBboxFromPoints(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX - ARROW_BBOX_PAD,
    y: minY - ARROW_BBOX_PAD,
    width: (maxX - minX) + ARROW_BBOX_PAD * 2,
    height: (maxY - minY) + ARROW_BBOX_PAD * 2,
  };
}

// Convert a screen-space point (relative to the canvas's top-left)
// into world coordinates given the current pan + zoom.
function screenToWorld(sx, sy, pan, zoom) {
  return {
    x: (sx - pan.x) / zoom,
    y: (sy - pan.y) / zoom,
  };
}

// Hardcoded sticky palette mirror for inline-style rendering. (Kept
// in sync with STICKY_PALETTES in BoardView.jsx; could be hoisted
// to a shared module if it grows.)
const STICKY_PALETTES_CANVAS = {
  yellow: { top: '#FFF6BC', bottom: '#FFE988', shadow: 'rgba(140, 110, 0, 0.18)' },
  pink:   { top: '#FFE0EA', bottom: '#FFC2D1', shadow: 'rgba(170, 70, 100, 0.18)' },
  green:  { top: '#DCF1E0', bottom: '#B8E0BF', shadow: 'rgba(40, 110, 60, 0.18)' },
  blue:   { top: '#DCEAF8', bottom: '#B8D2EE', shadow: 'rgba(40, 80, 140, 0.18)' },
  orange: { top: '#FFE0CB', bottom: '#FFC59E', shadow: 'rgba(170, 90, 30, 0.18)' },
  purple: { top: '#EFD9FF', bottom: '#DCB4FA', shadow: 'rgba(110, 60, 170, 0.18)' },
};

// Style props derived from item.data — used by text, sticky, and
// shape items. Falls back to sensible per-type defaults when a field
// hasn't been customised yet. For stickies, also adds the CSS vars
// that paint the paper gradient (so a single .itemSticky class
// supports any palette).
function textStyleFor(item) {
  const isSticky = item.type === 'sticky';
  const isShape = item.type === 'shape';
  // Sticky paper is always light yellow and shapes default to a
  // user-defined fill (white out of the box), so text on both needs
  // to be dark regardless of app theme. Free text floats directly on
  // the board surface, so it follows --text-primary.
  const defaultColor = (isSticky || isShape)
    ? 'rgba(0, 0, 0, 0.85)'
    : 'var(--text-primary)';
  const out = {
    fontFamily: item.data?.fontFamily || 'inherit',
    fontSize: `${item.data?.fontSize || (isSticky || isShape ? 14 : 16)}px`,
    fontWeight: item.data?.bold ? 700 : 400,
    fontStyle: item.data?.italic ? 'italic' : 'normal',
    textAlign: item.data?.align || (isShape ? 'center' : 'left'),
    color: item.data?.color || defaultColor,
  };
  if (isSticky) {
    const palette = STICKY_PALETTES_CANVAS[item.data?.stickyColor]
      || STICKY_PALETTES_CANVAS.yellow;
    out['--sticky-top'] = palette.top;
    out['--sticky-bottom'] = palette.bottom;
    out['--sticky-shadow'] = palette.shadow;
  }
  return out;
}

// Inner editable for text/sticky items. The contentEditable's text
// content is driven imperatively via ref so React doesn't reconcile
// away the user's keystrokes during edit. Empty state shows a
// Inline title input for frames. Auto-focuses, selects all on
// mount, commits on Enter / blur, cancels on Escape (reverts to
// the initial title without persisting).
function FrameTitleInput({ initial, onCommit }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  return (
    <input
      ref={ref}
      className={styles.frameTabInput}
      defaultValue={initial}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.value = initial;
          e.currentTarget.blur();
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// CSS-only ::before placeholder so the editor reads as "Type
// something" before the user types.
function EditableTextContent({ item, editing, onCommitEdit }) {
  const ref = useRef(null);
  const cls = item.type === 'shape'
    ? styles.shapeText
    : item.type === 'sticky'
      ? styles.itemSticky
      : styles.itemText;

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
    // Shapes are flex-centred; an empty contentEditable has no
    // content for flex to centre, so the browser drops the caret at
    // the top-left of the box. Insert a real zero-width space — a
    // text node, since pseudo-elements don't affect caret placement
    // — so the line box exists at the centred position. Stripped on
    // commit; re-inserted via onInput below if the user backspaces
    // it out during the edit.
    if (item.type === 'shape' && (el.textContent || '') === '') {
      el.textContent = '​';
    }
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
      // Shapes are meaningful empty (the outline reads as the item),
      // so they don't get a "Type something" placeholder. Text +
      // sticky still do.
      data-placeholder={item.type === 'shape' ? undefined : 'Type something'}
      onInput={(e) => {
        // Shapes seed a zero-width-space on edit-mode entry to keep
        // the caret centred. If the user backspaces every char,
        // including that ZWS, the editor goes truly empty and the
        // caret falls back to the top-left. Re-seed it here.
        if (item.type !== 'shape') return;
        const el = e.currentTarget;
        if ((el.textContent || '') === '') {
          el.textContent = '​';
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }}
      onBlur={(e) => {
        // Strip any zero-width spaces (the caret-centering seed for
        // shapes) before persisting so they never reach the saved text.
        const raw = e.currentTarget.innerText;
        const text = raw.replace(/​/g, '');
        onCommitEdit(item.id, text);
        // Clear any text the user had highlighted inside the editor
        // before clicking out — without this the highlight stays
        // painted on the deselected item until they click again.
        const sel = window.getSelection();
        if (sel && sel.anchorNode && e.currentTarget.contains(sel.anchorNode)) {
          sel.removeAllRanges();
        }
      }}
      onMouseDown={(e) => { if (editing) e.stopPropagation(); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.blur();
          return;
        }
        if (e.key === 'Enter') {
          // Force a <br> instead of the browser's default <div>
          // paragraph block. <div> blocks become individual flex
          // items inside a flex-centred shape, which lays them out
          // sideways and breaks line-break expectations entirely.
          // <br> keeps everything as one inline flow that the flex
          // container centres as a single multi-line block, and
          // works correctly in text + sticky too.
          e.preventDefault();
          document.execCommand('insertLineBreak');
        }
      }}
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
  multiSelected,
  editing,
  onSelect,
  onMoveStart,
  onResizeStart,
  onCommitEdit,
  onBeginEdit,
  onContextMenu,
  dropHover,
}) {
  const baseStyle = {
    left: item.x,
    top: item.y,
    width: item.width || undefined,
    height: item.height || undefined,
    transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
    // Frames always sit behind regular items so they read as
    // background sections / containers, regardless of when they
    // were created (later additions naturally get a higher z_index).
    zIndex: item.type === 'frame'
      ? -1_000_000 + (item.z_index ?? 0)
      : (item.z_index ?? 0),
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    if (editing) return;
    e.stopPropagation();
    onSelect(item.id, e.shiftKey);
    // Locked items are pinned in place — clicking them still selects
    // (so the user can unlock from the context menu) but doesn't
    // start a move drag.
    if (!item.data?.locked) {
      onMoveStart(item, e);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.(item, e.clientX, e.clientY);
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
    // Lock the wrapper to the image's natural aspect ratio so the
    // bounding box always hugs the image — even for items stored
    // with mismatched width/height, and even after a non-uniform
    // drag (resize is now proportional, but legacy items can have
    // any persisted shape). Width drives the size; height is
    // computed via aspect-ratio.
    const naturalW = liveSave?.width || item.data?.naturalWidth;
    const naturalH = liveSave?.height || item.data?.naturalHeight;
    if (naturalW && naturalH) {
      baseStyle.aspectRatio = `${naturalW} / ${naturalH}`;
      baseStyle.height = 'auto';
    }
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
  } else if (item.type === 'arrow') {
    // Polyline model: data.points carries every vertex in world
    // coords (with legacy x1/y1/x2/y2 falling back to a 2-point
    // path). Convert to wrapper-local for SVG rendering.
    const points = getArrowPoints(item);
    const localPoints = points.map((p) => ({ x: p.x - item.x, y: p.y - item.y }));
    // currentColor falls through to .itemArrow's CSS color, which is
    // --text-primary — so the default arrow tracks the theme (black on
    // light, white on dark) while user-picked stroke colors still win.
    // Also collapses the legacy ARROW_DEFAULT_DATA value '#0a0a0a' to
    // the theme-aware default so existing arrows behave correctly
    // without a DB migration.
    const rawStroke = item.data?.stroke;
    const stroke = (!rawStroke || rawStroke === '#0a0a0a')
      ? 'currentColor'
      : rawStroke;
    const strokeWidth = item.data?.strokeWidth || 2;
    const kind = item.data?.kind || 'arrow';
    const markerId = `arrowhead-${item.id}`;
    const showHead = kind !== 'line';
    const polyPoints = localPoints.map((p) => `${p.x},${p.y}`).join(' ');
    content = (
      <svg
        className={styles.arrowSvg}
        width="100%"
        height="100%"
        viewBox={`0 0 ${item.width} ${item.height}`}
        preserveAspectRatio="none"
      >
        <defs>
          {/* refX=8 places the arrowhead tip at the line endpoint
              regardless of stroke width (markerWidth=8). */}
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            markerUnits="strokeWidth"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
          </marker>
        </defs>
        <polyline
          points={polyPoints}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          markerEnd={showHead ? `url(#${markerId})` : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  } else if (item.type === 'shape') {
    isTextish = true;
    const kind = item.data?.kind || 'rect';
    const fill = item.data?.fill || '#FFFFFF';
    const stroke = item.data?.stroke || 'rgba(0, 0, 0, 0.85)';
    const sw = item.data?.strokeWidth ?? 2;
    // Render the shape outline as an SVG that fills the wrapper. The
    // viewBox is square and we use preserveAspectRatio="none" so the
    // shape stretches with the wrapper's aspect; vectorEffect=
    // non-scaling-stroke keeps the stroke an even width all the way
    // around even when the wrapper is far from square.
    let shape;
    if (kind === 'ellipse') {
      shape = (
        <ellipse
          cx="50" cy="50"
          rx={50 - sw / 2} ry={50 - sw / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      );
    } else if (kind === 'triangle') {
      shape = (
        <polygon
          points="50,4 96,96 4,96"
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      );
    } else {
      shape = (
        <rect
          x={sw / 2} y={sw / 2}
          width={100 - sw} height={100 - sw}
          rx="2" ry="2"
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      );
    }
    content = (
      <>
        <svg
          className={styles.shapeBg}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {shape}
        </svg>
        <EditableTextContent
          item={item}
          editing={editing}
          onCommitEdit={onCommitEdit}
        />
      </>
    );
  } else if (item.type === 'frame') {
    isTextish = true;
    // Frame body fills the wrapper; the title tab sits above the
    // top-left of the body (absolute-positioned via CSS so the
    // wrapper's bounding box still hugs the frame rect, not the tab).
    // onCommitEdit gets the new title — handleCommitEdit in BoardView
    // detects type === 'frame' and writes it into data.title.
    // Treat the legacy #FFFFFF default as "auto theme" so frames
    // adopt the surface colour in both modes. A user who deliberately
    // picks white loses that bit, but white-on-dark frames were the
    // pain point. Other custom colours still pass through verbatim.
    const rawFill = item.data?.fill || '#FFFFFF';
    const isDefaultFill = /^#?ffffff$/i.test(rawFill.replace(/^#/, ''));
    const fill = isDefaultFill ? 'var(--surface-1)' : rawFill;
    const title = item.data?.title || '';
    content = (
      <>
        <div className={styles.frameTab}>
          {editing ? (
            <FrameTitleInput
              initial={title}
              onCommit={(t) => onCommitEdit(item.id, t)}
            />
          ) : (
            <span className={styles.frameTabLabel} title={title}>{title || 'Untitled frame'}</span>
          )}
        </div>
        <div
          className={[styles.frameBody, dropHover && styles.frameBodyDropHover]
            .filter(Boolean).join(' ')}
          style={{ background: fill }}
        />
      </>
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
        // While multiple items are selected we suppress the per-item
        // outline — the group bounding box paints a single ring
        // around all of them instead. Arrows skip the outline +
        // standard corner handles entirely; they paint their own
        // endpoint handles when selected.
        selected && !multiSelected && item.type !== 'arrow' && styles.itemSelected,
        autosize && styles.itemAutosize,
        item.type === 'arrow' && styles.itemArrow,
      ].filter(Boolean).join(' ')}
      style={baseStyle}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      onDoubleClick={
        isTextish && !item.data?.locked
          ? (e) => { e.stopPropagation(); onBeginEdit(item.id); }
          : undefined
      }
    >
      {content}
      {item.data?.locked && (
        <span className={styles.lockBadge} title="Locked">
          {/* SVG lock icon — small white-bg pill in the top-right */}
          <svg viewBox="0 0 14 14" width="10" height="10" aria-hidden="true">
            <rect x="3" y="6.4" width="8" height="6" rx="1.2" fill="currentColor" />
            <path
              d="M4.8 6.4V4.5a2.2 2.2 0 0 1 4.4 0v1.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
      {selected && !multiSelected && !item.data?.locked && item.type !== 'arrow' && (
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
  onExternalImageSaved,
  onSetAppDragging,
  onItemContextMenu,
  onArrowCreate,
  arrowKind,
  onFrameCreate,
  tool,
  onCanvasMount,
}) {
  const canvasRef = useRef(null);

  // Hand the canvas DOM element back to the parent on mount so it
  // can measure for screenshot / PDF capture. Cleared on unmount so
  // the parent doesn't dereference a stale node after a board switch.
  useEffect(() => {
    if (typeof onCanvasMount === 'function') onCanvasMount(canvasRef.current);
    return () => {
      if (typeof onCanvasMount === 'function') onCanvasMount(null);
    };
  }, [onCanvasMount]);
  // Pan: middle-click drag only. (Plain scroll already pans via the
  // wheel handler; left-click drag is reserved for the lasso below.)
  const panState = useRef(null);
  // Item move: dragging an existing item.
  const moveState = useRef(null);
  // Resize: dragging a corner handle on a selected item.
  const resizeState = useRef(null);
  // Lasso / marquee: left-click drag on empty canvas. Records the
  // starting world point and the selection set the user already had
  // (so shift-drag is additive) so the move handler can compute the
  // running selection without losing what was previously picked.
  const lassoState = useRef(null);
  const [lassoRect, setLassoRect] = useState(null);
  // Group resize: drag a handle on the multi-selection bounding box.
  // Captures every selected item's start rect so the move handler
  // can scale them all proportionally around the anchored corner.
  const groupResizeState = useRef(null);
  // Arrow drawing in progress. Holds the start world coord; the
  // mousemove handler updates a live preview, and mouseup commits.
  const arrowDrawState = useRef(null);
  const [arrowDrawPreview, setArrowDrawPreview] = useState(null);
  // Frame currently being "hovered" by an in-progress drag (either a
  // move of existing items, or an external drop). Painted with a
  // subtle blue treatment so the user sees which container the
  // dropped item will land in.
  const [hoveredFrameId, setHoveredFrameId] = useState(null);
  // Frame drag-to-draw — same shape as arrow drawing. mousedown with
  // the frame tool seeds `start`; mousemove updates `end` and the
  // preview rect; mouseup either commits the drag bbox or falls back
  // to a default-sized frame at the start point if the user just
  // clicked without dragging.
  const frameDrawState = useRef(null);
  const [frameDrawPreview, setFrameDrawPreview] = useState(null);
  // Arrow endpoint drag in progress. Holds the active item and
  // which endpoint ('a' = start, 'b' = end) is moving.
  const arrowEndpointState = useRef(null);
  // The id of the arrow currently being moved by a wrapper drag.
  // Used to suppress its handles for the duration of the drag —
  // when you click-and-drag to relocate the arrow you don't want
  // the dots flashing along with the line.
  const [arrowMovingId, setArrowMovingId] = useState(null);
  // Active arrow-snap indicator while creating or dragging an
  // endpoint / vertex — { axis: 'h' | 'v', anchorX, anchorY }.
  const [snapHint, setSnapHint] = useState(null);
  // Alignment guides shown while dragging items: array of
  // { axis: 'h' | 'v', anchorX, anchorY } with up to one per axis.
  // Separate from snapHint so the arrow path stays unchanged.
  const [moveSnapGuides, setMoveSnapGuides] = useState([]);
  const [isPanning, setIsPanning] = useState(false);

  // Threshold (in world coords) for "close enough to lock" while
  // dragging arrow endpoints / vertices. Divided by zoom so the
  // gesture feels the same on screen at every zoom level.
  // (Not memo'd — `zoom` is in scope per render.)
  const ARROW_SNAP = 8 / zoom;

  // Threshold for snapping moving items' edges/centers to other
  // items on the board. Same screen-px feel at every zoom level.
  const MOVE_SNAP = 6 / zoom;

  // Given the post-move `updated` items and the set of moving ids,
  // find the smallest correction (dx, dy) that aligns one of the
  // moving group's edges/centers with a non-moving item's edge or
  // center on each axis. Returns { dx, dy, guides } where guides
  // is up to one per axis: { axis, anchorX, anchorY } for rendering
  // the long alignment line.
  function computeMoveSnap(updated, movingSet) {
    let mLeft = Infinity, mTop = Infinity, mRight = -Infinity, mBottom = -Infinity;
    for (const it of updated) {
      if (!movingSet.has(it.id)) continue;
      // Ignore arrows for the AABB — their points already track with
      // x/y so snapping the wrapper would still leave them visually
      // aligned, and arrow bboxes are noisy.
      if (it.type === 'arrow') continue;
      const w = it.width || 0;
      const h = it.height || 0;
      mLeft = Math.min(mLeft, it.x);
      mTop = Math.min(mTop, it.y);
      mRight = Math.max(mRight, it.x + w);
      mBottom = Math.max(mBottom, it.y + h);
    }
    if (!isFinite(mLeft)) return { dx: 0, dy: 0, guides: [] };
    const mCenterX = (mLeft + mRight) / 2;
    const mCenterY = (mTop + mBottom) / 2;

    let bestX = null;
    let bestY = null;
    for (const t of updated) {
      if (movingSet.has(t.id)) continue;
      if (t.type === 'arrow') continue;
      const w = t.width || 0;
      const h = t.height || 0;
      const tLeft = t.x;
      const tRight = t.x + w;
      const tCenterX = (tLeft + tRight) / 2;
      const tTop = t.y;
      const tBottom = t.y + h;
      const tCenterY = (tTop + tBottom) / 2;

      const xPairs = [
        [mLeft, tLeft], [mLeft, tCenterX], [mLeft, tRight],
        [mCenterX, tLeft], [mCenterX, tCenterX], [mCenterX, tRight],
        [mRight, tLeft], [mRight, tCenterX], [mRight, tRight],
      ];
      for (const [m, s] of xPairs) {
        const delta = s - m;
        if (Math.abs(delta) < MOVE_SNAP && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, anchorX: s, anchorY: tCenterY };
        }
      }
      const yPairs = [
        [mTop, tTop], [mTop, tCenterY], [mTop, tBottom],
        [mCenterY, tTop], [mCenterY, tCenterY], [mCenterY, tBottom],
        [mBottom, tTop], [mBottom, tCenterY], [mBottom, tBottom],
      ];
      for (const [m, s] of yPairs) {
        const delta = s - m;
        if (Math.abs(delta) < MOVE_SNAP && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, anchorX: tCenterX, anchorY: s };
        }
      }
    }

    const guides = [];
    if (bestX) guides.push({ axis: 'v', anchorX: bestX.anchorX, anchorY: bestX.anchorY });
    if (bestY) guides.push({ axis: 'h', anchorX: bestY.anchorX, anchorY: bestY.anchorY });
    return {
      dx: bestX ? bestX.delta : 0,
      dy: bestY ? bestY.delta : 0,
      guides,
    };
  }

  // Pure helper: given a candidate point and a set of anchor points
  // to snap against, return { snapped, axis: 'h'|'v'|null,
  // anchorX, anchorY } where snapped is the (possibly axis-locked)
  // position. Horizontal lock wins ties so the user gets predictable
  // behaviour when dragging diagonally near both axes.
  function computeArrowSnap(cur, anchors) {
    for (const a of anchors) {
      if (Math.abs(cur.y - a.y) < ARROW_SNAP) {
        return { snapped: { x: cur.x, y: a.y }, axis: 'h', anchorX: a.x, anchorY: a.y };
      }
      if (Math.abs(cur.x - a.x) < ARROW_SNAP) {
        return { snapped: { x: a.x, y: cur.y }, axis: 'v', anchorX: a.x, anchorY: a.y };
      }
    }
    return { snapped: cur, axis: null, anchorX: 0, anchorY: 0 };
  }

  // Bounding rect that wraps every currently-selected item (in world
  // coords). Computed from the rendered DOM rects so it works for
  // text items whose width/height are content-driven. Returns null
  // for fewer-than-two selected items so the group chrome doesn't
  // duplicate the per-item one.
  const groupBbox = useMemo(() => {
    if (selectedIds.size <= 1) return null;
    const cnv = canvasRef.current;
    if (!cnv) return null;
    const cr = cnv.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of selectedIds) {
      const el = cnv.querySelector(`[data-item-id="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const x1 = (r.left   - cr.left - pan.x) / zoom;
      const y1 = (r.top    - cr.top  - pan.y) / zoom;
      const x2 = (r.right  - cr.left - pan.x) / zoom;
      const y2 = (r.bottom - cr.top  - pan.y) / zoom;
      if (x1 < minX) minX = x1;
      if (y1 < minY) minY = y1;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
    }
    if (minX === Infinity) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [selectedIds, pan, zoom, items]);

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

  // Mousedown routing:
  //   middle-click anywhere               → pan
  //   left-click empty canvas, select     → lasso select (shift = add)
  //   left-click empty canvas, other tool → spawn item (text/sticky)
  const handleCanvasMouseDown = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      panState.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialPan: { ...pan },
      };
      setIsPanning(true);
      return;
    }
    // Arrow tool: drag-to-draw. Records the start world coord and
    // tracks mousemove for the preview. Commit happens on mouseup
    // if the drag distance is non-trivial.
    if (e.button === 0 && tool === 'arrow' && e.target === e.currentTarget) {
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const start = screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top,
        pan,
        zoom,
      );
      arrowDrawState.current = { start };
      setArrowDrawPreview({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
      return;
    }
    // Frame tool: same drag-to-draw pattern as the arrow tool but the
    // preview is a rectangle. mouseup either commits the dragged
    // bbox or, for a click-only gesture, falls back to a default-
    // sized frame centered on the start point.
    if (e.button === 0 && tool === 'frame' && e.target === e.currentTarget) {
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const start = screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top,
        pan,
        zoom,
      );
      frameDrawState.current = { start, end: start };
      setFrameDrawPreview({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
      return;
    }
    if (e.button === 0 && tool === 'select' && e.target === e.currentTarget) {
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const start = screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top,
        pan,
        zoom,
      );
      lassoState.current = {
        startWorld: start,
        additive: e.shiftKey,
        initialSelection: e.shiftKey ? new Set(selectedIds) : new Set(),
      };
      setLassoRect({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
      // Plain (non-shift) drag on empty canvas drops any prior
      // selection and dismisses any in-progress text edit. preventDefault
      // above suppresses the browser's own focus-clearing pass, so blur
      // the editor explicitly here.
      if (!e.shiftKey) {
        const editing = document.querySelector('[contenteditable="true"]');
        if (editing) editing.blur();
        onSelectIds(new Set());
      }
      return;
    }
    if (e.button === 0 && e.target === e.currentTarget) {
      // Click on empty canvas with non-select tool: dispatch up so
      // the parent can decide what to add. preventDefault keeps
      // focus on the contentEditable we're about to create.
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
    if (item?.data?.locked) return;
    const itemEl = canvasRef.current.querySelector(`[data-item-id="${item.id}"]`);
    let measuredW = item.width;
    let measuredH = item.height;
    // Image items render with an aspect-locked height that may not
    // match the persisted item.height (legacy data, prior non-
    // uniform drags). Always measure from the DOM so the resize
    // anchor math agrees with what the user sees on screen.
    if (item.type === 'image' && itemEl) {
      const r = itemEl.getBoundingClientRect();
      measuredW = r.width / zoom;
      measuredH = r.height / zoom;
    } else if ((!measuredW || !measuredH) && itemEl) {
      const r = itemEl.getBoundingClientRect();
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

  // Group resize: started by the group bounding-box's corner
  // handles. We snapshot every selected item's start rect (measured
  // from DOM so text/image autosize is accounted for) plus its
  // start font size, so the mousemove handler can re-position and
  // re-size each one relative to the anchored corner.
  const handleGroupResizeStart = (corner, e) => {
    if (!groupBbox) return;
    // Skip the resize if every selected item is locked. With at least
    // one unlocked item the resize still runs — the inner per-item
    // resize loop below skips locked ones so their geometry stays put.
    const selectedItems = items.filter((it) => selectedIds.has(it.id));
    if (selectedItems.length > 0 && selectedItems.every((it) => it.data?.locked)) return;
    const cnv = canvasRef.current;
    if (!cnv) return;
    const cr = cnv.getBoundingClientRect();
    const snaps = new Map();
    for (const id of selectedIds) {
      const it = items.find((x) => x.id === id);
      if (!it) continue;
      const el = cnv.querySelector(`[data-item-id="${id}"]`);
      let w = it.width, h = it.height;
      if (el) {
        const r = el.getBoundingClientRect();
        w = r.width / zoom;
        h = r.height / zoom;
      }
      snaps.set(id, {
        x: it.x,
        y: it.y,
        width: w,
        height: h,
        fontSize: it.data?.fontSize,
        data: it.data || {},
        type: it.type,
      });
    }
    groupResizeState.current = {
      corner,
      startMouse: { x: e.clientX, y: e.clientY },
      initialBbox: { ...groupBbox },
      snaps,
    };
  };

  // Item move: started by BoardItem.onMouseDown, completed/tracked here
  // via window-level listeners so the cursor can wander outside the
  // canvas during a drag without the move getting stuck.
  const handleItemMoveStart = (item, e) => {
    // Locked items can't be dragged. Keep the click-to-select
    // behaviour by still letting onSelectIds run via the canvas's
    // normal mousedown bubbling — just abort the move setup here.
    if (item?.data?.locked) return;
    // A drag that started on top of a contentEditable's text node will
    // also start a native text selection, which sticks even after the
    // drag ends. Clear any pending selection at the start of a move
    // and prevent the default so the browser doesn't keep extending
    // it as the cursor moves.
    window.getSelection?.()?.removeAllRanges?.();
    if (e?.preventDefault) e.preventDefault();
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

    // Frames behave like spatial groups — dragging a frame translates
    // every item whose center sits inside the frame's bounds. We do
    // this for any frame currently in `movingIds` so multi-selecting
    // frames + free items still moves their contents along. Items
    // already in `movingIds` (because they were directly selected)
    // are skipped to avoid double-translation downstream.
    const movingSet = new Set(movingIds);
    for (const id of movingIds) {
      const f = items.find((x) => x.id === id);
      if (!f || f.type !== 'frame') continue;
      const fx1 = f.x;
      const fy1 = f.y;
      const fx2 = f.x + (f.width || 0);
      const fy2 = f.y + (f.height || 0);
      for (const it of items) {
        if (movingSet.has(it.id)) continue;
        if (it.type === 'frame') continue; // don't nest-drag frames
        // Use the item's center for inclusion — matches the visual
        // sense of "this item belongs to that frame".
        const cx = it.x + (it.width || 0) / 2;
        const cy = it.y + (it.height || 0) / 2;
        if (cx >= fx1 && cx <= fx2 && cy >= fy1 && cy <= fy2) {
          movingSet.add(it.id);
        }
      }
    }
    movingIds = Array.from(movingSet);

    const offsets = new Map();
    for (const id of movingIds) {
      const it = items.find((x) => x.id === id);
      if (it) offsets.set(id, { dx: it.x - cursor.x, dy: it.y - cursor.y });
    }
    moveState.current = { offsets, movingIds };
    // Hide arrow chrome while the wrapper is moving so the handles
    // don't shadow the line during a drag.
    if (item.type === 'arrow') setArrowMovingId(item.id);
  };

  useEffect(() => {
    function onMove(e) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (arrowDrawState.current) {
        const raw = screenToWorld(
          e.clientX - rect.left,
          e.clientY - rect.top,
          pan,
          zoom,
        );
        const { start } = arrowDrawState.current;
        // Snap the live end against the start so the user can lock
        // a perfectly horizontal / vertical arrow during creation.
        const { snapped, axis, anchorX, anchorY } = computeArrowSnap(raw, [start]);
        // Stash on the ref so mouseup reads the snapped end.
        arrowDrawState.current.end = snapped;
        setArrowDrawPreview({ x1: start.x, y1: start.y, x2: snapped.x, y2: snapped.y });
        setSnapHint(axis ? { axis, anchorX, anchorY } : null);
        return;
      }
      if (frameDrawState.current) {
        const cur = screenToWorld(
          e.clientX - rect.left,
          e.clientY - rect.top,
          pan,
          zoom,
        );
        const { start } = frameDrawState.current;
        frameDrawState.current.end = cur;
        setFrameDrawPreview({ x1: start.x, y1: start.y, x2: cur.x, y2: cur.y });
        return;
      }
      if (arrowEndpointState.current) {
        const { itemId, vertexIdx } = arrowEndpointState.current;
        const raw = screenToWorld(
          e.clientX - rect.left,
          e.clientY - rect.top,
          pan,
          zoom,
        );
        const target = items.find((x) => x.id === itemId);
        if (!target) return;
        const oldPoints = getArrowPoints(target);
        // Build snap anchor list from the dragged vertex's neighbours
        // (the points it's directly connected to). For an endpoint
        // there's only one neighbour; for an internal vertex there
        // are two (prev + next).
        const anchors = [];
        if (vertexIdx > 0) anchors.push(oldPoints[vertexIdx - 1]);
        if (vertexIdx < oldPoints.length - 1) anchors.push(oldPoints[vertexIdx + 1]);
        const { snapped, axis, anchorX, anchorY } = computeArrowSnap(raw, anchors);
        setSnapHint(axis ? { axis, anchorX, anchorY } : null);
        const updated = items.map((it) => {
          if (it.id !== itemId) return it;
          const points = getArrowPoints(it).map((p, i) =>
            i === vertexIdx ? { x: snapped.x, y: snapped.y } : p,
          );
          const bbox = arrowBboxFromPoints(points);
          return {
            ...it,
            x: bbox.x,
            y: bbox.y,
            width: bbox.width,
            height: bbox.height,
            data: { ...(it.data || {}), points },
          };
        });
        onItemsChange(updated, { movingIds: [itemId], persist: false });
        return;
      }
      if (lassoState.current) {
        const cur = screenToWorld(
          e.clientX - rect.left,
          e.clientY - rect.top,
          pan,
          zoom,
        );
        const x1 = Math.min(lassoState.current.startWorld.x, cur.x);
        const y1 = Math.min(lassoState.current.startWorld.y, cur.y);
        const x2 = Math.max(lassoState.current.startWorld.x, cur.x);
        const y2 = Math.max(lassoState.current.startWorld.y, cur.y);
        setLassoRect({ x1, y1, x2, y2 });
        // Walk every item, AABB-test its world rect against the
        // marquee, and accumulate hits on top of the user's prior
        // selection (the prior set is empty unless this drag was
        // initiated with shift held).
        const hits = new Set(lassoState.current.initialSelection);
        for (const item of items) {
          const el = canvasRef.current.querySelector(`[data-item-id="${item.id}"]`);
          if (!el) continue;
          const er = el.getBoundingClientRect();
          const ix1 = (er.left   - rect.left - pan.x) / zoom;
          const iy1 = (er.top    - rect.top  - pan.y) / zoom;
          const ix2 = (er.right  - rect.left - pan.x) / zoom;
          const iy2 = (er.bottom - rect.top  - pan.y) / zoom;
          if (ix2 >= x1 && ix1 <= x2 && iy2 >= y1 && iy1 <= y2) {
            hits.add(item.id);
          }
        }
        onSelectIds(hits);
        return;
      }
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
        const movingSet = new Set(movingIds);
        const updated = items.map((it) => {
          if (!offsets.has(it.id)) return it;
          const o = offsets.get(it.id);
          const newX = cursor.x + o.dx;
          const newY = cursor.y + o.dy;
          // Arrow points are stored in world coords on item.data
          // (.points array, with legacy x1/y1/x2/y2 fallback), so
          // they have to translate alongside x/y or the line stays
          // put while the wrapper drifts.
          if (it.type === 'arrow' && it.data) {
            const dx = newX - it.x;
            const dy = newY - it.y;
            const oldPoints = getArrowPoints(it);
            const points = oldPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
            return {
              ...it,
              x: newX,
              y: newY,
              data: { ...it.data, points },
            };
          }
          return { ...it, x: newX, y: newY };
        });
        // Alignment-snap: correct the moving group so an edge or
        // center aligns with a stationary item if anything's within
        // a 6-screen-px threshold. The same correction applies to
        // every moving item so the cluster stays rigid.
        const { dx: snapDx, dy: snapDy, guides } = computeMoveSnap(updated, movingSet);
        if (snapDx !== 0 || snapDy !== 0) {
          for (let i = 0; i < updated.length; i += 1) {
            const it = updated[i];
            if (!movingSet.has(it.id)) continue;
            if (it.type === 'arrow' && it.data) {
              const oldPoints = getArrowPoints(it);
              const points = oldPoints.map((p) => ({
                x: p.x + snapDx,
                y: p.y + snapDy,
              }));
              updated[i] = {
                ...it,
                x: it.x + snapDx,
                y: it.y + snapDy,
                data: { ...it.data, points },
              };
            } else {
              updated[i] = { ...it, x: it.x + snapDx, y: it.y + snapDy };
            }
          }
        }
        setMoveSnapGuides(guides);
        // Drop-target hint: highlight the frame currently containing
        // any non-frame moving item's center. Frames being moved
        // (drag-with-children) don't highlight themselves. Topmost
        // frame wins when frames overlap.
        let hoverId = null;
        const frames = updated.filter((it) => it.type === 'frame' && !movingSet.has(it.id));
        for (const it of updated) {
          if (!movingSet.has(it.id) || it.type === 'frame') continue;
          const cx = it.x + (it.width || 0) / 2;
          const cy = it.y + (it.height || 0) / 2;
          for (let i = frames.length - 1; i >= 0; i -= 1) {
            const f = frames[i];
            if (cx >= f.x && cx <= f.x + (f.width || 0)
              && cy >= f.y && cy <= f.y + (f.height || 0)) {
              hoverId = f.id;
              break;
            }
          }
          if (hoverId) break;
        }
        setHoveredFrameId(hoverId);
        onItemsChange(updated, { movingIds, persist: false });
      } else if (groupResizeState.current) {
        const { corner, startMouse, initialBbox, snaps } = groupResizeState.current;
        const dxW = (e.clientX - startMouse.x) / zoom;
        const dyW = (e.clientY - startMouse.y) / zoom;

        const anchorRight = corner === 'nw' || corner === 'sw';
        const anchorBottom = corner === 'nw' || corner === 'ne';
        const dxSigned = anchorRight ? -dxW : dxW;
        const dySigned = anchorBottom ? -dyW : dyW;

        const MIN = 30;
        let newW = Math.max(MIN, initialBbox.w + dxSigned);
        let newH = Math.max(MIN, initialBbox.h + dySigned);
        // Group resize stays uniform — heterogeneous selections
        // (image + text + sticky) need a single scale factor so
        // typography doesn't distort.
        const sScale = Math.max(newW / initialBbox.w, newH / initialBbox.h);
        newW = initialBbox.w * sScale;
        newH = initialBbox.h * sScale;

        const newBboxX = anchorRight
          ? initialBbox.x + (initialBbox.w - newW)
          : initialBbox.x;
        const newBboxY = anchorBottom
          ? initialBbox.y + (initialBbox.h - newH)
          : initialBbox.y;

        const movingIds = [];
        const updated = items.map((it) => {
          const snap = snaps.get(it.id);
          if (!snap) return it;
          movingIds.push(it.id);
          // Each item's offset from the bbox's anchored corner is
          // scaled by sScale so spacing between items grows with the
          // group instead of items collapsing toward a single point.
          const offsetX = snap.x - initialBbox.x;
          const offsetY = snap.y - initialBbox.y;
          const newX = newBboxX + offsetX * sScale;
          const newY = newBboxY + offsetY * sScale;
          if (snap.type === 'text') {
            return {
              ...it,
              x: newX,
              y: newY,
              width: null,
              height: null,
              data: {
                ...snap.data,
                fontSize: Math.max(
                  8,
                  Math.min(200, Math.round((snap.fontSize || 16) * sScale)),
                ),
              },
            };
          }
          return {
            ...it,
            x: newX,
            y: newY,
            width: snap.width * sScale,
            height: snap.height * sScale,
          };
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

        // Text and image both resize uniformly — text scales its
        // fontSize with the box, and images need to preserve their
        // intrinsic aspect ratio so the wrapper always hugs the
        // image with no letterbox space inside the bounding box.
        // Sticky stays free-aspect so the user can shape the note
        // tall, wide, or square.
        if (type === 'text' || type === 'image') {
          const sx = newW / initial.width;
          const sy = newH / initial.height;
          const s = Math.max(sx, sy);
          newW = Math.max(MIN, initial.width * s);
          newH = Math.max(MIN, initial.height * s);
        }
        // Ellipse: lock to 1:1 so it stays a circle rather than
        // stretching into an oval. Uses the larger of the two pulled
        // dimensions so legacy oval ellipses round up to a circle on
        // first resize.
        if (type === 'shape' && initial.data?.kind === 'ellipse') {
          const size = Math.max(MIN, newW, newH);
          newW = size;
          newH = size;
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
          // Sticky and shape both: free-aspect box, body fontSize
          // scales by the smaller of the two axis ratios so the
          // text never outgrows whichever dimension the user is
          // shrinking.
          if (type === 'sticky' || type === 'shape') {
            const fontScale = Math.min(
              newW / initial.width,
              newH / initial.height,
            );
            return {
              ...it,
              x: newX,
              y: newY,
              width: newW,
              height: newH,
              data: {
                ...initial.data,
                fontSize: Math.max(
                  8,
                  Math.min(72, Math.round((initial.fontSize || 14) * fontScale)),
                ),
              },
            };
          }
          // Image: traditional explicit-size resize.
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
        setArrowMovingId(null);
        setHoveredFrameId(null);
        setMoveSnapGuides([]);
      }
      if (resizeState.current) {
        const id = resizeState.current.itemId;
        resizeState.current = null;
        onItemsChange(items, { movingIds: [id], persist: true });
      }
      if (groupResizeState.current) {
        const movingIds = Array.from(groupResizeState.current.snaps.keys());
        groupResizeState.current = null;
        onItemsChange(items, { movingIds, persist: true });
      }
      if (lassoState.current) {
        lassoState.current = null;
        setLassoRect(null);
      }
      if (arrowDrawState.current) {
        const { start, end: liveEnd } = arrowDrawState.current;
        const end = liveEnd || start;
        arrowDrawState.current = null;
        setArrowDrawPreview(null);
        setSnapHint(null);
        // Ignore micro-drags so a click on empty canvas with the
        // arrow tool just deselects rather than producing a 0-length
        // arrow.
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (Math.hypot(dx, dy) >= 5) {
          onArrowCreate?.({ start, end });
        }
      }
      if (frameDrawState.current) {
        const { start, end: liveEnd } = frameDrawState.current;
        const end = liveEnd || start;
        frameDrawState.current = null;
        setFrameDrawPreview(null);
        // BoardView decides whether to use the dragged bbox or fall
        // back to a default-sized frame at `start` when the gesture
        // was a click. Threshold is checked there.
        onFrameCreate?.({ start, end });
      }
      if (arrowEndpointState.current) {
        const id = arrowEndpointState.current.itemId;
        arrowEndpointState.current = null;
        setSnapHint(null);
        onItemsChange(items, { movingIds: [id], persist: true });
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [items, pan, zoom, onPanZoomChange, onItemsChange, onArrowCreate, onFrameCreate]);

  // Drop: a thumbnail dragged from the library drawer (data with
  // saveId) or external image drops via the host's drop handler. We
  // resolve to world coords and forward saveId + position upward.
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    // External drag (library thumbnail / file from desktop) — paint
    // the same drop-target highlight on whichever frame is under the
    // cursor so the user sees where the dropped image will land.
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, pan, zoom);
    let hoverId = null;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const f = items[i];
      if (f.type !== 'frame') continue;
      if (w.x >= f.x && w.x <= f.x + (f.width || 0)
        && w.y >= f.y && w.y <= f.y + (f.height || 0)) {
        hoverId = f.id;
        break;
      }
    }
    if (hoverId !== hoveredFrameId) setHoveredFrameId(hoverId);
  };

  const handleDragLeave = (e) => {
    // Only clear when leaving the canvas itself (not when crossing
    // into a child element).
    if (e.currentTarget === e.target) setHoveredFrameId(null);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setHoveredFrameId(null);
    // stopPropagation prevents the App-level drop handler (which
    // also saves the dropped file and switches to 'all') from
    // running on top of ours — without this we'd save twice and
    // get bounced out of the board into the masonry view.
    // The trade-off is that the App's onDrop is also the only
    // place that clears its `dragging` state, so we have to do
    // that ourselves via the prop callback or the "Drop to save"
    // overlay stays painted after the drop completes.
    e.stopPropagation();
    onSetAppDragging?.(false);
    const rect = canvasRef.current.getBoundingClientRect();
    const baseWorld = screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
      pan,
      zoom,
    );

    // 1) Internal library drag — a thumbnail dropped from the
    //    BoardLibraryDrawer or a save dragged from the masonry grid.
    const internal = e.dataTransfer.getData('application/x-moodmark-board-save')
      || e.dataTransfer.getData('application/x-moodmark-save-ids');
    if (internal) {
      let saveId = null;
      try {
        const parsed = JSON.parse(internal);
        saveId = Array.isArray(parsed) ? parsed[0] : parsed.saveId || parsed;
      } catch {
        saveId = internal;
      }
      if (saveId) onDropImage?.({ saveId, world: baseWorld });
      return;
    }

    // 2) External image files (Finder, Photos, any OS-level drop).
    //    Save each through the standard library pipeline so the
    //    save:created notification fires and the masonry / library
    //    drawer pick it up automatically; in the meantime we drop
    //    the returned record straight onto the canvas.
    const files = [...e.dataTransfer.files].filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length > 0) {
      let world = baseWorld;
      let savedCount = 0;
      for (const file of files) {
        try {
          const record = await window.moodmark.saves.dropFile(file);
          if (record?.id) {
            onDropImage?.({ saveRecord: record, world });
            savedCount += 1;
            // Cascade subsequent drops down-and-right so a
            // multi-file drop doesn't pile up at one point.
            world = { x: world.x + 24, y: world.y + 24 };
          }
        } catch (err) {
          console.error('Board drop file failed:', err);
        }
      }
      if (savedCount > 0) onExternalImageSaved?.(savedCount);
      return;
    }

    // 3) External image URLs (a drag from a browser tab).
    const urls = extractDropImageUrls(e.dataTransfer);
    if (urls.length > 0) {
      try {
        const record = await window.moodmark.saves.dropUrl(urls);
        if (record?.id) {
          onDropImage?.({ saveRecord: record, world: baseWorld });
          onExternalImageSaved?.(1);
        }
      } catch (err) {
        console.error('Board drop URL failed:', err);
      }
    }
  };

  return (
    <div
      ref={canvasRef}
      className={[
        styles.canvas,
        isPanning && styles.canvasPanning,
        tool === 'text' && styles.canvasTextTool,
        tool === 'sticky' && styles.canvasStickyTool,
        tool === 'shape' && styles.canvasShapeTool,
        (tool === 'frame' || tool === 'arrow') && styles.canvasCrosshairTool,
      ].filter(Boolean).join(' ')}
      style={{
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
      onMouseDown={handleCanvasMouseDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className={styles.world}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          // --board-zoom cascades to every item underneath so the
          // selection chrome (outline + corner handles + marquee
          // border) can divide its dimensions by zoom and stay at
          // constant screen size.
          '--board-zoom': zoom,
        }}
      >
        {lassoRect && (
          <div
            className={styles.marquee}
            style={{
              left: lassoRect.x1,
              top: lassoRect.y1,
              width: Math.max(0, lassoRect.x2 - lassoRect.x1),
              height: Math.max(0, lassoRect.y2 - lassoRect.y1),
            }}
          />
        )}
        {frameDrawPreview && (
          <div
            className={styles.framePreview}
            style={{
              left: Math.min(frameDrawPreview.x1, frameDrawPreview.x2),
              top: Math.min(frameDrawPreview.y1, frameDrawPreview.y2),
              width: Math.abs(frameDrawPreview.x2 - frameDrawPreview.x1),
              height: Math.abs(frameDrawPreview.y2 - frameDrawPreview.y1),
            }}
          />
        )}
        {snapHint && (
          // Long line through the snap anchor in the locked axis.
          // 20000 world px each direction is plenty to extend past
          // the visible canvas at any reasonable zoom; the stroke
          // counter-zooms via --board-zoom so it stays 1px on screen.
          <div
            className={snapHint.axis === 'h' ? styles.snapLineH : styles.snapLineV}
            style={
              snapHint.axis === 'h'
                ? {
                    left: snapHint.anchorX - 20000,
                    top: snapHint.anchorY,
                    width: 40000,
                  }
                : {
                    left: snapHint.anchorX,
                    top: snapHint.anchorY - 20000,
                    height: 40000,
                  }
            }
          />
        )}
        {moveSnapGuides.map((g, i) => (
          <div
            key={i}
            className={g.axis === 'h' ? styles.snapLineH : styles.snapLineV}
            style={
              g.axis === 'h'
                ? { left: g.anchorX - 20000, top: g.anchorY, width: 40000 }
                : { left: g.anchorX, top: g.anchorY - 20000, height: 40000 }
            }
          />
        ))}
        {arrowDrawPreview && (() => {
          // Live preview while the user drags out an arrow — same
          // bbox math as a committed arrow so the preview matches
          // exactly what will be persisted on mouseup.
          const minX = Math.min(arrowDrawPreview.x1, arrowDrawPreview.x2) - ARROW_BBOX_PAD;
          const minY = Math.min(arrowDrawPreview.y1, arrowDrawPreview.y2) - ARROW_BBOX_PAD;
          const maxX = Math.max(arrowDrawPreview.x1, arrowDrawPreview.x2) + ARROW_BBOX_PAD;
          const maxY = Math.max(arrowDrawPreview.y1, arrowDrawPreview.y2) + ARROW_BBOX_PAD;
          const w = maxX - minX;
          const h = maxY - minY;
          const x1 = arrowDrawPreview.x1 - minX;
          const y1 = arrowDrawPreview.y1 - minY;
          const x2 = arrowDrawPreview.x2 - minX;
          const y2 = arrowDrawPreview.y2 - minY;
          const isElbow = arrowKind === 'elbow';
          const showHead = arrowKind !== 'line';
          return (
            <div
              className={styles.arrowPreview}
              style={{ left: minX, top: minY, width: w, height: h }}
            >
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${w} ${h}`}
                preserveAspectRatio="none"
                style={{ overflow: 'visible' }}
              >
                <defs>
                  <marker
                    id="arrowhead-preview"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    markerUnits="strokeWidth"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                  </marker>
                </defs>
                {isElbow ? (
                  <path
                    d={`M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    markerEnd={showHead ? 'url(#arrowhead-preview)' : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    markerEnd={showHead ? 'url(#arrowhead-preview)' : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
            </div>
          );
        })()}
        {items.map((item) => (
          <BoardItem
            key={item.id}
            item={item}
            saves={saves}
            selected={selectedIds.has(item.id)}
            multiSelected={selectedIds.size > 1 && selectedIds.has(item.id)}
            editing={editingItemId === item.id}
            dropHover={hoveredFrameId === item.id}
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
            onContextMenu={onItemContextMenu}
          />
        ))}

        {groupBbox && (
          <div
            className={styles.groupBbox}
            style={{
              left: groupBbox.x,
              top: groupBbox.y,
              width: groupBbox.w,
              height: groupBbox.h,
            }}
          >
            <SelectionHandles onResizeStart={handleGroupResizeStart} />
          </div>
        )}

        {/* Arrow handles: open-circle endpoints at the path's first
            and last vertex, filled-disc handles at internal vertices
            (drag to move that vertex), and filled-disc midpoint
            handles between consecutive vertices (drag to insert a
            new vertex, bending the line). All rendered in world
            coords inside .world; counter-zoom-scaled CSS keeps them
            constant on screen regardless of canvas zoom. */}
        {selectedIds.size === 1 && (() => {
          const id = Array.from(selectedIds)[0];
          const it = items.find((x) => x.id === id);
          if (!it || it.type !== 'arrow' || it.data?.locked) return null;
          // Suppress the handles while the user is dragging the
          // whole arrow around — they obscure the line and feel
          // jittery. They reappear on mouseup.
          if (arrowMovingId === it.id) return null;
          const points = getArrowPoints(it);
          const startVertexDrag = (vertexIdx) => (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            arrowEndpointState.current = { itemId: it.id, vertexIdx };
            // The window mousemove handler will fire onItemsChange
            // with persist:false on the first move; BoardView's
            // handleItemsChange auto-pushes history on the first
            // such call per gesture, so no manual snapshot needed.
          };
          // Midpoint drag inserts a new vertex at the click position
          // between segIdx and segIdx+1 immediately, then arms a
          // vertex-drag on the new index so the cursor stays
          // attached and follow-up mousemove keeps reshaping.
          const startMidpointDrag = (segIdx) => (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            const cur = screenToWorld(
              e.clientX - rect.left,
              e.clientY - rect.top,
              pan,
              zoom,
            );
            const oldPoints = getArrowPoints(it);
            const newPoints = [
              ...oldPoints.slice(0, segIdx + 1),
              { x: cur.x, y: cur.y },
              ...oldPoints.slice(segIdx + 1),
            ];
            const bbox = arrowBboxFromPoints(newPoints);
            const updated = items.map((x) => x.id === it.id
              ? { ...x, x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height, data: { ...(x.data || {}), points: newPoints } }
              : x);
            // Auto-snapshot via handleItemsChange's first-move flag.
            onItemsChange(updated, { movingIds: [it.id], persist: false });
            arrowEndpointState.current = { itemId: it.id, vertexIdx: segIdx + 1 };
          };

          const handles = [];
          points.forEach((p, i) => {
            const isEnd = i === 0 || i === points.length - 1;
            handles.push(
              <span
                key={`v-${i}`}
                className={isEnd ? styles.arrowEndpoint : styles.arrowMidpoint}
                style={{ position: 'absolute', left: p.x, top: p.y }}
                onMouseDown={startVertexDrag(i)}
              />,
            );
          });
          // Midpoints between consecutive points.
          for (let i = 0; i < points.length - 1; i += 1) {
            const mx = (points[i].x + points[i + 1].x) / 2;
            const my = (points[i].y + points[i + 1].y) / 2;
            handles.push(
              <span
                key={`m-${i}`}
                className={styles.arrowMidpointInsert}
                style={{ position: 'absolute', left: mx, top: my }}
                onMouseDown={startMidpointDrag(i)}
              />,
            );
          }
          return handles;
        })()}
      </div>
    </div>
  );
}
