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
  Settings as SettingsLucide,
  HelpCircle,
  Keyboard,
  Megaphone,
  Plus,
  Library as LibraryIcon,
  Folder as FolderIcon,
  Layers as LayersIcon,
} from 'lucide-react';
import styles from './Toolbar.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import ThemeToggle from './ThemeToggle.jsx';
import LibrarySwitcher from './LibrarySwitcher.jsx';

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

// Bare-glyph search field. Collapsed = just a magnifying glass.
// Click the glyph (or focus via Tab) → the input becomes typeable
// inline, no surrounding container, no placeholder, no shortcuts,
// no recents popup. Blur with empty query collapses back to the
// glyph; Escape clears + collapses in one step.
function SearchField({
  search,
  onSearchChange,
  searchInputRef,
  onRecordSearch,
}) {
  const [expanded, setExpanded] = useState(!!search);
  const wrapRef = useRef(null);

  // External edits to `search` (e.g. quick switcher) should also
  // force the field open so the user sees the active query.
  useEffect(() => {
    if (search && !expanded) setExpanded(true);
  }, [search, expanded]);

  return (
    <div
      ref={wrapRef}
      className={[styles.searchWrap, !expanded && styles.searchWrapCollapsed]
        .filter(Boolean)
        .join(' ')}
      data-onboarding="search"
      onClick={(e) => {
        if (expanded) return;
        // Clicking the collapsed pill expands it + focuses the input.
        e.stopPropagation();
        setExpanded(true);
        requestAnimationFrame(() => searchInputRef?.current?.focus());
      }}
    >
      <span className={styles.searchIcon}>
        <SearchIcon />
      </span>
      <input
        ref={searchInputRef}
        className={styles.search}
        type="search"
        placeholder=""
        aria-label="Search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onFocus={() => setExpanded(true)}
        onBlur={() => {
          // Record the search after a successful "completed" search:
          // the user typed something and is moving on.
          if (search && search.trim()) {
            onRecordSearch?.(search);
          } else {
            // No query → collapse the pill back to the icon.
            setExpanded(false);
          }
        }}
        onKeyDown={(e) => {
          // Escape always exits the field. When the input is empty
          // we just blur; when it has content we clear-then-blur on
          // a single keystroke (native <input type="search"> only
          // clears, leaving focus behind).
          if (e.key === 'Escape') {
            if (search) onSearchChange('');
            e.currentTarget.blur();
            setExpanded(false);
          }
        }}
      />
      {expanded && search && (
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
          <LucideX size={11} strokeWidth={2.4} aria-hidden="true" />
        </button>
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
// User-facing label "Spaces" replaces "Boards" — friendlier word
// for the same canvas concept. Internal identifier stays as
// 'boards' so the DB / IPC / view-state layer doesn't have to
// migrate; this is purely a relabel at the surface.
const MODE_SEGMENTS = [
  { id: 'library', label: 'Library', Icon: LibraryIcon },
  { id: 'folders', label: 'Folders', Icon: FolderIcon  },
  { id: 'boards',  label: 'Spaces',  Icon: LayersIcon  },
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

function ModePill({ mode, onModeChange, compact = false }) {
  const activeIndex = Math.max(0, MODE_SEGMENTS.findIndex((s) => s.id === mode));
  return (
    <div
      className={[styles.modePill, compact && styles.modePillCompact]
        .filter(Boolean)
        .join(' ')}
      role="tablist"
      aria-label="App mode"
    >
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
          <span className={styles.modeSegmentIcon} aria-hidden="true">
            <seg.Icon size={16} strokeWidth={2} />
          </span>
          <span className={styles.modeSegmentLabel}>{seg.label}</span>
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
  modePillCompact = false,
  onOpenSettings,
  onOpenShortcuts,
  onOpenReleaseNotes,
  releaseNotesUnseen = false,
  libraries,
  activeLibraryId,
  onSwitchLibrary,
  onCreateLibrary,
  onRenameLibrary,
  onDeleteLibrary,
  onManageLibraries,
  onUpload,
}) {
  // Slider is inverted so dragging right = bigger cards = fewer columns.
  const sliderValue = COLS_MAX + COLS_MIN - columns;
  return (
    <div
      className={[styles.toolbar, modePillCompact && styles.toolbarScrolled]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.left}>
        <span className={styles.brand} aria-hidden="true">
          {/* Minimal triangle brand mark — placeholder for the
              eventual GatherOS logo. Sized to read as ink at the
              leftmost edge of the toolbar without competing with
              the library switcher beside it. */}
          <svg viewBox="0 0 16 14" width="22" height="20" aria-hidden="true">
            <path d="M8 0 L16 14 L0 14 Z" fill="currentColor" />
          </svg>
        </span>
        {Array.isArray(libraries) && libraries.length > 0 && (
          <div className={styles.librarySwitcherSlot}>
            <LibrarySwitcher
              libraries={libraries}
              activeId={activeLibraryId}
              onSwitch={onSwitchLibrary}
              onCreate={onCreateLibrary}
              onOpenManage={onManageLibraries}
            />
          </div>
        )}
        <SearchField
          search={search}
          onSearchChange={onSearchChange}
          searchInputRef={searchInputRef}
          onRecordSearch={onRecordSearch}
        />
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
      </div>

      <ModePill mode={mode} onModeChange={onModeChange} compact={modePillCompact} />

      <div className={styles.right}>
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
        {onUpload && (
          <button
            type="button"
            className={[styles.addBtn, modePillCompact && styles.addBtnCompact]
              .filter(Boolean)
              .join(' ')}
            onClick={onUpload}
            title="Add image"
            aria-label="Add image"
          >
            <span className={styles.addBtnIcon} aria-hidden="true">
              <Plus strokeWidth={1.8} />
            </span>
            <span className={styles.addBtnLabel}>Add</span>
          </button>
        )}
      </div>
    </div>
  );
}
