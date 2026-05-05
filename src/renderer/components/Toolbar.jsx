import React from 'react';
import {
  Search,
  Sparkles,
  PanelLeft,
  ChevronLeft,
  Grid3x3,
  LayoutGrid,
  AlignJustify,
  LayoutDashboard,
} from 'lucide-react';
import styles from './Toolbar.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Lucide-backed icon shims. Wrapping each Lucide component in a tiny
// named function keeps every existing call site untouched and lets
// the existing CSS (.iconBtn svg, .layoutBtn svg, etc.) size them
// without per-call `size={...}` props.
const ICON = { strokeWidth: 1.6, 'aria-hidden': true };
const SearchIcon = () => <Search {...ICON} />;
const SearchSparkleIcon = () => <Sparkles {...ICON} fill="currentColor" />;
const SidebarIcon = () => <PanelLeft {...ICON} />;
const BackChevronIcon = () => <ChevronLeft {...ICON} strokeWidth={2} />;
const GridSmallIcon = () => <Grid3x3 className={styles.zoomIcon} {...ICON} />;
const MasonryIcon = () => <LayoutDashboard {...ICON} />;
const ListViewIcon = () => <AlignJustify {...ICON} />;
const GridLargeIcon = () => <LayoutGrid className={styles.zoomIcon} {...ICON} />;

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
  similarTo = null,
  onClearSimilar,
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

      <div className={styles.searchWrap} data-onboarding="search">
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
            title="Quick switcher — jump to any folder, tag, or save"
          >
            <span className={styles.qkChipKey}>⌘</span>
            <span className={styles.qkChipKey}>K</span>
          </button>
        )}
      </div>

      <div className={styles.right}>
        {similarTo && (
          <button
            type="button"
            className={styles.colorChip}
            onClick={onClearSimilar}
            title="Clear find-similar filter"
          >
            <img
              className={styles.similarChipThumb}
              src={fileUrl(similarTo.thumb_path || similarTo.file_path)}
              alt=""
              draggable={false}
            />
            <span className={styles.colorChipLabel}>Similar</span>
            <span className={styles.colorChipX} aria-hidden="true">×</span>
          </button>
        )}

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
            <span
              aria-hidden="true"
              className={styles.layoutThumb}
              data-pos={layout === 'list' ? 'list' : 'masonry'}
            />
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
