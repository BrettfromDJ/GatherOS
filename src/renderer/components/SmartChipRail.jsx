import React from 'react';
import {
  ChevronLeft, Grid2x2, Square, Images, Inbox, Trash2,
  Clock, History, ArrowDownAZ, ArrowDownZA,
  Type, Image as ImageIcon, Film,
} from 'lucide-react';
import styles from './SmartChipRail.module.css';
import Dropdown from './Dropdown.jsx';

// X logomark, drawn as a filled glyph that matches the lucide icon API
// (takes a `size`) so it can slot into the chip list. Bookmarks come
// from X, so the tab uses the X mark rather than a generic bookmark.
// The mark fills its viewBox edge-to-edge while lucide icons carry
// internal padding, so render it at ~82% to match their visual height.
function XGlyph({ size = 17 }) {
  const s = Math.round(size * 0.82);
  return (
    <svg viewBox="0 0 1200 1227" width={s} height={s} fill="currentColor" aria-hidden="true">
      <path d="M714 519L1161 0h-106L667 451 357 0H0l469 682L0 1226h106l410-476 327 476h357L714 519zM569 688l-47-68L144 80h163l305 436 48 68 396 567H892L569 688z" />
    </svg>
  );
}

const CHIPS = [
  { id: 'all',       label: 'All',       Icon: Images },
  { id: 'bookmarks', label: 'Bookmarks', Icon: XGlyph },
  { id: 'unsorted',  label: 'Unsorted',  Icon: Inbox },
  { id: 'trash',     label: 'Trash',     Icon: Trash2 },
];

export const SORT_OPTIONS = [
  { value: 'recent',    label: 'Most recent', Icon: Clock },
  { value: 'oldest',    label: 'Oldest first', Icon: History },
  { value: 'name_asc',  label: 'Name A→Z', Icon: ArrowDownAZ },
  { value: 'name_desc', label: 'Name Z→A', Icon: ArrowDownZA },
];

// Bookmarks tweet-type filter — surfaced as a dropdown beside sort,
// only on the Bookmarks view. Values map 1:1 to tweetTypeOf's output;
// 'all' is the no-op default.
const TYPE_FILTERS = [
  { value: 'all',   label: 'All types', Icon: Images },
  { value: 'text',  label: 'Text',      Icon: Type },
  { value: 'image', label: 'Image',     Icon: ImageIcon },
  { value: 'video', label: 'Video',     Icon: Film },
];

const COLS_MIN = 2;
const COLS_MAX = 8;

