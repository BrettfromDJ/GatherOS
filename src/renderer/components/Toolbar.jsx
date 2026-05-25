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
  Compass,
  SquareLibrary as LibraryIcon,
  Folder as FolderIcon,
  Eclipse as LayersIcon,
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
const RediscoverIcon = () => <Compass {...ICON} />;
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
  onOpenQuickSwitcher,
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
        // Collapsed click → open the Quick Switcher (same modal as
        // Cmd+K) so a deliberate click on the icon doesn't mean "use
        // the cramped inline pill". The inline path is still reached
        // via Cmd+F (which focuses the input directly and expands
        // via onFocus below).
        if (typeof onOpenQuickSwitcher === 'function') {
          e.stopPropagation();
          onOpenQuickSwitcher();
        }
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
  { id: 'folders', label: 'Collections', Icon: FolderIcon  },
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
          data-onboarding={`mode-${seg.id}`}
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
  onOpenRediscover,
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
          {/* GatherOS brand mark — gradient tile + foreground glyph
              with soft drop shadow. Fixed colours (not currentColor)
              because this version is a full-colour mark. */}
          <svg width="32" height="32" viewBox="0 0 46 46" style={{ overflow: 'visible' }} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <g clipPath="url(#clip0_23_13)">
              <g filter="url(#filter0_dddd_23_13)">
                <g filter="url(#filter1_i_23_13)">
                  <rect x="4" width="38" height="38" rx="9.87013" fill="url(#paint0_linear_23_13)" />
                </g>
                <g filter="url(#filter2_i_23_13)">
                  <path d="M11.6689 22.9428H17.9518C18.3999 22.9428 18.8695 22.5434 18.8695 21.9496V19.2184C18.8695 18.2522 18.9936 17.5073 19.4902 16.7085C20.0138 15.915 20.7802 15.0676 22.1458 14.9974C23.0635 14.9218 24.008 14.9974 24.8501 15.521C25.9944 16.2173 26.8364 17.3832 26.8364 18.9701C26.8364 20.1144 26.2427 21.3019 25.2711 22.0252C24.6504 22.5218 23.8569 22.9698 22.7612 23.0184H19.7817C19.1879 23.0184 18.8641 23.4178 18.8856 23.936V29.9922C18.8856 30.4618 19.2581 30.8612 19.8033 30.8612H23.1282C24.3697 30.8612 25.7623 30.7101 27.0739 30.2405C30.577 28.999 34.2475 25.8953 35.0193 20.978C35.1165 20.3573 35.1435 19.8121 35.1435 19.1914C35.1705 15.2457 33.2057 11.4673 30.3503 9.50796C28.4881 8.19093 26.3021 7.19776 23.5223 7.07361H19.7979C19.1501 7.07361 18.8802 7.52162 18.8802 7.99121C18.8802 9.08155 19.0206 10.269 18.8263 11.3378C18.4754 13.3025 16.8507 14.965 14.805 14.965H11.5448C11.1238 14.965 10.8269 15.3645 10.8269 15.8341V21.9658C10.8755 22.4138 11.1238 22.932 11.6689 22.932V22.9428Z" fill="url(#paint1_linear_23_13)" />
                </g>
                <mask id="mask0_23_13" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="10" y="7" width="26" height="24">
                  <path d="M11.6689 22.9428H17.9518C18.3999 22.9428 18.8695 22.5434 18.8695 21.9496V19.2184C18.8695 18.2522 18.9936 17.5073 19.4902 16.7085C20.0138 15.915 20.7802 15.0676 22.1458 14.9974C23.0635 14.9218 24.008 14.9974 24.8501 15.521C25.9944 16.2173 26.8364 17.3832 26.8364 18.9701C26.8364 20.1144 26.2427 21.3019 25.2711 22.0252C24.6504 22.5218 23.8569 22.9698 22.7612 23.0184H19.7817C19.1879 23.0184 18.8641 23.4178 18.8856 23.936V29.9922C18.8856 30.4618 19.2581 30.8612 19.8033 30.8612H23.1282C24.3697 30.8612 25.7623 30.7101 27.0739 30.2405C30.577 28.999 34.2475 25.8953 35.0193 20.978C35.1165 20.3573 35.1435 19.8121 35.1435 19.1914C35.1705 15.2457 33.2057 11.4673 30.3503 9.50796C28.4881 8.19093 26.3021 7.19776 23.5223 7.07361H19.7979C19.1501 7.07361 18.8802 7.52162 18.8802 7.99121C18.8802 9.08155 19.0206 10.269 18.8263 11.3378C18.4754 13.3025 16.8507 14.965 14.805 14.965H11.5448C11.1238 14.965 10.8269 15.3645 10.8269 15.8341V21.9658C10.8755 22.4138 11.1238 22.932 11.6689 22.932V22.9428Z" fill="#ADB2B5" />
                </mask>
                <g mask="url(#mask0_23_13)">
                  <g filter="url(#filter3_f_23_13)">
                    <path d="M38.7471 29.4012L18.9467 24.0291L16.9469 25.4131C18.497 30.0565 21.8431 40.0456 22.8266 42.8555C23.8102 45.6653 29.3571 40.94 32.0077 38.2261L38.7471 29.4012Z" fill="#85AABC" />
                  </g>
                  <g filter="url(#filter4_f_23_13)">
                    <path d="M52.0447 13.4661L32.2443 8.09395L26.845 6.99563C37.2786 16.6368 35.1407 24.1105 36.1243 26.9204C37.1078 29.7302 42.6548 25.0049 45.3053 22.2909L52.0447 13.4661Z" fill="#8A71B0" />
                  </g>
                  <g filter="url(#filter5_f_23_13)">
                    <path d="M52.7049 24.9122L32.9044 19.5401L30.9047 20.9241C32.4548 25.5675 35.8009 35.5566 36.7844 38.3665C37.7679 41.1763 43.3149 36.451 45.9654 33.737L52.7049 24.9122Z" fill="#BBB58D" />
                  </g>
                  <g filter="url(#filter6_f_23_13)">
                    <path d="M18.6124 22.9322L10.9523 14.6558H9.5435C8.75108 17.1358 7.05177 22.4744 6.59392 23.9888C6.13608 25.5032 10.3359 25.1187 12.4931 24.7372L18.6124 22.9322Z" fill="#85AABC" />
                  </g>
                </g>
              </g>
            </g>
            <defs>
              <filter id="filter0_dddd_23_13" x="-3" y="-1" width="52" height="63" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
                <feOffset dy="1" />
                <feGaussianBlur stdDeviation="1" />
                <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.12 0" />
                <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_23_13" />
                <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
                <feOffset dy="4" />
                <feGaussianBlur stdDeviation="2" />
                <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.11 0" />
                <feBlend mode="normal" in2="effect1_dropShadow_23_13" result="effect2_dropShadow_23_13" />
                <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
                <feOffset dy="9" />
                <feGaussianBlur stdDeviation="3" />
                <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.06 0" />
                <feBlend mode="normal" in2="effect2_dropShadow_23_13" result="effect3_dropShadow_23_13" />
                <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
                <feOffset dy="17" />
                <feGaussianBlur stdDeviation="3.5" />
                <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0" />
                <feBlend mode="normal" in2="effect3_dropShadow_23_13" result="effect4_dropShadow_23_13" />
                <feBlend mode="normal" in="SourceGraphic" in2="effect4_dropShadow_23_13" result="shape" />
              </filter>
              <filter id="filter1_i_23_13" x="4" y="0" width="38.2468" height="38.1645" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
                <feOffset dx="0.246753" dy="0.164502" />
                <feGaussianBlur stdDeviation="0.164502" />
                <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
                <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0" />
                <feBlend mode="normal" in2="shape" result="effect1_innerShadow_23_13" />
              </filter>
              <filter id="filter2_i_23_13" x="10.8269" y="7.07361" width="24.3169" height="24.4039" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
                <feOffset dy="0.616331" />
                <feGaussianBlur stdDeviation="0.308166" />
                <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
                <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0" />
                <feBlend mode="normal" in2="shape" result="effect1_innerShadow_23_13" />
              </filter>
              <filter id="filter3_f_23_13" x="14.5697" y="21.6518" width="26.5546" height="24.4433" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                <feGaussianBlur stdDeviation="1.18864" result="effect1_foregroundBlur_23_13" />
              </filter>
              <filter id="filter4_f_23_13" x="24.4677" y="4.61833" width="29.9543" height="25.5417" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                <feGaussianBlur stdDeviation="1.18864" result="effect1_foregroundBlur_23_13" />
              </filter>
              <filter id="filter5_f_23_13" x="28.5275" y="17.1628" width="26.5546" height="24.4433" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                <feGaussianBlur stdDeviation="1.18864" result="effect1_foregroundBlur_23_13" />
              </filter>
              <filter id="filter6_f_23_13" x="4.18205" y="12.2785" width="16.8075" height="15.1795" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                <feGaussianBlur stdDeviation="1.18864" result="effect1_foregroundBlur_23_13" />
              </filter>
              <linearGradient id="paint0_linear_23_13" x1="23" y1="0" x2="23" y2="38" gradientUnits="userSpaceOnUse">
                <stop stopColor="#3F3F3F" />
                <stop offset="1" />
              </linearGradient>
              <linearGradient id="paint1_linear_23_13" x1="22.9853" y1="7.07361" x2="22.9853" y2="30.8612" gradientUnits="userSpaceOnUse">
                <stop stopColor="#ADB2B5" />
                <stop offset="1" stopColor="#ADB2B5" />
              </linearGradient>
              <clipPath id="clip0_23_13">
                <rect width="46" height="58" fill="white" />
              </clipPath>
            </defs>
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
          onOpenQuickSwitcher={onOpenQuickSwitcher}
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
        {onOpenRediscover && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onOpenRediscover}
            title="Rediscover (⌘⇧R)"
            aria-label="Rediscover"
          >
            <RediscoverIcon />
          </button>
        )}
        <span data-onboarding="theme-toggle" style={{ display: 'inline-flex' }}>
          <ThemeToggle className={styles.iconBtn} />
        </span>
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
