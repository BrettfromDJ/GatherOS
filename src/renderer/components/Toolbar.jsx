import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Sparkles,
  PanelLeft,
  ChevronLeft,
  Grid3x3,
  LayoutGrid,
  AlignJustify,
  LayoutDashboard,
  X as LucideX,
  Clock as LucideClock,
  Settings as SettingsLucide,
  HelpCircle,
  Keyboard,
  Megaphone,
} from 'lucide-react';
import styles from './Toolbar.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import ThemeToggle from './ThemeToggle.jsx';

// Lucide-backed icon shims. Wrapping each Lucide component in a tiny
// named function keeps every existing call site untouched and lets
// the existing CSS (.iconBtn svg, .layoutBtn svg, etc.) size them
// without per-call `size={...}` props.
const ICON = { strokeWidth: 1.6, 'aria-hidden': true };
const SearchIcon = () => <Search {...ICON} />;
const SearchSparkleIcon = () => <Sparkles {...ICON} fill="currentColor" />;
const SidebarIcon = () => <PanelLeft {...ICON} />;
const BackChevronIcon = () => <ChevronLeft {...ICON} strokeWidth={2} />;
const SettingsIcon = () => <SettingsLucide {...ICON} />;
const HelpIcon = () => <HelpCircle {...ICON} />;
const KeyboardIcon = () => <Keyboard {...ICON} />;
const MegaphoneIcon = () => <Megaphone {...ICON} />;
const GridSmallIcon = () => <Grid3x3 className={styles.zoomIcon} {...ICON} />;
// Match the sidebar's "All" affordance (also LayoutGrid) so the
// grid-layout button reads as "this is the grid/all view."
const MasonryIcon = () => <LayoutGrid {...ICON} />;
const ListViewIcon = () => <AlignJustify {...ICON} />;
const GridLargeIcon = () => <LayoutGrid className={styles.zoomIcon} {...ICON} />;

