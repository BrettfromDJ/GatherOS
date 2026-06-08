import React from 'react';
import { ChevronLeft, Grid2x2, Square, LayoutGrid, Inbox, Trash2 } from 'lucide-react';
import styles from './SmartChipRail.module.css';
import Dropdown from './Dropdown.jsx';

const CHIPS = [
  { id: 'all',      label: 'All',      Icon: LayoutGrid, color: 'var(--icon-blue)' },
  { id: 'unsorted', label: 'Unsorted', Icon: Inbox,      color: 'var(--icon-yellow)' },
  { id: 'trash',    label: 'Trash',    Icon: Trash2,     color: 'var(--text-tertiary)' },
];

export const SORT_OPTIONS = [
  { value: 'recent',    label: 'Most recent' },
  { value: 'oldest',    label: 'Oldest first' },
  { value: 'name_asc',  label: 'Name A→Z' },
  { value: 'name_desc', label: 'Name Z→A' },
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
          CHIPS.map(({ id, label, Icon, color }) => {
            const isActive = activeViewType === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
                style={{ '--chip-color': color }}
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
      </div>
    </div>
  );
}