// Smart-view sub-menu strip. Three-segment text nav on the left
// (active gets a black underline), a sort-by dropdown and the
// masonry zoom slider clustered on the right. Hairline divider
// underneath separates this row from the grid.
export default function SmartChipRail({
  activeViewType = 'all',
  counts = { all: 0, unsorted: 0, trash: 0 },
  onPick,
  // Bookmarks-only tweet-type sub-filter. The pills merge into this
  // rail's left cluster after the smart-view chips, shown only on the
  // Bookmarks view. onTweetTypeChange absent → pills are hidden.
  tweetTypeFilter = 'all',
  tweetTypeCounts = null,
  onTweetTypeChange = null,
  sortMode = 'recent',
  onSortChange,
  columns,
  onColumnsChange,
  // When the user drills into a folder, the rail's left cluster
  // swaps the All/Unsorted/Trash chips for a back button + folder
  // title. Sort + zoom on the right stay regardless.
  viewTitle = null,
  onBack = null,
  // Optional inline-rename callback. When provided, clicking the
  // viewTitle swaps it for an editable input. Only wired in for
  // collection views — there's no rename for All/Unsorted/Trash.
  onRenameViewTitle = null,
  // Counter bumped by App when a freshly-created collection is opened.
  // Each change drops the title straight into rename mode so the user
  // can name the new collection without an extra click.
  autoRenameSignal = 0,
}) {
  // Inline rename state for the collection title. Click → enter
  // edit mode; Enter / blur commits; Escape cancels.
  const [renaming, setRenaming] = React.useState(false);
  const [renameDraft, setRenameDraft] = React.useState('');
  const titleInputRef = React.useRef(null);
  function startRename() {
    if (!onRenameViewTitle || !viewTitle) return;
    setRenameDraft(viewTitle);
    setRenaming(true);
  }
  async function commitRename() {
    const next = renameDraft.trim();
    setRenaming(false);
    setRenameDraft('');
    if (!next || next === viewTitle) return;
    await onRenameViewTitle?.(next);
  }
  function cancelRename() {
    setRenaming(false);
    setRenameDraft('');
  }
  // Focus + select-all when entering edit mode. The input is always
  // in the tree (so layout doesn't shift on swap), so we can't rely
  // on autoFocus — handle it manually each time renaming flips on.
  React.useEffect(() => {
    if (renaming && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [renaming]);
  // Auto-open rename when App signals a just-created collection. Guarded
  // on the initial 0 so we don't rename on first mount, and on viewTitle
  // so we only fire once the opened collection's title is in place.
  React.useEffect(() => {
    if (autoRenameSignal && onRenameViewTitle && viewTitle) {
      startRename();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRenameSignal]);
  // Slider is inverted so dragging right = bigger cards = fewer columns.
  const sliderValue = (typeof columns === 'number')
    ? COLS_MAX + COLS_MIN - columns
    : COLS_MIN;
  // Show a column-count bubble while hovering / dragging the zoom.
  const [zoomDragging, setZoomDragging] = React.useState(false);
  React.useEffect(() => {
    if (!zoomDragging) return undefined;
    const up = () => setZoomDragging(false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [zoomDragging]);
  // Thumb (14px) centre travels from 7px to (track − 7px); position the
  // bubble over it from the slider's fractional value.
  const zoomPct = (sliderValue - COLS_MIN) / (COLS_MAX - COLS_MIN);
  const inFolder = !!viewTitle;
  return (
    <div className={styles.rail} role={inFolder ? undefined : 'tablist'} aria-label={inFolder ? undefined : 'Smart views'}>
      <div className={styles.left}>
        {inFolder ? (
          <>
            {onBack && (
              <button
                type="button"
                className={styles.backBtn}
                onClick={onBack}
                title="Back to all"
                aria-label="Back to all"
              >
                <ChevronLeft size={18} strokeWidth={1.6} aria-hidden="true" />
              </button>
            )}
            {/* Always render an input — toggling readOnly + value
                source instead of swapping element types means the
                browser never has to relayout, so the title stays
                pinned in place when the user enters/exits edit mode. */}
            <input
              ref={titleInputRef}
              type="text"
              className={`${styles.titleInput}${onRenameViewTitle && !renaming ? ` ${styles.titleInputEditable}` : ''}`}
              value={renaming ? renameDraft : (viewTitle || '')}
              readOnly={!renaming}
              title={onRenameViewTitle && !renaming ? `${viewTitle} — click to rename` : viewTitle || undefined}
              onClick={onRenameViewTitle && !renaming ? startRename : undefined}
              onChange={renaming ? (e) => setRenameDraft(e.target.value) : undefined}
              onBlur={renaming ? commitRename : undefined}
              onKeyDown={(e) => {
                if (renaming) {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                } else if (onRenameViewTitle && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  startRename();
                }
              }}
            />
          </>
        ) : (
          CHIPS.map(({ id, label, Icon }) => {
            const isActive = activeViewType === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
                onClick={() => onPick({ type: id })}
              >
                <span className={styles.chipIcon} aria-hidden="true">
                  <Icon size={17} strokeWidth={1.8} />
                </span>
                <span className={styles.chipLabel}>{label}</span>
              </button>
            );
          })
        )}
      </div>
      <div className={styles.right}>
        {onColumnsChange && (
          <div className={styles.zoom} title="Card size">
            <Grid2x2 className={styles.zoomGlyph} size={13} strokeWidth={1.8} aria-hidden="true" />
            <div
              className={[styles.zoomTrack, zoomDragging && styles.zoomTrackDragging]
                .filter(Boolean)
                .join(' ')}
            >
              <input
                type="range"
                min={COLS_MIN}
                max={COLS_MAX}
                step={1}
                value={sliderValue}
                onChange={(e) =>
                  onColumnsChange(COLS_MAX + COLS_MIN - Number(e.target.value))
                }
                onPointerDown={() => setZoomDragging(true)}
                className={styles.zoomSlider}
                aria-label="Card size"
              />
              {typeof columns === 'number' && (
                <span
                  className={styles.zoomBubble}
                  style={{ left: `calc(7px + ${zoomPct} * (100% - 14px))` }}
                  aria-hidden="true"
                >
                  {columns} columns
                </span>
              )}
            </div>
            <Square className={styles.zoomGlyph} size={13} strokeWidth={1.8} aria-hidden="true" />
          </div>
        )}
        {onSortChange && (
          <Dropdown
            value={sortMode}
            options={SORT_OPTIONS}
            onChange={onSortChange}
            ariaLabel="Sort by"
          />
        )}
        {!inFolder && activeViewType === 'bookmarks' && onTweetTypeChange && (
          <Dropdown
            value={tweetTypeFilter}
            options={TYPE_FILTERS.map((o) => ({
              ...o,
              // Append the live count so each option (and the trigger)
              // reads e.g. "Image · 4". Counts honour an active search.
              label: tweetTypeCounts ? `${o.label} · ${tweetTypeCounts[o.value] ?? 0}` : o.label,
            }))}
            onChange={onTweetTypeChange}
            ariaLabel="Filter by tweet type"
          />
        )}
      </div>
    </div>
  );
}