// Search input + clear-X + recent-searches dropdown. Pulled into its
// own component so the focus/blur/dropdown state stays local and
// doesn't churn the rest of the Toolbar's render tree.
function SearchField({
  search,
  onSearchChange,
  searchInputRef,
  semanticSearchActive,
  onOpenQuickSwitcher,
  recentSearches,
  onRecordSearch,
  onClearRecentSearches,
}) {
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef(null);
  const dropdownRef = useRef(null);
  // Mirrors the input's bounding rect so the portaled dropdown can
  // align under it. Recomputed on focus, on window resize, and on
  // scroll — covers every case where the input visually moves.
  const [anchorRect, setAnchorRect] = useState(null);

  useLayoutEffect(() => {
    if (!focused) {
      setAnchorRect(null);
      return undefined;
    }
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setAnchorRect({ left: r.left, bottom: r.bottom, width: r.width });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [focused]);

  // Close the dropdown if the user clicks outside the input wrapper
  // OR outside the portaled dropdown. The blur listener handles
  // tabbing out; this catches clicks on grid cards / sidebar / etc.
  // that don't shift focus through the browser's blur path.
  useEffect(() => {
    if (!focused) return;
    function onPointerDown(e) {
      const inWrap = wrapRef.current && wrapRef.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inWrap && !inDropdown) {
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [focused]);

  const showRecents = focused && !search && recentSearches.length > 0;
  const showClearX = !!search;

  function applyRecent(term) {
    onSearchChange(term);
    setFocused(false);
    searchInputRef?.current?.focus();
  }

  return (
    <div
      ref={wrapRef}
      className={styles.searchWrap}
      data-onboarding="search"
    >
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
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // Record the search after a successful "completed" search:
          // the user typed something and is moving on. The recents
          // dropdown handler closes the popover separately, so we
          // don't fight with click-on-recent.
          if (search && search.trim()) onRecordSearch?.(search);
        }}
        onKeyDown={(e) => {
          // Escape always exits the field. When the input is empty
          // we just blur; when it has content we clear-then-blur on
          // a single keystroke (native <input type="search"> only
          // clears, leaving focus behind).
          if (e.key === 'Escape') {
            if (search) onSearchChange('');
            e.currentTarget.blur();
            setFocused(false);
          }
        }}
      />

      {showClearX && (
        <button
          type="button"
          className={styles.clearSearchBtn}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onSearchChange('');
            searchInputRef?.current?.focus();
          }}
          title="Clear search"
          aria-label="Clear search"
        >
          <LucideX size={12} strokeWidth={2.2} aria-hidden="true" />
        </button>
      )}

      {!showClearX && onOpenQuickSwitcher && (
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

      {showRecents && anchorRect && createPortal(
        <div
          ref={dropdownRef}
          className={styles.recentsDropdown}
          role="listbox"
          style={{
            left: anchorRect.left,
            top: anchorRect.bottom + 6,
            width: anchorRect.width,
          }}
        >
          <div className={styles.recentsHeader}>
            <span>Recent searches</span>
            {onClearRecentSearches && (
              <button
                type="button"
                className={styles.recentsClear}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onClearRecentSearches();
                  searchInputRef?.current?.focus();
                }}
              >
                Clear
              </button>
            )}
          </div>
          {recentSearches.map((term) => (
            <button
              type="button"
              key={term}
              className={styles.recentsItem}
              role="option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyRecent(term)}
            >
              <span className={styles.recentsIcon}>
                <LucideClock size={13} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span className={styles.recentsTerm}>{term}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

const COLS_MIN = 2;
const COLS_MAX = 8;

// Three-segment pill that switches between the app's primary modes.
// Active segment fills with --text-primary (true ink) rather than the
// accent color — keeps it typographic and restrained, matching the
// Geist / fintech-display feel we're aiming for. The sliding thumb
// reuses the layoutThumb easing to stay consistent with the other
// segmented control already in this toolbar.
const MODE_SEGMENTS = [
  { id: 'library', label: 'Library' },
  { id: 'folders', label: 'Folders' },
  { id: 'boards',  label: 'Boards'  },
];

// Anchored popover-menu attached to the toolbar's help icon. Lifted
// from the old sidebar footer; consolidates "What's New" + Settings
// + Shortcuts into a single overflow menu so the toolbar stays
// scannable. Portals to document.body so toolbar overflow:hidden
// doesn't clip it.
function HelpMenu({
  onOpenSettings,
  onOpenShortcuts,
  onOpenReleaseNotes,
  releaseNotesUnseen,
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setAnchor({ top: r.bottom + 6, right: window.innerWidth - r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (
        popRef.current && !popRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) setOpen(false);
    }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false); }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function go(action) {
    return () => {
      setOpen(false);
      action?.();
    };
  }

  if (!onOpenSettings && !onOpenShortcuts && !onOpenReleaseNotes) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.iconBtn} ${open ? styles.iconBtnActive : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Help"
      >
        <HelpIcon />
        {releaseNotesUnseen && (
          <span className={styles.iconBtnDot} aria-hidden="true" />
        )}
      </button>
      {open && anchor && createPortal(
        <div
          ref={popRef}
          role="menu"
          className={styles.helpPopover}
          style={{ top: `${anchor.top}px`, right: `${anchor.right}px` }}
        >
          {onOpenReleaseNotes && (
            <>
              <div className={styles.helpGroupLabel}>Updates</div>
              <button
                type="button"
                role="menuitem"
                className={styles.helpItem}
                onClick={go(onOpenReleaseNotes)}
              >
                <span className={styles.helpItemIcon}><MegaphoneIcon /></span>
                <span className={styles.helpItemLabel}>What's New</span>
                {releaseNotesUnseen && (
                  <span className={styles.helpItemDot} aria-hidden="true" />
                )}
              </button>
            </>
          )}
          {(onOpenSettings || onOpenShortcuts) && (
            <>
              {onOpenReleaseNotes && <div className={styles.helpDivider} />}
              <div className={styles.helpGroupLabel}>Essentials</div>
              {onOpenShortcuts && (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.helpItem}
                  onClick={go(onOpenShortcuts)}
                >
                  <span className={styles.helpItemIcon}><KeyboardIcon /></span>
                  <span className={styles.helpItemLabel}>Shortcuts</span>
                </button>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function ModePill({ mode, onModeChange }) {
  const activeIndex = Math.max(0, MODE_SEGMENTS.findIndex((s) => s.id === mode));
  return (
    <div className={styles.modePill} role="tablist" aria-label="App mode">
      <span
        className={styles.modeThumb}
        style={{ '--mode-thumb-index': activeIndex }}
        aria-hidden="true"
      />
      {MODE_SEGMENTS.map((seg) => (
        <button
          key={seg.id}
          type="button"
          role="tab"
          aria-selected={mode === seg.id}
          className={`${styles.modeSegment} ${mode === seg.id ? styles.modeSegmentActive : ''}`}
          onClick={() => onModeChange(seg.id)}
        >
          {seg.label}
        </button>
      ))}
    </div>
  );
}

export default function Toolbar({
  search,
  onSearchChange,
  recentSearches = [],
  onRecordSearch,
  onClearRecentSearches,
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
  viewIcon = null,
  onBackToAll = null,
  layout = 'masonry',
  onLayoutChange,
  onOpenQuickSwitcher,
  mode = 'library',
  onModeChange = () => {},
  onOpenSettings,
  onOpenShortcuts,
  onOpenReleaseNotes,
  releaseNotesUnseen = false,
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
          <span className={styles.viewTitle} title={viewTitle}>
            {viewIcon && <span className={styles.viewTitleIcon} aria-hidden="true">{viewIcon}</span>}
            {viewTitle}
          </span>
        )}
        <ModePill mode={mode} onModeChange={onModeChange} />
      </div>

      <SearchField
        search={search}
        onSearchChange={onSearchChange}
        searchInputRef={searchInputRef}
        semanticSearchActive={semanticSearchActive}
        onOpenQuickSwitcher={onOpenQuickSwitcher}
        recentSearches={recentSearches}
        onRecordSearch={onRecordSearch}
        onClearRecentSearches={onClearRecentSearches}
      />

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
        <div className={styles.iconCluster}>
          <ThemeToggle className={styles.iconBtn} />
          {onOpenSettings && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onOpenSettings}
              title="Settings"
              aria-label="Settings"
            >
              <SettingsIcon />
            </button>
          )}
          <HelpMenu
            onOpenSettings={onOpenSettings}
            onOpenShortcuts={onOpenShortcuts}
            onOpenReleaseNotes={onOpenReleaseNotes}
            releaseNotesUnseen={releaseNotesUnseen}
          />
        </div>
      </div>
    </div>
  );
}
