import React from 'react';
import styles from './Toolbar.module.css';

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.4" y1="10.4" x2="13.5" y2="13.5" />
    </svg>
  );
}

function SearchSparkleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5l1.2 3.3L12.5 6 9.2 7.2 8 10.5 6.8 7.2 3.5 6l3.3-1.2z" />
      <path d="M12.8 9.4l0.55 1.5 1.45 0.55-1.45 0.55-0.55 1.5-0.55-1.5-1.45-0.55 1.45-0.55z" opacity="0.7" />
    </svg>
  );
}

function SidebarIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <line x1="6" y1="3" x2="6" y2="13" />
    </svg>
  );
}

// Tall, narrow chevron — width:height ≈ 1:2 so it doesn't read as
// horizontally stretched the way the previous flat chevron did.
function BackChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 3 L4.5 8 L9.5 13" />
    </svg>
  );
}

function GridSmallIcon() {
  return (
    <svg className={styles.zoomIcon} viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="2"  y="2"  width="2.5" height="2.5" rx="0.5" />
      <rect x="6"  y="2"  width="2.5" height="2.5" rx="0.5" />
      <rect x="10" y="2"  width="2.5" height="2.5" rx="0.5" />
      <rect x="2"  y="6"  width="2.5" height="2.5" rx="0.5" />
      <rect x="6"  y="6"  width="2.5" height="2.5" rx="0.5" />
      <rect x="10" y="6"  width="2.5" height="2.5" rx="0.5" />
      <rect x="2"  y="10" width="2.5" height="2.5" rx="0.5" />
      <rect x="6"  y="10" width="2.5" height="2.5" rx="0.5" />
      <rect x="10" y="10" width="2.5" height="2.5" rx="0.5" />
    </svg>
  );
}

function MasonryIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="2"  y="2"  width="5.5" height="7"   rx="1" />
      <rect x="8.5" y="2"  width="5.5" height="4.5" rx="1" />
      <rect x="2"  y="10.5" width="5.5" height="3.5" rx="1" />
      <rect x="8.5" y="8"  width="5.5" height="6"   rx="1" />
    </svg>
  );
}

function ListViewIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <line x1="2.5" y1="4"  x2="13.5" y2="4" />
      <line x1="2.5" y1="8"  x2="13.5" y2="8" />
      <line x1="2.5" y1="12" x2="13.5" y2="12" />
    </svg>
  );
}

function GridLargeIcon() {
  return (
    <svg className={styles.zoomIcon} viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="4.5" height="4.5" rx="0.75" />
      <rect x="7.5" y="2" width="4.5" height="4.5" rx="0.75" />
      <rect x="2" y="7.5" width="4.5" height="4.5" rx="0.75" />
      <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="0.75" />
    </svg>
  );
}

const COLS_MIN = 2;
const COLS_MAX = 8;

export default function Toolbar({
  search,
  onSearchChange,
  columns,
  onColumnsChange,
  onToggleSidebar,
  semanticSearchActive = false,
  colorFilter = null,
  onClearColorFilter,
  searchInputRef,
  viewTitle = null,
  onBackToAll = null,
  layout = 'masonry',
  onLayoutChange,
  onOpenQuickSwitcher,
}) {
  // Slider is inverted so dragging right = bigger cards = fewer columns.
  const sliderValue = COLS_MAX + COLS_MIN - columns;
  return (
    <div className={styles.toolbar}>
      <div className={styles.left}>
        {onToggleSidebar && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onToggleSidebar}
            title="Toggle sidebar"
          >
            <SidebarIcon />
          </button>
        )}
        {onBackToAll && (
          <button
            type="button"
            className={styles.backBtn}
            onClick={onBackToAll}
            title="Back to All"
            aria-label="Back to All"
          >
            <BackChevronIcon />
          </button>
        )}
        {viewTitle && (
          <span className={styles.viewTitle} title={viewTitle}>{viewTitle}</span>
        )}
      </div>

      <div className={styles.searchWrap}>
        <span
          className={[styles.searchIcon, semanticSearchActive && styles.searchIconAi]
            .filter(Boolean)
            .join(' ')}
          title={semanticSearchActive ? 'Visual search (AI)' : undefined}
        >
          {semanticSearchActive ? <SearchSparkleIcon /> : <SearchIcon />}
        </span>
        <input
          ref={searchInputRef}
          className={styles.search}
          type="search"
          placeholder={semanticSearchActive ? 'Describe what you’re looking for…' : 'Search by title or tag'}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            // Escape always exits the field. When the input is empty
            // we just blur; when it has content we clear-then-blur on
            // a single keystroke (native <input type="search"> only
            // clears, leaving focus behind).
            if (e.key === 'Escape') {
              if (search) onSearchChange('');
              e.currentTarget.blur();
            }
          }}
        />
        {onOpenQuickSwitcher && (
          <button
            type="button"
            className={styles.qkChip}
            onClick={onOpenQuickSwitcher}
            title="Quick switcher — jump to any bucket, tag, or save"
          >
            <span className={styles.qkChipKey}>⌘</span>
            <span className={styles.qkChipKey}>K</span>
          </button>
        )}
      </div>

      <div className={styles.right}>
        {colorFilter && (
          <button
            type="button"
            className={styles.colorChip}
            onClick={onClearColorFilter}
            title="Clear color filter"
          >
            <span className={styles.colorChipDot} style={{ background: colorFilter }} />
            <span className={styles.colorChipLabel}>{colorFilter.toUpperCase()}</span>
            <span className={styles.colorChipX} aria-hidden="true">×</span>
          </button>
        )}

        {/* Card-size slider always occupies its slot. In list view we
            keep the layout reserved (visibility: hidden) so the
            layout toggle to its right stays anchored at the same x
            position when switching modes. */}
        <div
          className={styles.zoom}
          title="Card size"
          style={{ visibility: layout === 'masonry' ? 'visible' : 'hidden' }}
          aria-hidden={layout !== 'masonry'}
        >
          <GridSmallIcon />
          <input
            type="range"
            min={COLS_MIN}
            max={COLS_MAX}
            step={1}
            value={sliderValue}
            onChange={(e) =>
              onColumnsChange(COLS_MAX + COLS_MIN - Number(e.target.value))
            }
            className={styles.slider}
            aria-label="Card size"
            tabIndex={layout === 'masonry' ? 0 : -1}
          />
          <GridLargeIcon />
        </div>

        {onLayoutChange && (
          <div className={styles.layoutToggle} role="group" aria-label="Layout">
            <button
              type="button"
              className={[styles.layoutBtn, layout === 'masonry' && styles.layoutBtnActive]
                .filter(Boolean).join(' ')}
              onClick={() => onLayoutChange('masonry')}
              title="Masonry"
              aria-pressed={layout === 'masonry'}
            >
              <MasonryIcon />
            </button>
            <button
              type="button"
              className={[styles.layoutBtn, layout === 'list' && styles.layoutBtnActive]
                .filter(Boolean).join(' ')}
              onClick={() => onLayoutChange('list')}
              title="List"
              aria-pressed={layout === 'list'}
            >
              <ListViewIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
