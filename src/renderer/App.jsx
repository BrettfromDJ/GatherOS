import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { morphFocus } from './lib/morphFocus.js';
// CollectionIcon is still re-exported from Sidebar.jsx and used by
// context menus / featured-bucket affordances. Sidebar component
// itself is no longer rendered (removed in nav stage 4d) but lives
// on as the home of these shared icon helpers until Stage 6 cleanup.
import { CollectionIcon } from './components/Sidebar.jsx';
import QuickSwitcher from './components/QuickSwitcher.jsx';
import QuickLookOverlay from './components/QuickLookOverlay.jsx';
import BulkTagPicker from './components/BulkTagPicker.jsx';
import RediscoverMode from './components/RediscoverMode.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import AIUnlockedModal from './components/AIUnlockedModal.jsx';
import SaveUrlModal from './components/SaveUrlModal.jsx';
import PasteToSavePrompt from './components/PasteToSavePrompt.jsx';
import Announcement from './components/Announcement.jsx';
import AddFab from './components/AddFab.jsx';
import WhatsNewModal from './components/WhatsNewModal.jsx';
import SunBlinds from './components/SunBlinds.jsx';
import { pickNotesForUpgrade, RELEASE_NOTES } from './data/releaseNotes.js';
import ShortcutsModal from './components/ShortcutsModal.jsx';
import ConfirmHost from './components/ConfirmHost.jsx';
import Toolbar, { ModePill } from './components/Toolbar.jsx';
import Grid from './components/Grid.jsx';
import FeaturedBuckets from './components/FeaturedBuckets.jsx';
import CollectionDropDock from './components/CollectionDropDock.jsx';
import FolderGrid from './components/FolderGrid.jsx';
import BoardGrid from './components/BoardGrid.jsx';
import SmartChipRail from './components/SmartChipRail.jsx';
import DetailPanelV1 from './components/DetailPanel.jsx';
import DetailPanelV2 from './components/DetailPanelV2.jsx';
// Default back to V1 — V2 (compact + collapse) didn't land. Opt in
// to V2 with localStorage.setItem('moodmark.dev.detailPanel', 'v2').
const DetailPanel = (() => {
  try {
    return localStorage.getItem('moodmark.dev.detailPanel') === 'v2'
      ? DetailPanelV2
      : DetailPanelV1;
  } catch {
    return DetailPanelV1;
  }
})();
import FocusedView from './components/FocusedView.jsx';
import SearchView from './components/SearchView.jsx';
import BoardView from './components/BoardView.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import FocusedSortMode from './components/FocusedSortMode.jsx';
import {
  LayoutDashboard,
  Download,
  X,
  Inbox,
  Trash2,
  RotateCcw,
  Copy,
  MinusCircle,
  ArrowUp,
  Clipboard,
  ExternalLink,
  Hash,
  Share,
  FolderOpen,
  Focus,
} from 'lucide-react';
import { useLibrary } from './hooks/useLibrary.js';
import { useUndoStack } from './hooks/useUndoStack.js';
import { useRecentSearches } from './hooks/useRecentSearches.js';
import { extractDropImageUrls } from './lib/dropUrls.js';
import { fileUrl } from './lib/fileUrl.js';
import { flyToCollection } from './lib/flyToCollection.js';
import { seededShuffle } from './lib/shuffle.js';
import { tweetTypeOf } from './lib/tweetType.js';
import { configureSaveSound, DEFAULT_SAVE_SOUND, playEmptyTrashSound } from './lib/sounds.js';
import OnboardingOverlay from './onboarding/OnboardingOverlay.jsx';
import { useOnboarding, ONBOARDING_DONE_PREF } from './onboarding/OnboardingContext.jsx';
import { EntitlementProvider, requestUpgrade, PENDING_UPGRADE_KEY } from './context/entitlement.jsx';
import UpgradeModal from './components/UpgradeModal.jsx';
import UpgradeBanner from './components/UpgradeBanner.jsx';

// Lucide-backed icon shims. Component names are kept identical to
// the previous inline SVG defs so every existing call site (right-
// click menus, selection bar, focused-view toolbar, etc.) keeps
// working without a sweep.
const ICON = { strokeWidth: 1.6, 'aria-hidden': true };
const BoardExportIcon = () => <LayoutDashboard {...ICON} />;
const DownloadIcon = () => <Download {...ICON} />;
const ClearIcon = () => <X {...ICON} strokeWidth={2} />;
const TrashIcon = () => <Trash2 {...ICON} />;
const InboxIcon = () => <Inbox {...ICON} />;
const RestoreIcon = () => <RotateCcw {...ICON} />;
const SimilarIcon = () => <Copy {...ICON} />;
const MinusCircleIcon = () => <MinusCircle {...ICON} />;
const SortFabIcon = () => <Focus {...ICON} />;
const ClipboardIcon = () => <Clipboard {...ICON} />;
const ExternalLinkIcon = () => <ExternalLink {...ICON} />;
const HashIcon = () => <Hash {...ICON} />;
const ShareIcon = () => <Share {...ICON} />;
const RevealIcon = () => <FolderOpen {...ICON} />;

// Per-view grid scroll memory — so returning to a view (or relaunching
// the app) lands exactly where the user left off instead of jumping to
// the top. Stored as { [viewKey]: scrollTop } in localStorage.
const VIEW_SCROLL_KEY = 'gatherosViewScroll';
function viewKeyOf(v) {
  return v ? `${v.type}:${v.id || ''}` : 'all:';
}
function readViewScroll() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_SCROLL_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export default function App({ entitlement } = {}) {
  const onboarding = useOnboarding();
  // The resolved entitlement (mode paid/trial/free) flows in from
  // AppGate. Default to a permissive value so the app never locks itself
  // if it's rendered without the prop (tests, dev overrides).
  const ent = entitlement || {
    mode: 'trial', paid: false,
    trial: { startedAt: null, endsAt: null, active: true, daysLeft: 14 },
    canCreateSave: true, proUnlocked: true, serverTrialing: false, loading: true,
  };
  // Pro features (boards, multiple libraries, AI) are locked only in the
  // free tier. Primitive so handlers can depend on it without churning.
  const proLocked = ent.mode === 'free';
  // Upgrade modal: opened by any locked action via requestUpgrade(), and
  // by the main process when a fire-and-forget save (hotkey screenshot,
  // extension) is blocked. `upgradeFeature` tailors the modal copy.
  const [upgradeFeature, setUpgradeFeature] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  useEffect(() => {
    function onRequestUpgrade(e) {
      setUpgradeFeature(e?.detail?.feature || null);
      setUpgradeOpen(true);
    }
    function onNeedsUpgrade(payload) {
      setUpgradeFeature(payload?.source === 'extension' ? 'save' : (payload?.source || 'save'));
      setUpgradeOpen(true);
    }
    window.addEventListener('moodmark:request-upgrade', onRequestUpgrade);
    const off = window.moodmark?.on?.('save:needs-upgrade', onNeedsUpgrade);
    return () => {
      window.removeEventListener('moodmark:request-upgrade', onRequestUpgrade);
      try { off?.(); } catch { /* ignore */ }
    };
  }, []);

  // Resume a pending upgrade after "Sign in to upgrade". The user tapped
  // upgrade, got bounced to sign-in (which unmounts this component), then
  // came back via the magic link. The instant we're back AND signed in
  // AND still on the free tier, re-open the upgrade modal automatically —
  // no redundant second tap on the toast. Runs here (not in AppGate)
  // because App is the thing that re-mounts after sign-in, so the modal
  // it owns is guaranteed to be listening.
  useEffect(() => {
    if (ent.loading) return undefined;          // wait for real entitlement
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(PENDING_UPGRADE_KEY) || 'null'); }
    catch { pending = null; }
    if (!pending) return undefined;
    let cancelled = false;
    (async () => {
      const signedIn = await window.moodmark?.licensing?.hasSession?.().catch(() => false);
      if (cancelled || !signedIn) return;       // only after a real sign-in
      localStorage.removeItem(PENDING_UPGRADE_KEY);
      if (ent.mode === 'free') {
        setUpgradeFeature(pending.feature || null);
        setUpgradeOpen(true);
      }
      // entitled trial / paid → signing in already granted access; the
      // intent is consumed above with nothing more to do.
    })();
    return () => { cancelled = true; };
  }, [ent.mode, ent.loading]);

  // The moment a subscription lands (mode flips to paid), close the
  // upgrade modal — otherwise the paywall stays up over the now-unlocked
  // app after the user comes back from checkout.
  useEffect(() => {
    if (ent.mode === 'paid') setUpgradeOpen(false);
  }, [ent.mode]);
  const {
    saves,
    loading,
    view,
    setView,
    search,
    setSearch,
    colorFilter,
    setColorFilter,
    similarTo,
    setSimilarTo,
    reload,
    deleteSave,
    restoreSave,
    hideSavesLocal,
    updateSaveMeta,
    freshIds,
  } = useLibrary();

  // Cmd+Z undo stack. Mutations push a label + reversal closure; the
  // global keydown handler at the end of this component pops & runs.
  const undoStack = useUndoStack();
  const recentSearches = useRecentSearches();

  // Top-level mode pill in the toolbar. Lives parallel to `view`
  // rather than replacing it: while we're staging the migration, the
  // pill is the new primary nav for Library / Folders / Boards but
  // the legacy view-state still drives drilled-in navigation
  // (clicking a folder tile changes view; the pill stays on
  // 'folders'). Persisted to localStorage so the user's last mode
  // sticks across launches.
  const [appMode, setAppMode] = useState(() => {
    try {
      const raw = localStorage.getItem('moodmark.appMode');
      if (raw === 'folders' || raw === 'boards' || raw === 'library' || raw === 'search') return raw;
    } catch {}
    // First launch fallback — read the Settings → Defaults pref.
    const def = window.moodmark?.app?.defaults?.defaultMode;
    if (def === 'folders' || def === 'boards' || def === 'library') return def;
    return 'library';
  });
  useEffect(() => {
    try { localStorage.setItem('moodmark.appMode', appMode); } catch {}
  }, [appMode]);

  // Where the user was before opening the Search tab — so Escape on an
  // empty query returns them there with the grid scroll intact.
  // { mode, view, scrollTop }.
  const preSearchRef = useRef(null);

  // Strip the leftover focus ring after Escape closes a modal/popover.
  // Chromium promotes :focus-visible on Escape (keyboard event), so the
  // trigger button you clicked with the mouse ends up with the
  // outline even though you never used the keyboard to focus it. Blur
  // the active element on the next frame — after the modal has had a
  // chance to handle Escape and return focus to the trigger. Skip
  // inputs/textareas/contenteditable so typing isn't disrupted by the
  // Esc-to-cancel idiom.
  useEffect(() => {
    function onEscape(e) {
      if (e.key !== 'Escape') return;
      requestAnimationFrame(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return;
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return;
        if (tag === 'BUTTON' || el.getAttribute('role') === 'button') {
          el.blur();
        }
      });
    }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, []);

  // Switching the pill always returns to the mode's "root" — Library
  // shows the unfiltered masonry, Folders shows the tile grid (root
  // level), Boards shows the boards grid. Without this, switching to
  // Folders while already drilled into a collection would render the
  // drilled-in masonry instead of the grid the user expected.
  const handleModeChange = useCallback((nextMode) => {
    // Entering Search: remember where we came from (mode + view + the
    // current grid scroll, read off the live node before it unmounts) so
    // Escape can put us back exactly there.
    if (nextMode === 'search' && appMode !== 'search') {
      let scrollTop = 0;
      try { scrollTop = document.querySelector('.grid-scroll')?.scrollTop || 0; } catch { /* ignore */ }
      preSearchRef.current = { mode: appMode, view, scrollTop };
    }
    setAppMode(nextMode);
    setView({ type: 'all' });
    // Switching tabs is a fresh start — drop any active query so e.g.
    // leaving Search for Library shows all saves, not the last results.
    setSearch('');
    // Entering (or re-clicking) the Search tab drops focus straight into
    // its hero field so the user can start typing immediately.
    if (nextMode === 'search') {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
      });
    }
  }, [appMode, view, setView, setSearch]);

  // Per-view shuffle seeds. Persisted to localStorage so a shuffle
  // sticks across navigation, search, sort, and full app restarts —
  // the user's intentional order is treated as a real preference,
  // not a transient state. Map<viewKey, seed>.
  const [shuffleSeeds, setShuffleSeeds] = useState(() => {
    try {
      const raw = localStorage.getItem('moodmark.shuffleSeeds');
      if (!raw) return new Map();
      const arr = JSON.parse(raw);
      return new Map(Array.isArray(arr) ? arr : []);
    } catch {
      return new Map();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        'moodmark.shuffleSeeds',
        JSON.stringify([...shuffleSeeds]),
      );
    } catch {}
  }, [shuffleSeeds]);
  // Per-view timestamp marking when shuffle was last applied. Saves
  // with created_at > shuffleAt for the current view skip the
  // shuffle and stay pinned at the top in newest-first order, so
  // freshly-dropped images always show up at position 1 even on a
  // shuffled view. Reshuffle resets the timestamp.
  const [shuffleAts, setShuffleAts] = useState(() => {
    try {
      const raw = localStorage.getItem('moodmark.shuffleAts');
      if (!raw) return new Map();
      const arr = JSON.parse(raw);
      return new Map(Array.isArray(arr) ? arr : []);
    } catch {
      return new Map();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        'moodmark.shuffleAts',
        JSON.stringify([...shuffleAts]),
      );
    } catch {}
  }, [shuffleAts]);
  const viewKey = (v) =>
    v && v.type === 'collection' ? `collection:${v.id}` : v?.type || 'all';
  const shuffleSeed = shuffleSeeds.get(viewKey(view)) || null;
  const shuffleAt = shuffleAts.get(viewKey(view)) || 0;
  const handleShuffleView = useCallback((targetView) => {
    const target = targetView || view;
    if (targetView) {
      setView(targetView);
      setFocusedId(null);
    }
    const key = targetView
      ? (target.type === 'collection' ? `collection:${target.id}` : target.type)
      : viewKey(view);
    const previous = shuffleSeeds.get(key) || null;
    const previousAt = shuffleAts.get(key) || 0;
    // Math.random() yields [0,1) and we want a 32-bit-ish int seed.
    const seed = Math.floor(Math.random() * 0x7fffffff) || 1;
    const at = Date.now();
    setShuffleSeeds((prev) => {
      const next = new Map(prev);
      next.set(key, seed);
      return next;
    });
    setShuffleAts((prev) => {
      const next = new Map(prev);
      next.set(key, at);
      return next;
    });
    undoStack.push('shuffle', () => {
      setShuffleSeeds((prev) => {
        const next = new Map(prev);
        if (previous) next.set(key, previous);
        else next.delete(key);
        return next;
      });
      setShuffleAts((prev) => {
        const next = new Map(prev);
        if (previousAt) next.set(key, previousAt);
        else next.delete(key);
        return next;
      });
    });
  // viewKey is a stable inline closure, no need to add as dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffleSeeds, view, setView, undoStack]);

  // Wrap useLibrary's updateSaveMeta so renames / URL / notes edits
  // are undoable. Captures the previous values from the live saves
  // array before delegating to the underlying setter.
  const undoableUpdateSaveMeta = useCallback((id, patch) => {
    const before = saves.find((s) => s.id === id);
    updateSaveMeta(id, patch);
    if (!before) return;
    const inverse = {};
    if ('title' in patch && (before.title || null) !== (patch.title || null)) {
      inverse.title = before.title || null;
    }
    if ('sourceUrl' in patch && (before.source_url || null) !== (patch.sourceUrl || null)) {
      inverse.sourceUrl = before.source_url || null;
    }
    if ('notes' in patch && (before.notes || null) !== (patch.notes || null)) {
      inverse.notes = before.notes || null;
    }
    if ('meta' in patch && (before.meta || null) !== (patch.meta || null)) {
      inverse.meta = before.meta || null;
    }
    if (Object.keys(inverse).length === 0) return;
    const label = 'title' in inverse
      ? 'rename'
      : 'sourceUrl' in inverse
      ? 'URL change'
      : 'notes' in inverse
      ? 'note edit'
      : 'edit';
    undoStack.push(label, () => updateSaveMeta(id, inverse));
  }, [saves, updateSaveMeta, undoStack]);

  const handleColorFilter = useCallback((hex) => {
    const previous = colorFilter;
    setColorFilter(hex);
    setFocusedId(null); // back to the grid so the filtered set is visible
    if (previous !== hex) {
      undoStack.push('color filter', () => setColorFilter(previous));
    }
  }, [colorFilter, setColorFilter, undoStack]);

  const [selected, setSelected] = useState(() => new Set());
  const [gridColumns, setGridColumns] = useState(() => {
    const def = window.moodmark?.app?.defaults?.defaultColumns;
    if (typeof def === 'number' && def >= 2 && def <= 8) return def;
    return 3;
  });

  // Active sort mode for the masonry. Persisted per-app (not per-
  // view) — the user's preference is a global setting, not a
  // per-folder toggle. Shuffle takes precedence when active.
  const [sortMode, setSortMode] = useState(() => {
    try {
      const raw = localStorage.getItem('moodmark.sortMode');
      if (raw === 'oldest' || raw === 'name_asc' || raw === 'name_desc' || raw === 'recent') return raw;
    } catch {}
    // First launch fallback — read the Settings → Defaults pref.
    const def = window.moodmark?.app?.defaults?.defaultSort;
    if (def === 'oldest' || def === 'name_asc' || def === 'name_desc' || def === 'recent') return def;
    return 'recent';
  });
  useEffect(() => {
    try { localStorage.setItem('moodmark.sortMode', sortMode); } catch {}
  }, [sortMode]);
  const [gridLayout, setGridLayout] = useState(() => {
    try { return localStorage.getItem('moodmark.gridLayout') || 'masonry'; }
    catch { return 'masonry'; }
  });
  useEffect(() => {
    try { localStorage.setItem('moodmark.gridLayout', gridLayout); } catch {}
  }, [gridLayout]);
  // Bookmarks-only sub-filter: narrow the grid to a single tweet type
  // (text / image / video). 'all' is the no-op default. Session-only —
  // we reset it when the user leaves the Bookmarks view so it never
  // silently applies anywhere else.
  const [tweetTypeFilter, setTweetTypeFilter] = useState('all');
  useEffect(() => {
    if (view.type !== 'bookmarks' && tweetTypeFilter !== 'all') {
      setTweetTypeFilter('all');
    }
  }, [view.type, tweetTypeFilter]);
  // Source sub-filter for the Saved view — 'all' | 'x' | 'instagram'.
  // Same lifecycle as the tweet-type filter: only applies in the Saved
  // (bookmarks) view and resets when the user leaves it.
  const [sourceFilter, setSourceFilter] = useState('all');
  useEffect(() => {
    if (view.type !== 'bookmarks' && sourceFilter !== 'all') {
      setSourceFilter('all');
    }
  }, [view.type, sourceFilter]);
  // Restore the focused-view save on launch from the persisted
  // window state. If the save no longer exists we'll clear it once
  // the saves list loads (see effect below) so the focused view
  // doesn't render empty forever.
  const [focusedId, setFocusedId] = useState(
    () => window.moodmark?.app?.windowState?.focusedId || null,
  );
  // Which image to display in the focused view when the save's a
  // multi-image X bookmark. 0 = the locally saved primary; >0 = the
  // corresponding twimg URL from tweet_meta.imageUrls. Reset whenever
  // the focused save changes — flipping between saves shouldn't carry
  // a stale alt-image selection across.
  const [focusedAltImageIdx, setFocusedAltImageIdx] = useState(0);
  useEffect(() => { setFocusedAltImageIdx(0); }, [focusedId]);
  // Spacebar Quick Look — a lightweight, dismissible peek of the
  // currently-focused save without opening the full focused view.
  // Holds a save id while the overlay is up, null when dismissed.
  const [peekedSaveId, setPeekedSaveId] = useState(null);
  // A save we just "flew to" in the grid (e.g. duplicate-save toast →
  // Show). Drives a brief reveal pulse on its card, then clears itself.
  const [highlightId, setHighlightId] = useState(null);
  // Tracks the masonry card the cursor is currently over so spacebar
  // can peek the right save. Single-click already opens the focused
  // view here, so there's no "selected but unopened" middle state to
  // anchor Quick Look to — hover is the only clean trigger.
  const [hoveredSaveId, setHoveredSaveId] = useState(null);
  // ImageCard fires (id) on enter and (null, leftId) on leave. The
  // leftId guard avoids a race where a fast cursor sweep enters card
  // B before card A's leave handler runs and stomps the new hover.
  const handleCardHover = useCallback((id, leftId) => {
    if (id != null) {
      setHoveredSaveId(id);
      return;
    }
    setHoveredSaveId((curr) => (curr === leftId ? null : curr));
  }, []);
  // Stable so memoized ImageCards don't re-render when this prop is
  // recreated — an inline arrow here would defeat React.memo on every
  // card.
  const handleCardForceClick = useCallback((id) => setPeekedSaveId(id), []);
  // Unmute is sticky: persisted in prefs so it carries to the next
  // video you open in the focused view and survives a restart.
  const handleVideoMutedChange = useCallback((next) => {
    setPrefs((p) => ({ ...p, videoMuted: next }));
    window.moodmark.settings.setPref('videoMuted', next);
  }, []);
  // Tracks which save is currently morphing between grid and focused
  // view. Used to attach the matching view-transition-name on both
  // source (masonry image) and target (focused image) so the browser
  // animates the shared element in place.
  const [morphId, setMorphId] = useState(null);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // True while an in-app save card is being dragged — arms the
  // collection drop-dock so you can file without scrolling up.
  const [saveDragActive, setSaveDragActive] = useState(false);
  // Collections that already contain ALL the saves in the active drag, so
  // the drop-dock can mark them "already in" and refuse the drop.
  const [dragInCollectionIds, setDragInCollectionIds] = useState(() => new Set());
  // True once the grid is scrolled past the featured-buckets row, so the
  // dock only appears when the real cards are out of reach.
  const [scrolledPastBuckets, setScrolledPastBuckets] = useState(false);
  // Hide the full toolbar (leave only floating tabs) once scrolled into
  // the grid. Hysteresis (hide >140, show <60) so it can't flicker when
  // the user lingers near the threshold.
  const [scrolledHideBar, setScrolledHideBar] = useState(false);
  // Sidebar removed in nav stage 4d. The legacy auto-collapse-on-
  // board-entry effect lived here; with no sidebar there's nothing
  // to collapse.

  // Multi-library state. Loaded once on mount; refreshed whenever
  // the user creates / renames / deletes from the library switcher.
  const [libraries, setLibraries] = useState([]);
  const [activeLibraryId, setActiveLibraryId] = useState(null);
  // Transient overlay shown during a library switch: a quick veil
  // crossfade that masks the content swap and names the library you're
  // landing in. { id, name } while playing, null otherwise.
  const [librarySwitchOverlay, setLibrarySwitchOverlay] = useState(null);
  const librarySwitchTimerRef = useRef(null);
  const refreshLibraries = useCallback(async () => {
    try {
      const res = await window.moodmark.libraries.list();
      if (res?.libraries) {
        setLibraries(res.libraries);
        setActiveLibraryId(res.activeId);
      }
    } catch (err) {
      console.error('library list failed:', err);
    }
  }, []);
  useEffect(() => { refreshLibraries(); }, [refreshLibraries]);

  // AppGate dispatches this when the DB-integrity banner's "View
  // backups" button is clicked. Pop Settings open and tell it which
  // drawer to auto-expand. Object identity changes per dispatch so
  // SettingsModal's effect always re-runs even on a repeat click.
  useEffect(() => {
    function onOpenSettings(e) {
      const drawer = e?.detail?.drawer || null;
      setSettingsDrawerHint(drawer ? { drawer, key: Date.now() } : null);
      setSettingsOpen(true);
    }
    window.addEventListener('moodmark:open-settings', onOpenSettings);
    return () => window.removeEventListener('moodmark:open-settings', onOpenSettings);
  }, []);

  // Persist the active view + focused save whenever they change so
  // a relaunch lands the user back on the same screen. Sanitised on
  // the main side; we just hand over the current values.
  useEffect(() => {
    if (!window.moodmark?.app?.setWindowState) return;
    window.moodmark.app.setWindowState({ view, focusedId });
  }, [view, focusedId]);

  // Once the initial saves list loads, drop a restored focusedId
  // that no longer points at a real save (e.g. user deleted it
  // between sessions) so the focused view doesn't render empty.
  const focusedRestoreCheckedRef = useRef(false);
  useEffect(() => {
    if (focusedRestoreCheckedRef.current) return;
    if (loading) return;
    focusedRestoreCheckedRef.current = true;
    if (focusedId && !saves.some((s) => s.id === focusedId)) {
      setFocusedId(null);
    }
  }, [loading, saves, focusedId]);

  // Native menu commands. The menu lives in main and routes user
  // intent through this single channel so we don't have to thread
  // setter props down to a non-React owner. Each id matches one of
  // the items in src/main/menu.js.
  useEffect(() => {
    if (!window.moodmark?.on) return undefined;
    const off = window.moodmark.on('menu:command', (id) => {
      switch (id) {
        case 'open-settings':
          setSettingsOpen(true);
          break;
        case 'shortcuts':
          setShortcutsOpen(true);
          break;
        case 'quick-switcher':
          setQuickSwitcherOpen(true);
          break;
        case 'focus-search':
          searchInputRef.current?.focus?.();
          searchInputRef.current?.select?.();
          break;
        case 'new-bucket':
          handleCreateAndOpenCollection();
          break;
        case 'new-board':
          handleCreateBoard?.().then((b) => {
            if (b?.id) setView({ type: 'board', id: b.id });
          });
          break;
        case 'toggle-sidebar':
          // No-op: sidebar was removed in nav stage 4d. Kept the
          // case so menu/keyboard senders don't error.
          break;
        case 'capture-screenshot':
          window.moodmark.capture?.screenshot?.();
          break;
        case 'export-library':
          window.moodmark.library?.exportZip?.();
          break;
        case 'snapshot-library':
          window.moodmark.backup?.snapshot?.();
          break;
        case 'whats-new':
          setSettingsDrawerHint({ drawer: 'about', key: Date.now() });
          setSettingsOpen(true);
          break;
        case 'quick-look':
          // Forward to a CustomEvent so the keydown / menu paths
          // share a single dispatch site and Quick Look's own logic
          // (bail when typing, peek the right card) lives in one
          // place below.
          window.dispatchEvent(new CustomEvent('moodmark:quick-look'));
          break;
        case 'rediscover':
          setRediscoverOpen(true);
          break;
        default:
          break;
      }
    });
    return off;
  }, []);

  // Settings modal + AI configured-state. The ai.hasSession check runs
  // once on mount and is updated whenever the user saves/clears via
  // SettingsModal's onConfiguredChange callback.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Hint to SettingsModal — the name of the drawer to auto-open on
  // launch (e.g. when the DB-integrity banner asks the user to look
  // at backups). Bumped via a fresh object each time so SettingsModal
  // can effect-listen for it without us tracking dirty flags here.
  const [settingsDrawerHint, setSettingsDrawerHint] = useState(null);
  const [aiUnlockedOpen, setAiUnlockedOpen] = useState(false);
  const [saveUrlOpen, setSaveUrlOpen] = useState(false);
  // True while the paste-aware prompt is showing (so the + FAB hides —
  // they share the bottom-right corner).
  const [pastePromptVisible, setPastePromptVisible] = useState(false);
  const [whatsNewNotes, setWhatsNewNotes] = useState(null);
  // Easter egg — warm "window blinds" sun overlay (⌘⇧B).
  const [sunBlindsOpen, setSunBlindsOpen] = useState(false);
  // Tracks the last version whose release notes the user explicitly
  // clicked through via the sidebar's "What's New" button. Drives the
  // small dot on that footer item: present whenever there's a notes
  // block for the current app version that this user hasn't viewed
  // yet. Separate from moodmark.lastSeenVersion (which advances on
  // every launch regardless of whether the auto-modal shows).
  const [lastViewedNotesVersion, setLastViewedNotesVersion] = useState(() => {
    try { return localStorage.getItem('moodmark.lastViewedReleaseNotesVersion') || null; }
    catch { return null; }
  });
  const currentAppVersion = window.moodmark?.app?.version || null;
  const latestReleaseNotes = RELEASE_NOTES[0] || null;
  const releaseNotesUnseen = !!latestReleaseNotes
    && !!currentAppVersion
    && latestReleaseNotes.version === currentAppVersion
    && lastViewedNotesVersion !== currentAppVersion;
  const handleOpenReleaseNotes = useCallback(() => {
    if (!latestReleaseNotes) return;
    setWhatsNewNotes(latestReleaseNotes);
    if (currentAppVersion) {
      try { localStorage.setItem('moodmark.lastViewedReleaseNotesVersion', currentAppVersion); } catch {}
      setLastViewedNotesVersion(currentAppVersion);
    }
  }, [latestReleaseNotes, currentAppVersion]);
  // Show "What's new" once after an auto-update lands the user on a
  // newer build. Brand-new installs (no lastSeenVersion stored) get
  // their version recorded silently — first-launch onboarding is
  // owned by the welcome modal, not this one.
  useEffect(() => {
    const currentVersion = window.moodmark?.app?.version;
    if (!currentVersion) return;
    let lastSeen = null;
    try { lastSeen = localStorage.getItem('moodmark.lastSeenVersion'); } catch {}
    if (!lastSeen) {
      try { localStorage.setItem('moodmark.lastSeenVersion', currentVersion); } catch {}
      return;
    }
    const notes = pickNotesForUpgrade(currentVersion, lastSeen);
    if (notes) setWhatsNewNotes(notes);
    // Always advance the cursor — even when there's no notes block
    // for the new version, we don't want to keep checking forever.
    try { localStorage.setItem('moodmark.lastSeenVersion', currentVersion); } catch {}
  }, []);

  // Dev-only console handles for QA. Lets us pop the onboarding /
  // celebration modals without juggling localStorage flags or wiping
  // the library. Stripped from production renderer builds anyway by
  // virtue of being inert (no UI hookups, just window assignments).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__moodmarkDebug = {
      showAIUnlocked: () => setAiUnlockedOpen(true),
      showWhatsNew: (version) => {
        const target = version
          ? RELEASE_NOTES.find((r) => r.version === version)
          : RELEASE_NOTES[0];
        if (target) setWhatsNewNotes(target);
        else console.warn('[debug] no release notes for', version);
      },
    };
    return () => { delete window.__moodmarkDebug; };
  }, []);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [prefs, setPrefs] = useState({ autoNameOnSave: true, semanticSearch: true });

  // Imperative handles for the global keyboard shortcuts.
  const searchInputRef = useRef(null);

  // Blur the search field whenever the user clicks anywhere outside
  // it — clears the focus ring so the bar reads as inactive once the
  // user's attention moves on. mousedown rather than click so the
  // blur lands before the target widget tries to refocus itself.
  useEffect(() => {
    const onMouseDown = (e) => {
      const input = searchInputRef.current;
      if (!input) return;
      if (document.activeElement !== input) return;
      if (e.target === input) return;
      if (e.target instanceof Node && input.parentElement?.contains(e.target)) return;
      input.blur();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);
  // Counter bumped whenever a freshly-created collection is opened, so
  // the SmartChipRail can drop its title straight into rename mode
  // (focused + selected) for immediate naming. A counter rather than a
  // boolean so back-to-back creates each re-trigger the rename.
  const [renameViewSignal, setRenameViewSignal] = useState(0);
  useEffect(() => {
    window.moodmark.ai.hasSession().then(setAiConfigured);
    window.moodmark.settings.getPrefs().then((p) => {
      setPrefs(p);
      // Prime the save-sound engine from saved prefs.
      configureSaveSound({
        sound: p?.saveSound ?? DEFAULT_SAVE_SOUND,
        enabled: p?.saveSoundEnabled !== false,
        volume: typeof p?.saveSoundVolume === 'number' ? p.saveSoundVolume : 0.6,
      });
      // First-launch auto-trigger for the walkthrough. The flag is
      // written when the user finishes (or dismisses) the tour, so
      // it only fires on a truly fresh install. Settings → Help →
      // Restart walkthrough remains the manual replay entry point.
      if (!p?.[ONBOARDING_DONE_PREF]) {
        onboarding.start();
      }
    });
    // onboarding.start is stable; intentionally a mount-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Starter-pack lifecycle. Install on every walkthrough start
  // (idempotent — ingestZip dedups by content hash, so re-running
  // it on an already-installed library is a no-op). Reload on
  // every walkthrough end so the library reflects the result of
  // the 'fresh' choice (or just a fresh install on first launch).
  const prevOnboardingActive = useRef(false);
  // True when both the toggle is on AND the user is signed-in to a
  // license session — search will route through embeddings rather
  // than LIKE. Locked in the free tier (semantic search is pro); the
  // app falls back to plain LIKE search, which still works fine.
  const semanticSearchActive = aiConfigured && !!prefs.semanticSearch && !proLocked;

  // Set of save ids the main process is currently AI-indexing. Driven
  // by save:indexing-start / save:indexing-end events. DetailPanel
  // reads this to show a loading indicator in the Name field while
  // the title is being generated.
  const [indexingIds, setIndexingIds] = useState(() => new Set());
  useEffect(() => {
    const offStart = window.moodmark.on('save:indexing-start', (id) => {
      setIndexingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    });
    const offEnd = window.moodmark.on('save:indexing-end', (id) => {
      setIndexingIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
    return () => { offStart?.(); offEnd?.(); };
  }, []);

  // Auto-update notification — main process emits 'update-ready'
  // when electron-updater has finished downloading a new version.
  // We surface a small pill in the bottom-right corner; click ➜
  // updater:install ➜ quitAndInstall(). If the user ignores it,
  // autoInstallOnAppQuit kicks in on their next clean quit.
  const [pendingUpdate, setPendingUpdate] = useState(null);
  useEffect(() => {
    return window.moodmark.on('update-ready', (info) => {
      setPendingUpdate(info || { version: null });
    });
  }, []);
  const handleApplyUpdate = useCallback(() => {
    window.moodmark.updater.install();
  }, []);

  // Collections state
  const [collections, setCollections] = useState([]);
  // Counts that drive the sidebar's smart-view badges (All / Unsorted /
  // Trash). Refreshed alongside collections.
  const [smartCounts, setSmartCounts] = useState({ all: 0, unsorted: 0, trash: 0, bookmarks: 0, onThisDay: 0 });

  const loadCollections = useCallback(async () => {
    const [cols, counts] = await Promise.all([
      // Pulls thumbs in the same query so the Folders-mode tile
      // grid can render its stack-fans without a per-tile round-trip.
      window.moodmark.collections.getAllWithThumbs(),
      window.moodmark.saves.counts(),
    ]);
    setCollections(cols);
    setSmartCounts(counts && typeof counts === 'object'
      ? counts
      : { all: 0, unsorted: 0, trash: 0, bookmarks: 0, onThisDay: 0 });
  }, []);

  useEffect(() => { loadCollections(); }, [loadCollections]);

  // Boards state — Miro-style infinite-canvas surfaces. Reloaded
  // whenever a board is created/renamed/deleted so the sidebar list
  // stays in sync.
  const [boards, setBoards] = useState([]);
  const loadBoards = useCallback(async () => {
    // Boards-mode tile grid renders a 2x2 mosaic of each board's
    // first image items, so we pull thumbs in the same query rather
    // than per-tile. listWithThumbs returns the same shape as list()
    // plus a `thumbs: string[]` field.
    const rows = await window.moodmark.boards.listWithThumbs();
    setBoards(Array.isArray(rows) ? rows : []);
  }, []);
  useEffect(() => { loadBoards(); }, [loadBoards]);

  // Walkthrough lifecycle. Install the starter pack on every
  // start (idempotent — ingestZip dedups by content_hash). On
  // end, reload saves + collections + boards because "Start
  // fresh" can have wiped all three.
  useEffect(() => {
    const wasActive = prevOnboardingActive.current;
    prevOnboardingActive.current = onboarding.active;
    if (!wasActive && onboarding.active) {
      (async () => {
        try { await window.moodmark?.onboarding?.installStarterPack?.(); }
        catch (e) { console.warn('[onboarding] starter-pack install failed:', e); }
        reload();
      })();
    } else if (wasActive && !onboarding.active) {
      reload();
      loadCollections();
      loadBoards();
    }
  }, [onboarding.active, reload, loadCollections, loadBoards]);

  const handleCreateBoard = useCallback(async () => {
    if (proLocked) { requestUpgrade('boards'); return null; }
    const board = await window.moodmark.boards.create({ name: 'Untitled board' });
    await loadBoards();
    return board;
  }, [loadBoards, proLocked]);

  const handleRenameBoard = useCallback(async ({ id, name }) => {
    await window.moodmark.boards.rename({ id, name });
    await loadBoards();
  }, [loadBoards]);

  const handleDeleteBoard = useCallback(async (id) => {
    await window.moodmark.boards.delete(id);
    setView((v) => (v.type === 'board' && v.id === id ? { type: 'all' } : v));
    await loadBoards();
  }, [loadBoards, setView]);

  const handleReorderBoards = useCallback(async (orderedIds) => {
    setBoards((prev) => {
      const byId = new Map(prev.map((b) => [b.id, b]));
      return orderedIds.map((id) => byId.get(id)).filter(Boolean);
    });
    await window.moodmark.boards.reorder(orderedIds);
    loadBoards();
  }, [loadBoards]);

  // Refresh collection counts whenever the grid refreshes — and also
  // whenever the local saves array shrinks/grows from an optimistic
  // mutation (delete, restore, empty-trash). Without the saves.length
  // dep, sidebar count badges go stale until the next full reload.
  useEffect(() => {
    if (!loading) loadCollections();
  }, [loading, saves.length, loadCollections]);

  // Tags state — used by DetailPanel for autocomplete suggestions.
  const [allTags, setAllTags] = useState([]);

  const loadAllTags = useCallback(async () => {
    const data = await window.moodmark.tags.getAll();
    setAllTags(data);
  }, []);

  useEffect(() => { loadAllTags(); }, [loadAllTags]);

  // Most-used tags, surfaced as quick-jump chips on the Search tab's
  // landing state. Sorted by usage so the densest tags lead.
  const suggestedTags = useMemo(
    () => [...allTags]
      .sort((a, b) => (b.save_count || 0) - (a.save_count || 0))
      .slice(0, 12),
    [allTags],
  );

  // Generic action toast: a single bottom-center pill that supports
  // undo. Works for any reversible-but-deferred action.
  //   - message: what shows in the toast
  //   - onUndo:  user clicked "Undo"
  //   - onCommit: timer expired or another toast replaced this one;
  //              the action's side-effect (e.g. unlinking files) runs
  //              here. For already-persisted actions like soft-delete
  //              this is a noop.
  const [actionToast, setActionToast] = useState(null);
  const actionToastTimerRef = useRef(null);
  const actionToastCommitRef = useRef(null);

  // Run any pending commit synchronously so back-to-back toasts don't
  // race (and so things still get cleaned up if the toast is replaced).
  const runPendingCommit = useCallback(() => {
    if (actionToastTimerRef.current) {
      clearTimeout(actionToastTimerRef.current);
      actionToastTimerRef.current = null;
    }
    const commit = actionToastCommitRef.current;
    actionToastCommitRef.current = null;
    if (commit) commit();
  }, []);

  const showActionToast = useCallback(({ message, onUndo, action, onCommit, thumb, durationMs = 5000, countdown = false }) => {
    runPendingCommit();
    actionToastCommitRef.current = onCommit || null;
    setActionToast({
      message, onUndo, action, thumb, countdown, durationMs,
      // Deadline drives the visible countdown ring/number; only set when
      // a countdown was requested (irreversible commits like Empty trash).
      deadline: countdown ? Date.now() + durationMs : null,
    });
    actionToastTimerRef.current = setTimeout(() => {
      const commit = actionToastCommitRef.current;
      actionToastCommitRef.current = null;
      actionToastTimerRef.current = null;
      setActionToast(null);
      if (commit) commit();
    }, durationMs);
  }, [runPendingCommit]);

  // Live seconds remaining for a countdown toast (Empty trash). Ticks
  // while a countdown toast is up; the ring itself animates in CSS.
  const [countdownLeft, setCountdownLeft] = useState(0);
  useEffect(() => {
    if (!actionToast?.countdown || !actionToast.deadline) { setCountdownLeft(0); return undefined; }
    const tick = () => setCountdownLeft(Math.max(0, Math.ceil((actionToast.deadline - Date.now()) / 1000)));
    tick();
    const iv = setInterval(tick, 200);
    return () => clearInterval(iv);
  }, [actionToast]);

  // X bookmark syncs arrive batched: the main process collects the burst
  // and fires one summary instead of a per-save toast/sound/animation.
  // Pull the new rows in with a single grid refresh and show one calm
  // "Synced N bookmarks" note.
  useEffect(() => {
    if (!window.moodmark?.on) return undefined;
    return window.moodmark.on('bookmarks:synced', ({ count } = {}) => {
      const n = Number(count) || 0;
      if (n <= 0) return;
      reload();
      showActionToast({
        message: `Synced ${n} bookmark${n === 1 ? '' : 's'}`,
        durationMs: 2600,
      });
    });
  }, [reload, showActionToast]);

  // Surface updater errors so a wedged install no longer fails
  // silently. Most common cause: the running .app bundle is in a
  // non-/Applications path (dev build, dragged out of a DMG to the
  // Desktop, etc.) and macOS rejects the atomic swap.
  useEffect(() => {
    return window.moodmark.on('update-error', ({ message } = {}) => {
      showActionToast({
        message: `Update failed: ${message || 'unknown error'}`,
        durationMs: 8000,
      });
    });
  }, [showActionToast]);

  const handleActionToastUndo = useCallback(() => {
    if (!actionToast) return;
    const undo = actionToast.onUndo;
    // Drop the commit — the undo path will roll back instead.
    actionToastCommitRef.current = null;
    if (actionToastTimerRef.current) clearTimeout(actionToastTimerRef.current);
    actionToastTimerRef.current = null;
    setActionToast(null);
    if (undo) undo();
  }, [actionToast]);

  // Run the toast's primary action (used by both the labeled chip and a
  // clickable thumbnail), dismissing the toast first.
  const runActionToastAction = useCallback(() => {
    if (!actionToast?.action) return;
    const run = actionToast.action.run;
    actionToastCommitRef.current = null;
    if (actionToastTimerRef.current) clearTimeout(actionToastTimerRef.current);
    actionToastTimerRef.current = null;
    setActionToast(null);
    run?.();
  }, [actionToast]);

  // If the app unmounts while a commit is pending (window close,
  // navigation), don't lose the pending file unlinks.
  useEffect(() => {
    const onUnload = () => runPendingCommit();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [runPendingCommit]);

  const showTrashToast = useCallback((ids) => {
    if (!ids?.length) return;
    showActionToast({
      message: ids.length === 1 ? 'Moved to Trash' : `${ids.length} moved to Trash`,
      onUndo: async () => {
        for (const id of ids) await restoreSave(id);
        reload();
      },
      // No commit needed: the soft-delete already wrote to the DB.
    });
  }, [showActionToast, restoreSave, reload]);

  // Deferred permanent delete. Hides items immediately; only hits the
  // unlink IPC if the toast's 5s window expires without an Undo.
  const showPermanentDeleteToast = useCallback((ids, opts = {}) => {
    if (!ids?.length) return;
    hideSavesLocal(ids);
    showActionToast({
      message: opts.message || (ids.length === 1 ? 'Deleted forever' : `${ids.length} deleted forever`),
      countdown: !!opts.countdown,
      onUndo: () => reload(), // rows are still in DB with deleted_at set
      onCommit: () => {
        // Window passed without Undo — actually unlink files now.
        for (const id of ids) window.moodmark.saves.permanentDelete(id);
      },
    });
  }, [showActionToast, hideSavesLocal, reload]);

  const showRestoreToast = useCallback((ids) => {
    if (!ids?.length) return;
    showActionToast({
      message: ids.length === 1 ? 'Restored' : `${ids.length} restored`,
      onUndo: async () => {
        for (const id of ids) await deleteSave(id);
        reload();
      },
      // restore is already persisted — no commit needed.
    });
  }, [showActionToast, deleteSave, reload]);

  // Card context menu
  const [cardCtx, setCardCtx] = useState(null); // { saveId, x, y, items }
  // Bulk "Add to Collection" picker, anchored above the selection bar.
  const [bulkPicker, setBulkPicker] = useState(null); // { x, y }
  const [bulkTagPicker, setBulkTagPicker] = useState(null); // { x, y } | null
  const [rediscoverOpen, setRediscoverOpen] = useState(false);

  const buildCardMenuItems = useCallback((saveId, memberIds) => {
    // If the right-clicked save is part of an active multi-selection,
    // every menu action operates on the full selection. Otherwise
    // just the single right-clicked save.
    const targetIds = (selected.has(saveId) && selected.size > 1)
      ? Array.from(selected)
      : [saveId];
    const isMulti = targetIds.length > 1;
    const suffix = isMulti ? ` (${targetIds.length})` : '';

    const items = [];
    // Trash view gets a different menu — restore / delete forever.
    // No bucket actions, since trashed saves aren't "in the library".
    if (view.type === 'trash') {
      items.push({
        label: `Restore${suffix}`,
        icon: <RestoreIcon />,
        onClick: async () => {
          for (const id of targetIds) await restoreSave(id);
          if (isMulti) setSelected(new Set());
          showRestoreToast(targetIds);
        },
      });
      items.push({
        label: `Delete Forever${suffix}`,
        icon: <TrashIcon />,
        danger: true,
        onClick: () => {
          if (isMulti) setSelected(new Set());
          showPermanentDeleteToast(targetIds);
        },
      });
      return items;
    }
    if (view.type === 'collection') {
      items.push({
        label: `Remove from collection${suffix}`,
        icon: <MinusCircleIcon />,
        danger: true,
        onClick: async () => {
          for (const id of targetIds) {
            await window.moodmark.collections.removeSave({ collectionId: view.id, saveId: id });
          }
          if (isMulti) setSelected(new Set());
          reload();
          loadCollections();
        },
      });
    }
    // Hide buckets the saves are already in — for single, that's
    // every bucket the one save belongs to; for multi, only buckets
    // that contain ALL selected saves (a partial-overlap bucket
    // should still be available since the OR-IGNORE insert just
    // dups it for the saves that weren't yet members). memberIds is
    // resolved at menu-open time accordingly.
    const memberSet = memberIds instanceof Set ? memberIds : new Set(memberIds || []);
    const others = (view.type === 'collection'
      ? collections.filter((c) => c.id !== view.id)
      : collections
    ).filter((c) => !memberSet.has(c.id));
    if (others.length > 0) {
      if (items.length > 0) items.push({ type: 'separator' });
      // Group children under their top-level parent. Children whose
      // parent is missing from `others` (e.g. the save is already in
      // the parent, so the parent was filtered out) are promoted to
      // top-level so they don't disappear from the picker.
      const otherIds = new Set(others.map((c) => c.id));
      const childrenByParent = new Map();
      const tops = [];
      for (const c of others) {
        if (c.parent_id && otherIds.has(c.parent_id)) {
          const arr = childrenByParent.get(c.parent_id) || [];
          arr.push(c);
          childrenByParent.set(c.parent_id, arr);
        } else {
          tops.push(c);
        }
      }
      const buildAddItem = (col) => ({
        label: col.name,
        icon: (
          <span style={{ color: 'var(--icon-blue)', display: 'inline-flex' }}>
            <CollectionIcon />
          </span>
        ),
        onClick: async () => {
          const flyItems = targetIds.map((id) => {
            const src = saves.find((s) => s.id === id);
            return { saveId: id, imageSrc: src ? fileUrl(src.file_path) : null };
          });
          flyToCollection({ collectionId: col.id, items: flyItems });
          for (const id of targetIds) {
            await window.moodmark.collections.addSave({ collectionId: col.id, saveId: id });
          }
          loadCollections();
          // In Unsorted view the saves no longer match the filter
          // (they now belong to a bucket), so refresh to drop them.
          if (view.type === 'unsorted') reload();
          undoStack.push('add to collection', async () => {
            for (const id of targetIds) {
              await window.moodmark.collections.removeSave({ collectionId: col.id, saveId: id });
            }
            loadCollections();
            if (view.type === 'unsorted') reload();
          });
        },
      });
      const submenu = tops.map((parent) => {
        const childItems = (childrenByParent.get(parent.id) || []).map(buildAddItem);
        return { ...buildAddItem(parent), children: childItems };
      });
      items.push({
        label: `Add to collection${suffix}`,
        icon: <CollectionIcon />,
        submenu,
      });
    }

    // Copy image bytes to the system clipboard so the user can
    // paste into Figma / Slack / Mail / etc. Single-save only — the
    // clipboard holds one image at a time.
    if (!isMulti) {
      const anchor = saves.find((s) => s.id === saveId);
      if (anchor?.file_path) {
        if (items.length > 0) items.push({ type: 'separator' });
        items.push({
          label: 'Copy image',
          icon: <ClipboardIcon />,
          onClick: async () => {
            const result = await window.moodmark.image.copyToClipboard(anchor.file_path);
            if (result?.ok) {
              showActionToast({ message: 'Copied to clipboard', durationMs: 1400 });
            } else {
              showActionToast({ message: 'Could not copy image', durationMs: 2400 });
            }
          },
        });
      }
      // Source-URL actions — only meaningful for saves that came in
      // with a captured source (clipboard URL, drag-from-browser, web
      // capture). Open in the system browser, or copy the link to the
      // clipboard so the user can paste it elsewhere.
      if (anchor?.source_url) {
        // tweet_meta is only set on saves captured from X, so its
        // presence is a reliable "this is a tweet" signal — surface the
        // action as "Open on X" with the original permalink.
        const fromX = !!anchor.tweet_meta;
        items.push({
          label: fromX ? 'Open on X' : 'Open source',
          icon: <ExternalLinkIcon />,
          onClick: () => {
            window.moodmark.shell.openUrl(anchor.source_url);
          },
        });
      }
      // Open the OS file manager with this save's file highlighted.
      // Label tracks the OS so macOS users get "Reveal in Finder"
      // verbatim from the platform vocabulary.
      if (anchor?.file_path) {
        const isMac = typeof navigator !== 'undefined'
          && /Mac|iPhone|iPad/i.test(navigator.platform || '');
        items.push({
          label: isMac ? 'Reveal in Finder' : 'Show in folder',
          icon: <RevealIcon />,
          onClick: async () => {
            const result = await window.moodmark.saves.revealInFinder(anchor.file_path);
            if (!result?.ok) {
              showActionToast({ message: 'Could not reveal file', durationMs: 2400 });
            }
          },
        });
      }
    }

    // Export to disk. Single-save opens a Save As dialog with a
    // sensible default filename; multi-select opens the bulk folder
    // picker that copies every selected file into one directory.
    if (items.length > 0) items.push({ type: 'separator' });
    if (isMulti) {
      items.push({
        label: `Export${suffix}`,
        icon: <DownloadIcon />,
        onClick: () => window.moodmark.saves.exportBulk(targetIds),
      });
    } else {
      const exportAnchor = saves.find((s) => s.id === saveId);
      if (exportAnchor?.file_path) {
        const ext = (exportAnchor.file_path.split('.').pop() || 'png').toLowerCase();
        const exportName = exportAnchor.title
          ? `${exportAnchor.title}.${ext}`
          : `moodmark-${exportAnchor.id.slice(0, 8)}.${ext}`;
        items.push({
          label: 'Export',
          icon: <DownloadIcon />,
          onClick: () => window.moodmark.image.export(exportAnchor.file_path, exportName),
        });
      }
    }

    // Delete: soft-delete with the same undo toast as the bulk path.
    if (items.length > 0) items.push({ type: 'separator' });
    items.push({
      label: `Delete${suffix}`,
      icon: <TrashIcon />,
      danger: true,
      onClick: async () => {
        for (const id of targetIds) await deleteSave(id);
        setSelected((prev) => {
          if (isMulti) return new Set();
          if (!prev.has(saveId)) return prev;
          const next = new Set(prev);
          next.delete(saveId);
          return next;
        });
        if (focusedId && targetIds.includes(focusedId)) setFocusedId(null);
        showTrashToast(targetIds);
      },
    });
    return items;
  }, [selected, collections, view, reload, loadCollections, restoreSave, showRestoreToast, showPermanentDeleteToast, deleteSave, showTrashToast, focusedId, saves, undoStack, similarTo, setSimilarTo, showActionToast, aiConfigured]);

  const handleCardContextMenu = useCallback(async (saveId, x, y) => {
    // Resolve the bucket memberships used to filter the Add-to-Bucket
    // submenu. For multi-select we hide buckets that contain every
    // selected save (adding would be a no-op for all); for single,
    // hide buckets the one save is already in.
    const isMulti = selected.has(saveId) && selected.size > 1;
    const targetIds = isMulti ? Array.from(selected) : [saveId];
    let memberIds = [];
    try {
      if (isMulti) {
        const rows = await window.moodmark.collections.containingAll(targetIds);
        memberIds = (rows || []).map((r) => r.id ?? r);
      } else {
        const rows = await window.moodmark.collections.getForSave(saveId);
        memberIds = (rows || []).map((r) => r.id);
      }
    } catch { /* fall through with empty list */ }
    const items = buildCardMenuItems(saveId, memberIds);
    if (items.length === 0) return;
    setCardCtx({ saveId, x, y, items });
  }, [buildCardMenuItems, selected]);

  // Drag-out: hand the selected files (or just the dragged card if it
  // Default drag is an in-app HTML5 drag with a custom MIME so sidebar
  // buckets (and any other in-renderer drop target) can accept it.
  // Hold Alt at drag-start to fall back to the OS drag-out (Electron's
  // webContents.startDrag), which lets you drop into Figma / Slack /
  // Mail / Finder / etc.
  const handleCardDragStart = useCallback((e, record) => {
    const ids = selected.has(record.id) && selected.size > 1
      ? [...selected]
      : [record.id];

    if (e.altKey) {
      // OS drag-out — suppress the browser's native drag, hand off to
      // the main process to paint a system drag preview.
      e.preventDefault();
      const files = ids
        .map((id) => saves.find((s) => s.id === id)?.file_path)
        .filter(Boolean);
      if (files.length === 0) return;
      window.moodmark.drag.start({
        files,
        thumbPath: record.thumb_path || record.file_path,
      });
      return;
    }

    // HTML5 drag for in-app drops. Drop targets read the JSON payload
    // back from this MIME.
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-moodmark-save-ids', JSON.stringify(ids));

    // Arm the collection drop-dock for the duration of this drag, so a
    // scrolled-down grid still has collection targets. dragend (fires on
    // the source for both drop + cancel) disarms it; once:true cleans up.
    setSaveDragActive(true);
    setDragInCollectionIds(new Set());
    // Resolve which collections already contain ALL the dragged saves so
    // the drop-dock can mark them as already-added (and skip the drop).
    (async () => {
      try {
        const lists = await Promise.all(
          ids.map((id) => window.moodmark.collections.getForSave(id)),
        );
        let inter = null;
        for (const rows of lists) {
          const set = new Set((rows || []).map((r) => r.id));
          inter = inter == null ? set : new Set([...inter].filter((x) => set.has(x)));
        }
        setDragInCollectionIds(inter || new Set());
      } catch { /* leave empty — fail open, all collections droppable */ }
    })();
    window.addEventListener('dragend', () => {
      setSaveDragActive(false);
      setDragInCollectionIds(new Set());
    }, { once: true });

    // Tweet / text-post cards have no representative image — the only
    // <img> is a tiny avatar, which the canvas path below would upscale
    // into a blurry square. Build a crisp mini-tweet card (avatar +
    // author + a couple lines) and use that DOM node as the drag image.
    if (record.kind === 'tweet') {
      let meta = null;
      try { meta = record.tweet_meta ? JSON.parse(record.tweet_meta) : null; } catch { meta = null; }
      const name = (meta?.authorName || meta?.authorHandle || 'Post').trim();
      const handleRaw = (meta?.authorHandle || '').trim();
      const handle = handleRaw ? (handleRaw.startsWith('@') ? handleRaw : `@${handleRaw}`) : '';
      const caption = (meta?.caption || record.title || '').trim();
      const avatarUrl = (typeof meta?.authorAvatarUrl === 'string' && /^https?:\/\//i.test(meta.authorAvatarUrl))
        ? meta.authorAvatarUrl : '';
      const initials = (name.replace(/^@/, '').slice(0, 1) || '#').toUpperCase();

      const chip = document.createElement('div');
      // Liquid-glass: translucent + live backdrop blur. A native
      // setDragImage ghost is a frozen raster (can't blur what's under
      // it), so this element instead follows the cursor as a real DOM
      // node — backdrop-filter then frosts the grid moving beneath it.
      chip.style.cssText = 'position:fixed;top:0;left:0;box-sizing:border-box;width:248px;'
        + 'padding:12px 14px;border-radius:14px;display:flex;gap:10px;align-items:flex-start;'
        + 'background:rgba(28,28,32,0.45);color:#fff;'
        + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;'
        + 'backdrop-filter:blur(22px) saturate(180%);-webkit-backdrop-filter:blur(22px) saturate(180%);'
        + 'border:1px solid rgba(255,255,255,0.18);'
        + 'box-shadow:0 16px 44px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.22);'
        + 'z-index:2147483646;pointer-events:none;will-change:transform;'
        + `transform:translate(${e.clientX + 16}px, ${e.clientY + 14}px);`;

      const av = document.createElement('div');
      av.style.cssText = 'flex:0 0 auto;width:34px;height:34px;border-radius:50%;overflow:hidden;'
        + 'background:#3a3a40;display:flex;align-items:center;justify-content:center;'
        + 'font-size:14px;font-weight:600;color:rgba(255,255,255,.85);';
      if (avatarUrl) {
        const img = document.createElement('img');
        img.src = avatarUrl;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        av.appendChild(img);
      } else {
        av.textContent = initials;
      }
      chip.appendChild(av);

      const col = document.createElement('div');
      col.style.cssText = 'min-width:0;flex:1 1 auto;';
      const nameRow = document.createElement('div');
      nameRow.style.cssText = 'font-size:13px;font-weight:600;line-height:1.2;'
        + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      nameRow.textContent = name;
      col.appendChild(nameRow);
      if (handle) {
        const h = document.createElement('div');
        h.style.cssText = 'font-size:12px;color:rgba(255,255,255,.5);line-height:1.2;margin-top:1px;'
          + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        h.textContent = handle;
        col.appendChild(h);
      }
      if (caption) {
        const body = document.createElement('div');
        body.style.cssText = 'margin-top:5px;font-size:12.5px;line-height:1.35;color:rgba(255,255,255,.82);'
          + 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;';
        body.textContent = caption;
        col.appendChild(body);
      }
      chip.appendChild(col);

      if (ids.length > 1) {
        const badge = document.createElement('div');
        badge.textContent = String(ids.length);
        badge.style.cssText = 'position:absolute;top:-8px;right:-8px;min-width:20px;height:20px;padding:0 5px;'
          + 'border-radius:10px;background:#ff3b30;color:#fff;font-size:11px;font-weight:700;'
          + 'display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #1d1d20;';
        chip.appendChild(badge);
      }

      document.body.appendChild(chip);
      // Hide the native drag ghost (1×1 transparent canvas) so only our
      // glass card shows.
      const blank = document.createElement('canvas');
      blank.width = 1;
      blank.height = 1;
      e.dataTransfer.setDragImage(blank, 0, 0);

      // Follow the cursor via dragover (its clientX/Y are reliable, unlike
      // the `drag` event's), rAF-throttled. Cleaned up on dragend.
      let raf = 0;
      let lx = e.clientX;
      let ly = e.clientY;
      const moveGhost = (ev) => {
        if (ev.clientX === 0 && ev.clientY === 0) return; // ignore the stray end event
        lx = ev.clientX;
        ly = ev.clientY;
        if (!raf) {
          raf = requestAnimationFrame(() => {
            raf = 0;
            chip.style.transform = `translate(${lx + 16}px, ${ly + 14}px)`;
          });
        }
      };
      const endGhost = () => {
        document.removeEventListener('dragover', moveGhost, true);
        window.removeEventListener('dragend', endGhost, true);
        if (raf) cancelAnimationFrame(raf);
        chip.remove();
      };
      document.addEventListener('dragover', moveGhost, true);
      window.addEventListener('dragend', endGhost, true);
      return;
    }

    // Drag image: paint the card's already-loaded <img> into a small
    // canvas, then use that canvas as the drag image. Canvases have
    // their pixels available synchronously after drawImage, unlike a
    // freshly-created <img>, so the preview is reliable on every drag.
    // Wrapped in a div with transparent left padding so the cursor
    // anchors to the LEFT of the visible thumbnail (bucket under the
    // cursor stays visible).
    // Resolve a drawable source + natural dimensions. Image cards expose
    // a loaded <img>; video cards render a <video> with no <img>, so the
    // old code skipped the block entirely and the browser fell back to a
    // full-size default ghost. For videos we draw the poster instead —
    // it's the saved first-frame thumb and is already cached (the card
    // shows it), so a fresh Image is normally decode-complete right away.
    // Falls back to the <video> element's own frame/dimensions if the
    // poster isn't ready, so the preview is at least correctly sized.
    const cardImg = e.currentTarget.querySelector?.('img');
    const cardVideo = e.currentTarget.querySelector?.('video');
    let drawSource = null;
    let natW = 0;
    let natH = 0;
    if (cardImg && cardImg.naturalWidth > 0) {
      drawSource = cardImg;
      natW = cardImg.naturalWidth;
      natH = cardImg.naturalHeight;
    } else if (cardVideo) {
      const posterSrc = cardVideo.getAttribute('poster');
      if (posterSrc) {
        const posterImg = new Image();
        posterImg.src = posterSrc;
        if (posterImg.complete && posterImg.naturalWidth > 0) {
          drawSource = posterImg;
          natW = posterImg.naturalWidth;
          natH = posterImg.naturalHeight;
        }
      }
      if (!drawSource && cardVideo.videoWidth > 0) {
        drawSource = cardVideo;
        natW = cardVideo.videoWidth;
        natH = cardVideo.videoHeight;
      }
    }
    if (drawSource && natW > 0) {
      const PREVIEW_W = 72;
      const aspect = natW / natH;
      const previewH = Math.max(40, Math.min(72, Math.round(PREVIEW_W / aspect)));

      // Canvas leaves 12px of padding on the top/right so the badge
      // can overhang the thumbnail like Finder's red drag count.
      const PAD = 12;
      const canvas = document.createElement('canvas');
      canvas.width = PREVIEW_W + PAD;
      canvas.height = previewH + PAD;
      const ctx = canvas.getContext('2d');
      // Round corners on the image by clipping inside a save/restore
      // so the badge below isn't constrained to the same path.
      const r = 6;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(r, PAD);
      ctx.arcTo(PREVIEW_W, PAD, PREVIEW_W, previewH + PAD, r);
      ctx.arcTo(PREVIEW_W, previewH + PAD, 0, previewH + PAD, r);
      ctx.arcTo(0, previewH + PAD, 0, PAD, r);
      ctx.arcTo(0, PAD, PREVIEW_W, PAD, r);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(drawSource, 0, PAD, PREVIEW_W, previewH);
      ctx.restore();

      // Multi-select: paint a Finder-style total-count badge in the
      // top-right corner that overhangs the image. Total (not delta)
      // so the user reads it as "I'm dragging 5 things", matching
      // macOS's drag-count convention.
      if (ids.length > 1) {
        const label = String(ids.length);
        ctx.font = 'bold 12px -apple-system, system-ui, sans-serif';
        const textW = ctx.measureText(label).width;
        const pillH = 20;
        const pillW = Math.max(pillH, textW + 12);
        const px = PREVIEW_W - pillW + 8;
        const py = 0;
        // White outline ring so the pill reads against any image.
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.roundRect(px - 2, py - 2, pillW + 4, pillH + 4, (pillH + 4) / 2);
        ctx.fill();
        ctx.fillStyle = '#ff3b30';
        ctx.beginPath();
        ctx.roundRect(px, py, pillW, pillH, pillH / 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(label, px + pillW / 2, py + pillH / 2 + 1);
      }

      // Wrapper carries the transparent left gap; cursor anchors at
      // the wrapper's top-left so the canvas trails to the right.
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        position: fixed; top: 0; left: -3000px;
        padding-left: 22px; pointer-events: none;
      `;
      wrapper.appendChild(canvas);
      document.body.appendChild(wrapper);
      e.dataTransfer.setDragImage(wrapper, 0, 0);
      setTimeout(() => wrapper.remove(), 0);
    }
  }, [selected, saves]);

  // Drop-onto-bucket from the grid. Sidebar invokes this when a card
  // (or selection) lands on a bucket row. Mirrors the per-card "Add to
  // Bucket" context menu behavior — flyToCollection animation,
  // collection-count refresh, and an Unsorted-view reload if needed.
  //
  // Move semantics: when the user is currently inside a bucket view
  // and drops onto a *different* bucket, the drag is treated as
  // "move from A to B" — we add to the target AND remove from the
  // source so the save doesn't sit in two buckets at once. Drops
  // from any non-bucket view (All, Unsorted, etc.) stay as pure
  // adds, matching the existing right-click → Add to Bucket menu.
  const handleAddSavesToBucket = useCallback(async (bucketId, saveIds) => {
    if (!bucketId || !Array.isArray(saveIds) || saveIds.length === 0) return;
    const sourceBucketId = (view.type === 'collection' && view.id !== bucketId)
      ? view.id
      : null;
    flyToCollection({
      collectionId: bucketId,
      items: saveIds.map((id) => {
        const s = saves.find((x) => x.id === id);
        return { saveId: id, imageSrc: s ? fileUrl(s.file_path) : null };
      }),
    });
    for (const saveId of saveIds) {
      await window.moodmark.collections.addSave({ collectionId: bucketId, saveId });
    }
    // Push undo: pure-add reverses with a remove-from-target;
    // a move-from-A-to-B reverses with remove-from-target plus
    // re-add to the source bucket.
    undoStack.push(
      saveIds.length === 1 ? 'add to collection' : 'add to collection',
      async () => {
        for (const saveId of saveIds) {
          await window.moodmark.collections.removeSave({ collectionId: bucketId, saveId });
        }
        if (sourceBucketId) {
          for (const saveId of saveIds) {
            await window.moodmark.collections.addSave({ collectionId: sourceBucketId, saveId });
          }
        }
        loadCollections();
        if (view.type === 'collection') reload();
      },
    );
    if (sourceBucketId) {
      for (const saveId of saveIds) {
        await window.moodmark.collections.removeSave({ collectionId: sourceBucketId, saveId });
      }
      // The current bucket view loses these saves — reload so they
      // disappear from the grid.
      reload();
    }
    loadCollections();
    if (view.type === 'unsorted') reload();
    if (saveIds.length > 1) setSelected(new Set());
  }, [saves, loadCollections, view, reload, undoStack]);

  // External file/URL dropped directly onto a sidebar folder row.
  // Saves through the standard pipeline (so dedup, palette, AI all
  // run as usual), then attaches each resulting save id to the
  // target folder. Returns the saved record ids so callers can
  // chain follow-up work if needed.
  const handleExternalDropToBucket = useCallback(async (bucketId, payload) => {
    if (!bucketId || !payload) return;
    const { files = [], urls = [] } = payload;
    const ids = [];
    for (const file of files) {
      try {
        const record = await window.moodmark.saves.dropFile(file);
        if (record?.id) ids.push(record.id);
      } catch (err) {
        console.error('External drop save failed:', err);
      }
    }
    if (files.length === 0 && urls.length > 0) {
      try {
        const record = await window.moodmark.saves.dropUrl(urls);
        if (record?.id) ids.push(record.id);
      } catch (err) {
        console.error('External URL drop save failed:', err);
      }
    }
    if (ids.length > 0) {
      for (const id of ids) {
        await window.moodmark.collections.addSave({ collectionId: bucketId, saveId: id });
      }
      loadCollections();
      if (view.type === 'collection' && view.id === bucketId) reload();
    }
  }, [loadCollections, view, reload]);

  // Library switch: closes the renderer's current view state and
  // re-fetches everything against the now-active library. The main
  // process has already closed + reopened the DB by the time we
  // get here.
  const handleSwitchLibrary = useCallback(async (id) => {
    if (!id || id === activeLibraryId) return;
    const res = await window.moodmark.libraries.switch(id);
    if (!res?.ok) return;
    // Kick off the crossfade: name the library we're landing in and let
    // the veil mask the grid/sidebar reload below. Re-keyed by id so a
    // rapid re-switch restarts the animation cleanly.
    const target = libraries.find((l) => l.id === id);
    setLibrarySwitchOverlay({ id, name: target?.name || 'Library' });
    if (librarySwitchTimerRef.current) clearTimeout(librarySwitchTimerRef.current);
    librarySwitchTimerRef.current = setTimeout(() => setLibrarySwitchOverlay(null), 820);
    setActiveLibraryId(id);
    setView({ type: 'all' });
    setFocusedId(null);
    setSelected(new Set());
    setSearch('');
    setColorFilter(null);
    // Saved shuffle seeds are keyed by view id, which means bucket
    // ids from the prior library. Clear so we don't carry them over.
    setShuffleSeeds(new Map());
    await loadCollections();
    await reload();
  }, [activeLibraryId, libraries, loadCollections, reload, setColorFilter, setSearch, setView]);

  const handleCreateLibrary = useCallback(async (name) => {
    if (proLocked) { requestUpgrade('libraries'); return; }
    const res = await window.moodmark.libraries.create(name);
    if (res?.ok && res.library) {
      await refreshLibraries();
      // Auto-switch to the newly-created library so the user lands
      // in their fresh empty space.
      await handleSwitchLibrary(res.library.id);
    }
  }, [refreshLibraries, handleSwitchLibrary, proLocked]);

  const handleRenameLibrary = useCallback(async (id, name) => {
    const res = await window.moodmark.libraries.rename(id, name);
    if (res?.ok) refreshLibraries();
  }, [refreshLibraries]);

  const handleDeleteLibrary = useCallback(async (id) => {
    const res = await window.moodmark.libraries.delete(id);
    if (!res?.ok) return;
    await refreshLibraries();
    // If the deleted library was the active one, the registry has
    // auto-promoted another library to active and the main process
    // has already reopened the DB against it. Reset every piece of
    // view state and refetch so the grid + sidebar reflect the
    // promoted library, not the one we just removed.
    if (res.wasActive) {
      setActiveLibraryId(res.newActiveId);
      setView({ type: 'all' });
      setFocusedId(null);
      setSelected(new Set());
      setSearch('');
      setColorFilter(null);
      await loadCollections();
      await reload();
    }
  }, [refreshLibraries, loadCollections, reload, setColorFilter, setSearch, setView]);

  const handleCreateCollection = useCallback(async (payload) => {
    const created = await window.moodmark.collections.create(payload);
    loadCollections();
    if (created?.id) {
      undoStack.push('new collection', async () => {
        await window.moodmark.collections.delete(created.id);
        loadCollections();
      });
    }
  }, [loadCollections, undoStack]);

  const handleRenameCollection = useCallback(async (payload) => {
    const previous = collections.find((c) => c.id === payload.id);
    await window.moodmark.collections.rename(payload);
    loadCollections();
    if (previous && previous.name !== payload.name) {
      undoStack.push('rename', async () => {
        await window.moodmark.collections.rename({ id: payload.id, name: previous.name });
        loadCollections();
      });
    }
  }, [collections, loadCollections, undoStack]);

  // Sidebar nav also drops focus + selection so users land on the masonry grid
  // instead of staying inside the FocusedView.
  const handleViewChange = useCallback((newView) => {
    setView(newView);
    setFocusedId(null);
    setSelected(new Set());
    // A view change is a different intent than "more like this one",
    // so drop any active similar-to anchor when the user navigates.
    setSimilarTo(null);
  }, [setView, setSimilarTo]);

  // Opening a collection card from the Search tab leaves search and
  // lands on that collection in Collections mode.
  const handleOpenCollectionFromSearch = useCallback((id) => {
    setAppMode('folders');
    handleViewChange({ type: 'collection', id });
  }, [handleViewChange]);

  // Single entry point for every "new collection" affordance (the two
  // grid tiles, the empty-state CTA, ⌘N, the menu). Creates the
  // collection, opens it, and nudges the title into rename mode so the
  // user lands inside the new collection with the name field focused
  // and selected, ready to type.
  const handleCreateAndOpenCollection = useCallback(async () => {
    const created = await window.moodmark.collections.create({ name: 'New collection' });
    await loadCollections();
    if (!created?.id) return created;
    undoStack.push('new collection', async () => {
      await window.moodmark.collections.delete(created.id);
      loadCollections();
    });
    // Boards mode owns the full main column, so a collection view can't
    // render there — drop to folders so the new collection actually opens.
    setAppMode((m) => (m === 'boards' ? 'folders' : m));
    handleViewChange({ type: 'collection', id: created.id });
    setRenameViewSignal((s) => s + 1);
    return created;
  }, [loadCollections, undoStack, handleViewChange]);

  // Tray-menu "Recent saves" entry click. Main fires 'focus:save'
  // with the id; mirror the duplicate-toast flow — switch to All so
  // the record is in displaySaves, then open it in the focused view.
  // Library swap (user switch OR backup restore) → repaint against
  // the new DB content. Triggered by main broadcasting library:switched.
  useEffect(() => {
    return window.moodmark.on('library:switched', () => {
      setFocusedId(null);
      setSelected(new Set());
      loadCollections();
      reload();
    });
  }, [loadCollections, reload]);

  useEffect(() => {
    return window.moodmark.on('focus:save', (id) => {
      if (!id) return;
      handleViewChange({ type: 'all' });
      setTimeout(() => setFocusedId(id), 80);
    });
  }, [handleViewChange]);

  // Fly to an existing save in the grid: switch to All, scroll its card
  // into view, and pulse it so the eye lands on it — rather than opening
  // the focused panel. Used by the duplicate-save "Show" action.
  const revealSaveInGrid = useCallback((id) => {
    if (!id) return;
    setFocusedId(null);
    // Suppress the per-view scroll-restore for this transition — we want
    // to land on the card, not the view's last offset.
    suppressViewRestoreRef.current = true;
    handleViewChange({ type: 'all' });
    // The All view reloads async; poll for the card, then scroll + pulse.
    let tries = 0;
    const tryReveal = () => {
      const el = document.querySelector(`[data-save-id="${(window.CSS && CSS.escape) ? CSS.escape(id) : id}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setHighlightId(id);
        suppressViewRestoreRef.current = false;
        setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2300);
        return;
      }
      if (tries++ < 25) { setTimeout(tryReveal, 80); return; }
      suppressViewRestoreRef.current = false;
    };
    setTimeout(tryReveal, 120);
  }, [handleViewChange]);

  // Duplicate-on-save toast. Main fires 'save:duplicate' with the
  // existing row whenever a drop / capture / drop-url tries to add
  // bytes that already live in the library. We show a brief toast with
  // a Show button that opens the existing save in the focused view —
  // immediate and unambiguous even when the duplicate is buried far down
  // the feed (no scroll hunting). Closing focus morphs back to its grid
  // card, so the user still gets the location.
  useEffect(() => {
    return window.moodmark.on('save:duplicate', (existing) => {
      if (!existing?.id) return;
      const thumbPath = existing.thumb_path || existing.preview_path || existing.file_path;
      showActionToast({
        message: 'Already in your library',
        thumb: thumbPath ? fileUrl(thumbPath) : undefined,
        durationMs: 4500,
        action: {
          label: 'Show',
          run: () => {
            // Switch to All so the record is in displaySaves, then open it.
            handleViewChange({ type: 'all' });
            setTimeout(() => setFocusedId(existing.id), 80);
          },
        },
      });
    });
  }, [showActionToast, handleViewChange]);

  const handleDeleteCollection = useCallback(async (id) => {
    await window.moodmark.collections.delete(id);
    // If we were viewing the deleted collection, go back to All
    if (view.type === 'collection' && view.id === id) handleViewChange({ type: 'all' });
    // Drop any saved shuffle seed for that bucket — it won't match
    // anything anymore but wastes localStorage space.
    setShuffleSeeds((prev) => {
      if (!prev.has(`collection:${id}`)) return prev;
      const next = new Map(prev);
      next.delete(`collection:${id}`);
      return next;
    });
    loadCollections();
  }, [view, handleViewChange, loadCollections]);

  // Open a collection's saves as a brand-new space — auto-creates a
  // board named after the collection, lays each save out as an image
  // item in a wrapping grid centered on the world origin, and
  // navigates the user straight into the new canvas.
  const handleOpenCollectionAsSpace = useCallback(async (collectionId) => {
    if (!collectionId) return;
    if (proLocked) { requestUpgrade('boards'); return; }
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) return;
    let collectionSaves = [];
    try {
      collectionSaves = await window.moodmark.saves.getAll({
        view: 'all',
        sort: 'newest',
        collectionId,
      });
    } catch (err) {
      console.error('Failed to load collection saves:', err);
      return;
    }
    const list = (Array.isArray(collectionSaves) ? collectionSaves : [])
      .filter((s) => !s.deleted_at);
    let board;
    try {
      board = await window.moodmark.boards.create({
        name: collection.name || 'Untitled space',
      });
    } catch (err) {
      console.error('Failed to create space:', err);
      return;
    }
    if (!board?.id) return;
    const cols = Math.min(Math.max(list.length, 1), 5);
    const cell = 240;
    const gap = 24;
    const totalW = cols * cell + (cols - 1) * gap;
    const zBase = Math.floor(Date.now() / 1000);
    const now = Date.now();
    const items = list.map((save, i) => {
      const colIdx = i % cols;
      const row = Math.floor(i / cols);
      const aspect = save.width && save.height ? save.width / save.height : 1;
      const w = aspect >= 1 ? cell : Math.round(cell * aspect);
      const h = aspect >= 1 ? Math.round(cell / aspect) : cell;
      const x = colIdx * (cell + gap) - totalW / 2;
      const y = row * (cell + gap) - cell;
      return {
        id: crypto.randomUUID(),
        board_id: board.id,
        type: 'image',
        x, y, width: w, height: h,
        rotation: 0,
        z_index: zBase + i,
        data: {
          saveId: save.id,
          fileUrl: fileUrl(save.file_path),
          naturalWidth: save.width || null,
          naturalHeight: save.height || null,
        },
        created_at: now,
        updated_at: now,
      };
    });
    if (items.length > 0) {
      try {
        await window.moodmark.boards.bulkUpdateItems({ boardId: board.id, items });
      } catch (err) {
        console.error('Open-as-space bulk insert failed:', err);
      }
    }
    // Seed the new board into the React boards state with thumbs
    // computed from the same `list` we just inserted. listBoardsWithThumbs
    // has been observed to return the new board with an empty thumbs
    // array even after bulkUpdateItems resolves — possibly a
    // better-sqlite3 visibility nuance with the freshly-committed
    // transaction. Whatever the cause, the renderer already knows the
    // exact thumb paths, so just put them into state directly. A
    // background loadBoards still runs for any other state that
    // changed.
    const newThumbs = list
      .slice(0, 4)
      .map((s) => s.thumb_path || s.file_path)
      .filter(Boolean);
    setBoards((prev) => {
      const without = prev.filter((b) => b.id !== board.id);
      return [
        ...without,
        { ...board, order_index: without.length, thumbs: newThumbs },
      ];
    });
    loadBoards();
    handleViewChange({ type: 'board', id: board.id });
  }, [collections, loadBoards, handleViewChange, proLocked]);

  const handleReorderCollections = useCallback(async (orderedIds) => {
    const previousOrder = collections.map((c) => c.id);
    // Optimistic local reorder so the sidebar doesn't flash back to old order.
    setCollections((prev) => {
      const byId = new Map(prev.map((c) => [c.id, c]));
      return orderedIds.map((id) => byId.get(id)).filter(Boolean);
    });
    await window.moodmark.collections.reorder(orderedIds);
    loadCollections();
    const same = previousOrder.length === orderedIds.length
      && previousOrder.every((id, i) => id === orderedIds[i]);
    if (!same) {
      undoStack.push('reorder', async () => {
        setCollections((prev) => {
          const byId = new Map(prev.map((c) => [c.id, c]));
          return previousOrder.map((id) => byId.get(id)).filter(Boolean);
        });
        await window.moodmark.collections.reorder(previousOrder);
        loadCollections();
      });
    }
  }, [collections, loadCollections, undoStack]);

  // Apply the shuffle seed to the IPC-sourced saves list. When the
  // seed is null this is a no-op; the same seed always produces the
  // same permutation so the order stays stable across re-renders.
  const displaySaves = useMemo(() => {
    if (shuffleSeed) {
      // Pull saves added AFTER the shuffle to the top in newest-first
      // order so freshly-dropped images always show at position #1.
      // Saves that existed when shuffle was applied keep the seeded
      // random order behind them.
      const fresh = [];
      const settled = [];
      for (const s of saves) {
        if ((s.created_at || 0) > shuffleAt) fresh.push(s);
        else settled.push(s);
      }
      fresh.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return [...fresh, ...seededShuffle(settled, shuffleSeed)];
    }
    if (sortMode === 'recent') return saves;
    // Clone before sorting so the underlying saves array (memoized
    // higher up) isn't mutated.
    const sorted = saves.slice();
    if (sortMode === 'oldest') {
      sorted.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    } else if (sortMode === 'name_asc' || sortMode === 'name_desc') {
      const dir = sortMode === 'name_asc' ? 1 : -1;
      // Untitled saves sort to the bottom regardless of direction so
      // a wall of "Untitled" entries doesn't flood the top of the
      // grid when sorting alphabetically.
      sorted.sort((a, b) => {
        const an = (a.title || '').trim();
        const bn = (b.title || '').trim();
        if (!an && !bn) return 0;
        if (!an) return 1;
        if (!bn) return -1;
        return an.localeCompare(bn) * dir;
      });
    }
    return sorted;
  }, [saves, shuffleSeed, shuffleAt, sortMode]);

  const visibleSaves = useMemo(() => {
    let base = displaySaves;
    // Bookmarks tweet-type sub-filter. Only narrows inside the
    // Bookmarks view; every other view ignores it (and the reset
    // effect keeps it 'all' elsewhere anyway).
    if (view.type === 'bookmarks' && tweetTypeFilter !== 'all') {
      base = base.filter((s) => tweetTypeOf(s) === tweetTypeFilter);
    }
    // Source sub-filter ('x' | 'instagram'). Rows default to source 'x',
    // so a missing/legacy value reads as X.
    if (view.type === 'bookmarks' && sourceFilter !== 'all') {
      base = base.filter((s) => (s.source || 'x') === sourceFilter);
    }
    return base;
  }, [displaySaves, view.type, tweetTypeFilter, sourceFilter]);

  // Mirror of visibleSaves for dependency-free callbacks (shift-click
  // range selection, ⌘C copy) that need the current ordered list without
  // being recreated — and re-rendering the grid — on every change.
  const visibleSavesRef = useRef(visibleSaves);
  useEffect(() => { visibleSavesRef.current = visibleSaves; }, [visibleSaves]);

  // Live per-type counts for the Bookmarks filter pills — a breakdown
  // of whatever's currently loaded in the Bookmarks view (so they
  // honour an active search). null outside the Bookmarks view, where
  // the pills aren't shown.
  const tweetTypeCounts = useMemo(() => {
    if (view.type !== 'bookmarks') return null;
    const counts = { all: 0, text: 0, image: 0, video: 0 };
    for (const s of saves) {
      const t = tweetTypeOf(s);
      if (!t) continue;
      counts.all += 1;
      counts[t] += 1;
    }
    return counts;
  }, [saves, view.type]);

  // Live per-source counts for the Saved view's source toggle. null
  // outside the Saved view, where the toggle isn't shown.
  const sourceCounts = useMemo(() => {
    if (view.type !== 'bookmarks') return null;
    const counts = { all: 0, x: 0, instagram: 0 };
    for (const s of saves) {
      counts.all += 1;
      counts[(s.source || 'x') === 'instagram' ? 'instagram' : 'x'] += 1;
    }
    return counts;
  }, [saves, view.type]);

  const focusedIndex = useMemo(
    () => (focusedId ? displaySaves.findIndex((s) => s.id === focusedId) : -1),
    [displaySaves, focusedId],
  );
  const focused = focusedIndex >= 0 ? displaySaves[focusedIndex] : null;

  if (focusedId && !focused) {
    setFocusedId(null);
  }

  // The last card the user clicked — the anchor for shift-click range
  // selection. Kept in a ref so handleSelect can stay dependency-free.
  const selectionAnchorRef = useRef(null);
  const handleSelect = useCallback((id, mods) => {
    // Back-compat: older callers passed a boolean "additive". New callers
    // pass { toggle, range } so we can tell Cmd-click (toggle one) from
    // Shift-click (select the range from the anchor).
    const toggle = mods === true || !!(mods && mods.toggle);
    const range = !!(mods && mods.range);

    // Shift-click: select every card between the anchor and this one,
    // in the grid's visible order, and add it to the selection.
    if (range && selectionAnchorRef.current) {
      const list = visibleSavesRef.current;
      const a = list.findIndex((s) => s.id === selectionAnchorRef.current);
      const b = list.findIndex((s) => s.id === id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i += 1) next.add(list[i].id);
          return next;
        });
        return;
      }
    }

    // Shift-click with no anchor yet: just select this card (and make it
    // the anchor) rather than opening the focused view.
    if (range) {
      selectionAnchorRef.current = id;
      setSelected((prev) => new Set(prev).add(id));
      return;
    }

    if (toggle) {
      selectionAnchorRef.current = id;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }

    selectionAnchorRef.current = id;
    setSelected(new Set());
    morphFocus({
      setMorphId,
      applyState: () => setFocusedId(id),
      id,
    });
  }, []);

  // Copy a save's actual image bytes to the system clipboard (⌘C and the
  // right-click menu). Reads the local file via main and reports the
  // result with a brief toast. Returns whether it succeeded.
  const copyImageById = useCallback(async (id) => {
    if (!id) return false;
    const rec = visibleSavesRef.current.find((s) => s.id === id);
    if (!rec?.file_path) return false;
    const result = await window.moodmark.image.copyToClipboard(rec.file_path);
    showActionToast({
      message: result?.ok ? 'Copied to clipboard' : 'Could not copy image',
      durationMs: result?.ok ? 1400 : 2400,
    });
    return !!result?.ok;
  }, [showActionToast]);

  // Closing the focused view runs the same morph in reverse — the
  // focused image animates back into the masonry card it came from.
  const handleCloseFocused = useCallback(() => {
    if (focusedId == null) return;
    morphFocus({
      setMorphId,
      applyState: () => setFocusedId(null),
      id: focusedId,
    });
  }, [focusedId]);

  // Bulk Restore (Trash → library) and bulk Delete Forever from the
  // selection bar when in Trash. Both go through the action toast so
  // the user can undo within the 5s window.
  const handleRestoreSelected = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    for (const id of ids) await restoreSave(id);
    setSelected(new Set());
    showRestoreToast(ids);
  }, [selected, restoreSave, showRestoreToast]);

  const handlePermanentDeleteSelected = useCallback(() => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setSelected(new Set());
    showPermanentDeleteToast(ids);
  }, [selected, showPermanentDeleteToast]);

  // Focused-sort mode — full-screen triage overlay for the Unsorted
  // view. Toolbar exposes the entry button only when on Unsorted
  // and there's at least one save to sort + at least one bucket.
  const [focusedSortOpen, setFocusedSortOpen] = useState(false);

  // Scroll-to-top FAB. Tracks the .grid-scroll element via a callback
  // ref so we re-attach the scroll listener whenever the grid mounts
  // (after a view change, after exiting the focused view, etc.).
  // 720px threshold = ~3-4 rows of cards before the button appears.
  const gridScrollRef = useRef(null);
  // Preserve grid scroll across the full-screen (focused) view. The grid
  // unmounts while focused is open, so we remember the last scroll offset
  // and restore it when the grid remounts on close.
  const lastGridScrollRef = useRef(0);
  const pendingGridScrollRef = useRef(null);
  const scrollHandlerRef = useRef(null);
  // Per-view scroll memory (relaunch + view-switch restore). currentViewKeyRef
  // tracks which view's offset the scroll handler should record; pendingRestoreRef
  // holds the offset to re-apply once the incoming view's cards have rendered.
  const viewScrollRef = useRef(readViewScroll());
  const currentViewKeyRef = useRef(viewKeyOf(view));
  const pendingRestoreRef = useRef(viewScrollRef.current[viewKeyOf(view)] ?? null);
  // Set while "reveal in grid" is flying to a card, so the per-view scroll
  // restore doesn't fight its scrollIntoView during the same transition.
  const suppressViewRestoreRef = useRef(false);
  const [scrolledFar, setScrolledFar] = useState(false);
  // Separate near-top tracker for the toolbar's mode pill, which
  // shrinks on any non-trivial scroll and pops back at the top.
  // Threshold sits above 0 so a tiny inertial overshoot doesn't
  // flicker the state.
  const [scrolledOff, setScrolledOff] = useState(false);
  const setGridScrollNode = useCallback((node) => {
    if (scrollHandlerRef.current) {
      scrollHandlerRef.current.node.removeEventListener(
        'scroll', scrollHandlerRef.current.fn,
      );
      scrollHandlerRef.current = null;
    }
    gridScrollRef.current = node;
    if (!node) {
      setScrolledFar(false);
      setScrolledOff(false);
      setScrolledPastBuckets(false);
      setScrolledHideBar(false);
      return;
    }
    let ticking = false;
    let persistTimer = null;
    const fn = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const t = node.scrollTop;
        lastGridScrollRef.current = t;
        // Remember this view's offset, debounced to localStorage so a
        // relaunch (or returning to the view) lands back here.
        viewScrollRef.current[currentViewKeyRef.current] = t;
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
          try {
            localStorage.setItem(VIEW_SCROLL_KEY, JSON.stringify(viewScrollRef.current));
          } catch { /* quota / private mode — ignore */ }
        }, 400);
        setScrolledFar(t > 720);
        setScrolledOff(t > 8);
        // ~past the featured-buckets row (chip rail + cards): below this
        // the real collection cards are gone, so the drop-dock takes over.
        setScrolledPastBuckets(t > 150);
        // Hysteresis band so the toolbar doesn't flicker hide/show when
        // the user hovers around the threshold.
        setScrolledHideBar((prev) => (prev ? t > 60 : t > 140));
        ticking = false;
      });
    };
    scrollHandlerRef.current = { node, fn };
    node.addEventListener('scroll', fn, { passive: true });
    // Returning from the focused view: restore where the user was. Done
    // after layout (rAF) so the masonry is tall enough to scroll into.
    if (pendingGridScrollRef.current != null) {
      const target = pendingGridScrollRef.current;
      pendingGridScrollRef.current = null;
      lastGridScrollRef.current = target;
      node.scrollTop = target;
      requestAnimationFrame(() => {
        if (gridScrollRef.current === node) node.scrollTop = target;
      });
    }
    const t0 = node.scrollTop;
    lastGridScrollRef.current = t0;
    setScrolledFar(t0 > 720);
    setScrolledOff(t0 > 8);
    setScrolledPastBuckets(t0 > 150);
    setScrolledHideBar(t0 > 140);
  }, []);
  const scrollGridToTop = useCallback(() => {
    gridScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // When the focused view opens, stash the grid's current scroll so the
  // remount on close can restore it (instead of jumping to the top).
  const prevFocusedIdRef = useRef(focusedId);
  useEffect(() => {
    const wasOpen = prevFocusedIdRef.current != null;
    prevFocusedIdRef.current = focusedId;
    if (!wasOpen && focusedId != null) {
      pendingGridScrollRef.current = lastGridScrollRef.current;
    }
  }, [focusedId]);
  // On a view change (and the initial mount), record which view's scroll
  // we're tracking and queue that view's last-known offset to restore.
  // Clears the focused-view remount target so it can't bleed across views.
  useEffect(() => {
    currentViewKeyRef.current = viewKeyOf(view);
    pendingGridScrollRef.current = null;
    pendingRestoreRef.current = viewScrollRef.current[viewKeyOf(view)] ?? null;
  }, [view]);

  // Apply the queued scroll once the incoming view's cards have actually
  // rendered (so the container is tall enough to scroll into). The
  // .grid-scroll node persists across view changes, so we scroll it
  // imperatively rather than relying on a remount. Skipped in the focused
  // view, which has its own restore-on-close path above.
  useEffect(() => {
    if (focusedId) return;
    if (suppressViewRestoreRef.current) { pendingRestoreRef.current = null; return; }
    if (pendingRestoreRef.current == null) return;
    if (!visibleSaves.length) return;
    const target = pendingRestoreRef.current;
    pendingRestoreRef.current = null;
    const apply = () => {
      const n = gridScrollRef.current;
      if (n) n.scrollTop = target;
    };
    requestAnimationFrame(() => { apply(); requestAnimationFrame(apply); });
  }, [view, visibleSaves.length, focusedId]);

  // Escape on the Search tab (empty query) returns to wherever the user
  // came from, scroll intact. SearchView clears a non-empty query on the
  // first Escape (and stops propagation), so this only fires once the
  // field is empty. We rewrite the shared `all:` scroll key (Search and
  // Library both map to it) back to the pre-search offset, then let the
  // generic per-view restore land it once the prior view's cards render.
  const handleEscapeFromSearch = useCallback(() => {
    const prev = preSearchRef.current;
    if (!prev) { setAppMode('library'); return; }
    preSearchRef.current = null;
    viewScrollRef.current[viewKeyOf(prev.view)] = prev.scrollTop;
    setAppMode(prev.mode);
    setView(prev.view);
  }, [setView]);
  useEffect(() => {
    if (appMode !== 'search') return undefined;
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (focusedId) return; // focused view owns Escape
      if ((search || '').trim()) return; // SearchView clears the query first
      e.preventDefault();
      handleEscapeFromSearch();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appMode, search, focusedId, handleEscapeFromSearch]);

  const focusedSortAssign = useCallback(async (saveId, collectionId) => {
    await window.moodmark.collections.addSave({ collectionId, saveId });
    // The save just became sorted, so the Unsorted view should drop
    // it. Reload + refresh collection counts so progress stays in
    // sync with the underlying state.
    reload();
    loadCollections();
  }, [reload, loadCollections]);

  // Composting-trash burst state. When the user empties trash we
  // Empty Trash: same deferred-toast pattern. Operates on every save
  // currently visible in the Trash view (so search-filtered Empty
  // Trash means "empty what you see"; an unfiltered view empties all).
  const handleEmptyTrash = useCallback(() => {
    if (saves.length === 0) return;
    playEmptyTrashSound();
    const ids = saves.map((s) => s.id);
    const n = ids.length;
    setSelected(new Set());
    // Emptying trash is irreversible once it commits, so make the cancel
    // window explicit: a countdown the user can cancel before files unlink.
    showPermanentDeleteToast(ids, {
      countdown: true,
      message: n === 1 ? 'Emptying trash · 1 item' : `Emptying trash · ${n} items`,
    });
  }, [saves, showPermanentDeleteToast]);

  const handleOpenInPreview = useCallback((filePath) => {
    window.moodmark.image.openInPreview(filePath);
  }, []);

  const handleOpenFromCard = useCallback(
    (record) => {
      handleOpenInPreview(record.file_path);
    },
    [handleOpenInPreview],
  );

  // Right-click on the focused image — reuses the canonical card
  // menu so item order matches the grid right-click verbatim. Open in
  // Preview + Export now live inside buildCardMenuItems, so there's
  // nothing to prepend here.
  const handleFocusedContextMenu = useCallback(async (e) => {
    e.preventDefault();
    if (!focused) return;
    const saveId = focused.id;
    let memberIds = [];
    try {
      const rows = await window.moodmark.collections.getForSave(saveId);
      memberIds = (rows || []).map((r) => r.id);
    } catch { /* fall through with empty list */ }
    const items = buildCardMenuItems(saveId, memberIds);
    if (items.length === 0) return;
    setCardCtx({ saveId, x: e.clientX, y: e.clientY, items });
  }, [focused, buildCardMenuItems]);

  const handleDelete = useCallback(
    async (id) => {
      await deleteSave(id);
      if (focusedId === id) setFocusedId(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showTrashToast([id]);
    },
    [deleteSave, focusedId],
  );

  const handleDeleteSelected = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    for (const id of ids) {
      await deleteSave(id);
    }
    setSelected(new Set());
    if (focusedId && ids.includes(focusedId)) setFocusedId(null);
    showTrashToast(ids);
  }, [selected, deleteSave, focusedId]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Bucket ids that ALL selected saves are already in — the bulk
  // picker hides these so we don't offer no-op moves.
  const [bulkAlreadyIn, setBulkAlreadyIn] = useState(new Set());
  const openBulkPicker = useCallback(async (e) => {
    if (collections.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ids = [...selected];
    let already = new Set();
    if (ids.length > 0) {
      try {
        const result = await window.moodmark.collections.containingAll(ids);
        already = new Set(result || []);
      } catch { /* leave empty on failure */ }
    }
    // If every folder is already a member of every selected save, the
    // picker would be empty. Show a quick confirming toast instead of
    // an empty menu floating over the selection bar.
    const offerable = collections.filter((c) => !already.has(c.id));
    if (offerable.length === 0) {
      showActionToast({ message: 'Already in every collection', durationMs: 1800 });
      return;
    }
    setBulkAlreadyIn(already);
    setBulkPicker({ x: rect.left, y: rect.top - 4 });
  }, [collections, selected, showActionToast]);

  const handleBulkExportBoard = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      const result = await window.moodmark.boards.export(ids);
      if (result?.ok) {
        // Selection cleared on success so the success state isn't ambiguous.
        setSelected(new Set());
      }
    } catch (err) {
      console.error('Board export failed:', err);
    }
  }, [selected]);

  // Bulk file export: copy the selected saves' underlying images into
  // a folder the user picks. Distinct from the moodboard composite —
  // this hands you back the original files.
  const handleBulkExportFiles = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      const result = await window.moodmark.saves.exportBulk(ids);
      if (result?.ok) {
        setSelected(new Set());
      }
    } catch (err) {
      console.error('Bulk file export failed:', err);
    }
  }, [selected]);

  // Same selection but bundled as a zip rather than copied loose.
  const handleBulkExportZip = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      const result = await window.moodmark.saves.exportBulkZip(ids);
      if (result?.ok) {
        setSelected(new Set());
      }
    } catch (err) {
      console.error('Bulk zip export failed:', err);
    }
  }, [selected]);

  // Anchored popover above the Export button with the two destinations.
  const [exportPicker, setExportPicker] = useState(null); // { x, y } | null
  const openExportPicker = useCallback((e) => {
    if (selected.size === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setExportPicker({ x: rect.left, y: rect.top - 4 });
  }, [selected.size]);
  const exportPickerItems = useMemo(() => {
    if (!exportPicker) return [];
    return [
      {
        label: 'Export as Files',
        icon: <DownloadIcon />,
        onClick: handleBulkExportFiles,
      },
      {
        label: 'Export as Zip',
        icon: <DownloadIcon />,
        onClick: handleBulkExportZip,
      },
    ];
  }, [exportPicker, handleBulkExportFiles, handleBulkExportZip]);

  const bulkPickerItems = useMemo(() => {
    if (!bulkPicker) return [];
    const ids = [...selected];
    // Hide folders every selected save is already a member of —
    // adding again would be a no-op for all of them. The picker
    // never opens with an empty offer set; openBulkPicker shows a
    // toast instead, so we don't render a "Already in every folder"
    // header here anymore.
    const offer = collections.filter((c) => !bulkAlreadyIn.has(c.id));
    return [
      { type: 'header', label: `Add ${ids.length} to collection` },
      ...offer.map((c) => ({
        label: c.name,
        icon: (
          <span style={{ color: 'var(--icon-blue)', display: 'inline-flex' }}>
            <CollectionIcon />
          </span>
        ),
        onClick: async () => {
          flyToCollection({
            collectionId: c.id,
            items: ids.map((id) => {
              const s = saves.find((x) => x.id === id);
              return { saveId: id, imageSrc: s ? fileUrl(s.file_path) : null };
            }),
          });
          for (const saveId of ids) {
            await window.moodmark.collections.addSave({ collectionId: c.id, saveId });
          }
          loadCollections();
          if (view.type === 'unsorted') reload();
        },
      })),
    ];
  }, [bulkPicker, bulkAlreadyIn, selected, collections, saves, loadCollections, view, reload]);

  // Bulk tag affordance — anchored to its trigger button in the
  // selection bar, applied to every save in the current selection.
  // Refreshes allTags after the writes so the picker (and any open
  // detail panel) sees the new save_count immediately.
  const openBulkTagPicker = useCallback((rect) => {
    if (!rect || selected.size === 0) return;
    setBulkTagPicker({ x: rect.left + rect.width / 2, y: rect.top });
  }, [selected]);

  const handleBulkApplyTag = useCallback(async (name) => {
    if (selected.size === 0 || !name) return;
    const ids = [...selected];
    setBulkTagPicker(null);
    for (const saveId of ids) {
      try {
        await window.moodmark.tags.addToSave({ saveId, name });
      } catch (err) {
        console.error('[bulk-tag] addToSave failed for', saveId, err);
      }
    }
    await loadAllTags();
    showActionToast({
      message: `Tagged ${ids.length} ${ids.length === 1 ? 'save' : 'saves'} with #${name}`,
      durationMs: 2000,
    });
  }, [selected, loadAllTags, showActionToast]);

  const goPrev = useCallback(() => {
    if (focusedIndex > 0) setFocusedId(displaySaves[focusedIndex - 1].id);
  }, [focusedIndex, displaySaves]);

  const goNext = useCallback(() => {
    if (focusedIndex >= 0 && focusedIndex < displaySaves.length - 1) {
      setFocusedId(displaySaves[focusedIndex + 1].id);
    }
  }, [focusedIndex, displaySaves]);

  // ── Global keyboard shortcuts ──────────────────────────────────────────
  // ⌘F focus search · ⌘N new collection · Delete on selection ·
  // J/K next/prev in focused view. The handler bails when the user is
  // typing in an input so app-level keys never steal a keystroke.
  useEffect(() => {
    function isTypingTarget(el) {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }

    function onKey(e) {
      const cmd = e.metaKey || e.ctrlKey;
      const typing = isTypingTarget(e.target);

      // Cmd/Ctrl combos always claim the key, even from inputs — these
      // are global app commands.

      // Cmd+1 / Cmd+2 / Cmd+3 — flip the toolbar mode pill. Don't
      // claim digits when typing into a field (input rename, new-
      // folder name, search bar, etc.) so users can still type "1".
      if (cmd && !e.shiftKey && !typing && (e.key === '1' || e.key === '2' || e.key === '3')) {
        e.preventDefault();
        const target = e.key === '1' ? 'library' : e.key === '2' ? 'folders' : 'boards';
        handleModeChange(target);
        return;
      }

      // Easter egg — Cmd/Ctrl+Shift+B casts warm "window blinds" sun
      // across the whole app for a few seconds.
      if (cmd && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setSunBlindsOpen(true);
        return;
      }

      if (cmd && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setQuickSwitcherOpen((v) => !v);
        return;
      }
      if (cmd && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
        return;
      }
      if (cmd && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        handleCreateAndOpenCollection();
        return;
      }

      // Cmd+A — select all visible saves. Cmd+Shift+A clears the
      // selection. Skipped while typing so Cmd+A in an input still
      // selects the field's text.
      if (cmd && (e.key === 'a' || e.key === 'A')) {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) {
          setSelected(new Set());
        } else {
          setSelected(new Set(visibleSaves.map((s) => s.id)));
        }
        return;
      }

      // Cmd+C — copy the image to the clipboard (the mirror of paste-to-
      // save). Targets the open save, else the single selected one, else
      // the hovered card. Skipped while typing so ⌘C still copies text.
      if (cmd && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        if (typing) return;
        if (window.getSelection?.()?.toString()) return; // real text selection
        const targetId = focusedId
          || (selected.size === 1 ? selected.values().next().value : null)
          || hoveredSaveId
          || (selected.size > 1 ? selected.values().next().value : null);
        if (!targetId) return;
        e.preventDefault();
        copyImageById(targetId);
        return;
      }

      // Single-key shortcuts: skip when typing so we don't eat real input.
      if (typing) return;

      // Spacebar Quick Look. Hover a card, hit space, get a peek;
      // space (or Esc) again to dismiss. Click already opens the
      // focused view in this app, so hover is the trigger that
      // doesn't fight existing behaviour. Falls back to the first
      // selected save for keyboard-only users.
      if (e.code === 'Space') {
        if (peekedSaveId) {
          e.preventDefault();
          setPeekedSaveId(null);
          return;
        }
        if (focusedId) return;
        const target = hoveredSaveId
          || (selected.size > 0 ? selected.values().next().value : null);
        if (target) {
          e.preventDefault();
          setPeekedSaveId(target);
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size > 0 && !focusedId) {
          e.preventDefault();
          handleDeleteSelected();
        }
        return;
      }

      // J / K aliases for next / prev in the focused view.
      if (focusedId) {
        if (e.key === 'j' || e.key === 'J') {
          e.preventDefault();
          goNext();
        } else if (e.key === 'k' || e.key === 'K') {
          e.preventDefault();
          goPrev();
        }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedId, selected, handleDeleteSelected, goNext, goPrev, peekedSaveId, hoveredSaveId, handleModeChange, visibleSaves, handleCreateAndOpenCollection, copyImageById]);

  // Menu's "Quick Look" item (no accelerator on the menu side because
  // a menu-bound Space would steal keystrokes from text fields). The
  // menu fires a CustomEvent which we handle with the same logic as
  // the spacebar path above.
  useEffect(() => {
    function onPeek() {
      if (focusedId) return;
      if (peekedSaveId) {
        setPeekedSaveId(null);
        return;
      }
      const target = hoveredSaveId
        || (selected.size > 0 ? selected.values().next().value : null);
      if (target) setPeekedSaveId(target);
    }
    window.addEventListener('moodmark:quick-look', onPeek);
    return () => window.removeEventListener('moodmark:quick-look', onPeek);
  }, [focusedId, selected, peekedSaveId, hoveredSaveId]);

  // Global Cmd+Z (Ctrl+Z on non-Mac). Pops the latest mutation off
  // the undo stack and surfaces a brief "Undid <label>" toast. Skips
  // anything fired from a real text input — the OS-native browser
  // undo for those fields takes precedence so the user's word-by-
  // word edits stay reversible inside the field.
  useEffect(() => {
    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      if ((e.key || '').toLowerCase() !== 'z') return;
      const t = e.target;
      if (
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      ) return;
      e.preventDefault();
      const label = undoStack.undo();
      if (label) {
        showActionToast({ message: `Undid ${label}`, durationMs: 1600 });
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [undoStack, showActionToast]);

  // Trackpad gestures on the masonry surface:
  //   - Pinch-to-zoom: Chromium fires `wheel` with ctrlKey set on
  //     trackpad pinch. We accumulate deltaY and bump gridColumns
  //     by ±1 once we cross a threshold so the column count steps
  //     in discrete units rather than ramping smoothly with the
  //     gesture (the masonry can't fluidly inter-column).
  //   - Two-finger horizontal swipe: navigate between smart views
  //     and top-level buckets, in their sidebar order. Cooldown
  //     prevents rapid-fire when the trackpad coasts on inertia.
  useEffect(() => {
    if (focused) return undefined;
    if (view.type === 'board') return undefined; // board has its own pan/zoom
    const layout = document.querySelector('.layout');
    if (!layout) return undefined;

    const PINCH_THRESHOLD = 30;
    const SWIPE_DELTA_X = 80;
    const SWIPE_DELTA_Y_MAX = 20;
    const SWIPE_COOLDOWN_MS = 700;
    let pinchAccum = 0;
    let lastSwipe = 0;

    const navTargets = [
      { type: 'all' },
      { type: 'unsorted' },
      { type: 'onThisDay' },
      { type: 'trash' },
      ...collections
        .filter((c) => !c.parent_id)
        .map((c) => ({ type: 'collection', id: c.id })),
    ];

    function indexOfCurrent() {
      return navTargets.findIndex((t) => {
        if (t.type !== view.type) return false;
        if (t.type === 'collection') return t.id === view.id;
        return true;
      });
    }

    function navigate(direction) {
      const i = indexOfCurrent();
      if (i < 0) return;
      const next = (i + direction + navTargets.length) % navTargets.length;
      setView(navTargets[next]);
    }

    function onWheel(e) {
      // Pinch — Chromium synthesises ctrlKey on trackpad pinch.
      if (e.ctrlKey) {
        e.preventDefault();
        pinchAccum += e.deltaY;
        if (Math.abs(pinchAccum) >= PINCH_THRESHOLD) {
          // Pinch out (deltaY < 0) = zoom in = fewer columns.
          // Pinch in (deltaY > 0) = zoom out = more columns.
          setGridColumns((c) => Math.max(1, Math.min(8, c + (pinchAccum > 0 ? 1 : -1))));
          pinchAccum = 0;
        }
        return;
      }
      // Horizontal swipe — only fire when the gesture is clearly
      // sideways and we're not in the middle of an inertial scroll
      // following a vertical one. Skip if the event came from an
      // element that owns its own horizontal scroll (e.g. the
      // featured-buckets row) so its native scroll isn't hijacked.
      if (Math.abs(e.deltaX) > SWIPE_DELTA_X && Math.abs(e.deltaY) < SWIPE_DELTA_Y_MAX) {
        if (e.target?.closest?.('[data-allow-horizontal-scroll]')) return;
        const now = Date.now();
        if (now - lastSwipe < SWIPE_COOLDOWN_MS) return;
        lastSwipe = now;
        navigate(e.deltaX > 0 ? 1 : -1);
      }
    }

    layout.addEventListener('wheel', onWheel, { passive: false });
    return () => layout.removeEventListener('wheel', onWheel);
  }, [collections, view, focused, setView]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const items = [...e.dataTransfer.items];
    const couldBeImage = items.some(
      (i) =>
        (i.kind === 'file' && i.type.startsWith('image/')) ||
        (i.kind === 'string' &&
          (i.type === 'text/uri-list' || i.type === 'text/html')),
    );
    if (couldBeImage) setDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
  }, []);

  // After a successful drop / paste / upload we used to push the user
  // straight into the detail view, but that hides the new card behind
  // the focused-view overlay — including the shimmer animation that
  // makes new arrivals easy to spot. Now we just make sure the grid
  // is showing All so the save is visible, and let the user click in
  // if they want to inspect it.
  const focusAfterDrop = useCallback(() => {
    if (view.type !== 'all') setView({ type: 'all' });
    setSelected(new Set());
  }, [view, setView]);

  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);

    const all = [...e.dataTransfer.files];
    const isZip = (f) => f.type === 'application/zip' || /\.zip$/i.test(f.name || '');
    const zips = all.filter(isZip);
    const images = all.filter((f) => !isZip(f) && f.type.startsWith('image/'));

    if (zips.length > 0) {
      for (const file of zips) {
        try {
          await window.moodmark.saves.dropZip(file);
        } catch (err) {
          console.error('Zip drop failed:', err);
        }
      }
    }

    if (images.length > 0) {
      let lastId = null;
      const newIds = [];
      for (const file of images) {
        try {
          const record = await window.moodmark.saves.dropFile(file);
          if (record?.id) {
            lastId = record.id;
            newIds.push(record.id);
          }
        } catch (err) {
          console.error('Drop failed:', err);
        }
      }
      // Inside a collection view, attach the freshly-imported saves
      // to that collection and stay put — focusAfterDrop would jump
      // back to view=all, which loses context. Mirrors the same
      // behaviour the FAB upload path uses in handleFileInput.
      if (view.type === 'collection' && view.id && newIds.length) {
        for (const saveId of newIds) {
          try {
            await window.moodmark.collections.addSave({
              collectionId: view.id, saveId,
            });
          } catch (err) {
            console.error('Add-to-collection-on-drop failed:', err);
          }
        }
        loadCollections();
        reload();
        setSelected(new Set());
      } else if (lastId) {
        focusAfterDrop();
      }
    }

    if (zips.length > 0 || images.length > 0) return;

    const candidates = extractDropImageUrls(e.dataTransfer);
    if (candidates.length === 0) return;

    try {
      const record = await window.moodmark.saves.dropUrl(candidates);
      if (!record?.id) return;
      // Same collection-scoping rule the Finder-file branch above
      // uses: if we're inside a collection, attach the new save to
      // it and stay put. Without this, dragging an image off a
      // browser tab into an open collection would import the image
      // but bounce the user back to view=all via focusAfterDrop.
      if (view.type === 'collection' && view.id) {
        try {
          await window.moodmark.collections.addSave({
            collectionId: view.id, saveId: record.id,
          });
        } catch (err) {
          console.error('Add-to-collection-on-drop-url failed:', err);
        }
        loadCollections();
        reload();
        setSelected(new Set());
      } else {
        focusAfterDrop();
      }
    } catch (err) {
      console.error('URL drop failed:', err);
    }
  }, [focusAfterDrop, view, loadCollections, reload]);

  // Paste an image into the library (cmd-V). Mirrors the drop pipeline:
  // raw image bytes from the clipboard go through pasteImage (a pasted
  // image has no filesystem path, so dropFile can't be used), and a
  // bare image URL falls back to dropUrl. When pasting inside a
  // collection the new saves get attached to it — same scoping rule as
  // onDrop. Skipped while a board is open (BoardView owns cmd-V there)
  // and while the user is typing in an editable field.
  useEffect(() => {
    const attachToCollectionOrFocus = async (newIds) => {
      if (view.type === 'collection' && view.id && newIds.length) {
        for (const saveId of newIds) {
          try {
            await window.moodmark.collections.addSave({
              collectionId: view.id, saveId,
            });
          } catch (err) {
            console.error('Add-to-collection-on-paste failed:', err);
          }
        }
        loadCollections();
        reload();
        setSelected(new Set());
      } else if (newIds.length) {
        focusAfterDrop();
      }
    };

    const onPaste = async (e) => {
      if (view.type === 'board') return;
      const target = e.target;
      if (
        target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      const cd = e.clipboardData;
      if (!cd) return;

      const imageFiles = [...(cd.items || [])]
        .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter(Boolean);

      if (imageFiles.length > 0) {
        e.preventDefault();
        const newIds = [];
        for (const file of imageFiles) {
          try {
            const buf = await file.arrayBuffer();
            const ext = (file.type.split('/')[1] || 'png').toLowerCase();
            const record = await window.moodmark.saves.pasteImage(
              new Uint8Array(buf),
              ext,
            );
            if (record?.id) newIds.push(record.id);
          } catch (err) {
            console.error('Paste failed:', err);
          }
        }
        if (newIds.length) {
          await attachToCollectionOrFocus(newIds);
          showActionToast({ message: 'Pasted from clipboard', durationMs: 1800 });
        }
        return;
      }

      // No image bytes — see if the clipboard holds an image URL.
      const candidates = extractDropImageUrls(cd);
      if (candidates.length === 0) return;
      e.preventDefault();
      try {
        const record = await window.moodmark.saves.dropUrl(candidates);
        if (record?.id) {
          await attachToCollectionOrFocus([record.id]);
          showActionToast({ message: 'Pasted from clipboard', durationMs: 1800 });
        }
      } catch (err) {
        console.error('Paste URL failed:', err);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [view, focusAfterDrop, showActionToast, loadCollections, reload]);

  // Hidden file picker — triggered by the "+" button on the All Saves
  // sidebar row. Routes the chosen files through the same dropFile +
  // focusAfterDrop pipeline as drag-and-drop.
  const fileInputRef = useRef(null);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback(async (e) => {
    const picked = [...e.target.files];
    e.target.value = ''; // reset so re-picking the same file fires onChange again
    const isZip = (f) => f.type === 'application/zip' || /\.zip$/i.test(f.name || '');
    const zips = picked.filter(isZip);
    const images = picked.filter((f) => !isZip(f) && f.type.startsWith('image/'));
    if (zips.length === 0 && images.length === 0) return;
    for (const file of zips) {
      try {
        await window.moodmark.saves.dropZip(file);
      } catch (err) {
        console.error('Zip upload failed:', err);
      }
    }
    // Track every fresh save id so we can route them into the
    // active collection when the user added them while viewing
    // one (FAB context).
    const newIds = [];
    for (const file of images) {
      try {
        const record = await window.moodmark.saves.dropFile(file);
        if (record?.id) newIds.push(record.id);
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }
    if (view.type === 'collection' && view.id && newIds.length) {
      for (const saveId of newIds) {
        try {
          await window.moodmark.collections.addSave({
            collectionId: view.id, saveId,
          });
        } catch (err) {
          console.error('Add-to-collection-on-upload failed:', err);
        }
      }
      loadCollections();
      // Stay inside the collection — the new saves were just
      // attached to it, jumping to view=all would lose context.
      // reload() refreshes the visible grid so the new items
      // show up in place.
      reload();
      setSelected(new Set());
      return;
    }
    if (newIds.length) focusAfterDrop();
  }, [focusAfterDrop, view, loadCollections, reload]);

  // Drop Finder files directly onto a featured-buckets / folder-grid
  // card. Imports each file via the standard dropFile pipeline, then
  // routes the resulting save ids through handleAddSavesToBucket so
  // the same fly-to-collection animation + undo entry as an in-app
  // drop fires. Filters out non-images so dragging a PDF or random
  // file doesn't half-succeed.
  const handleDropFilesToBucket = useCallback(async (bucketId, fileList) => {
    if (!bucketId) return;
    const all = [...(fileList || [])];
    const isZip = (f) => f.type === 'application/zip' || /\.zip$/i.test(f.name || '');
    const images = all.filter((f) => !isZip(f) && f.type && f.type.startsWith('image/'));
    const zips = all.filter(isZip);

    // Zips can't be associated with a specific bucket from here (the
    // ingest happens entirely main-side and we don't surface the new
    // save ids yet), so just import them into the library.
    for (const file of zips) {
      try { await window.moodmark.saves.dropZip(file); }
      catch (err) { console.error('Zip drop-to-bucket failed:', err); }
    }

    if (images.length === 0) return;
    const newIds = [];
    for (const file of images) {
      try {
        const record = await window.moodmark.saves.dropFile(file);
        if (record?.id) newIds.push(record.id);
      } catch (err) {
        console.error('Drop-to-bucket failed:', err);
      }
    }
    if (newIds.length === 0) return;
    await handleAddSavesToBucket(bucketId, newIds);
  }, [handleAddSavesToBucket]);

  return (
   <EntitlementProvider value={ent}>
    <div
      className={`app-shell${dragging ? ' drag-over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/zip,.zip"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />

      <div className="layout">
        {/* Sidebar removed in nav stage 4d — replaced by:
            - LibrarySwitcher in toolbar's left cluster
            - Mode pill (Library / Folders / Boards) in toolbar
            - SmartChipRail at top of Library mode
            - FolderGrid for browsing folders
            - BoardGrid for browsing boards
            - Theme + settings + help in toolbar's right cluster
            Drag-to-folder is the one functional regression; Stage
            5 brings it back as a multi-select inline action. */}

        <div className="main-col">
          {view.type === 'board' ? (
            <BoardView
              key={view.id}
              boardId={view.id}
              saves={saves}
              collections={collections}
              onRenameBoard={handleRenameBoard}
              onExit={() => { setView({ type: 'all' }); loadBoards(); }}
              onShowToast={(message) => showActionToast({ message, durationMs: 1800 })}
              onSetAppDragging={setDragging}
              onLibraryReload={reload}
            />
          ) : focused ? (
            <FocusedView
              record={focused}
              index={focusedIndex}
              total={saves.length}
              onBack={handleCloseFocused}
              onPrev={goPrev}
              onNext={goNext}
              hasPrev={focusedIndex > 0}
              hasNext={focusedIndex < saves.length - 1}
              onDelete={handleDelete}
              morphSource={morphId === focused.id}
              onContextMenu={handleFocusedContextMenu}
              videoMuted={prefs.videoMuted !== false}
              onVideoMutedChange={handleVideoMutedChange}
              altImageIdx={focusedAltImageIdx}
            />
          ) : (
            <>
              <div
                className={`toolbar-shell${(appMode === 'library' || (appMode === 'folders' && view.type === 'collection')) && scrolledHideBar ? ' toolbar-hidden' : ''}`}
              >
               <div className="toolbar-shell-inner">
              <Toolbar
                search={search}
                onSearchChange={setSearch}
                recentSearches={recentSearches.items}
                onRecordSearch={recentSearches.recordSearch}
                onClearRecentSearches={recentSearches.clearAll}
                columns={gridColumns}
                onColumnsChange={setGridColumns}
                layout={gridLayout}
                onLayoutChange={setGridLayout}
                onOpenQuickSwitcher={() => setQuickSwitcherOpen(true)}
                semanticSearchActive={semanticSearchActive}
                colorFilter={colorFilter}
                onClearColorFilter={() => setColorFilter(null)}
                similarTo={similarTo}
                onClearSimilar={() => setSimilarTo(null)}
                searchInputRef={searchInputRef}
                viewTitle={null}
                viewIcon={null}
                onBackToAll={null}
                mode={appMode}
                onModeChange={handleModeChange}
                modePillCompact={false}
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenShortcuts={() => setShortcutsOpen(true)}
                onOpenReleaseNotes={handleOpenReleaseNotes}
                onOpenRediscover={() => setRediscoverOpen(true)}
                releaseNotesUnseen={releaseNotesUnseen}
                libraries={libraries}
                activeLibraryId={activeLibraryId}
                onSwitchLibrary={handleSwitchLibrary}
                onCreateLibrary={handleCreateLibrary}
                onRefreshLibraries={refreshLibraries}
                onRenameLibrary={handleRenameLibrary}
                onDeleteLibrary={handleDeleteLibrary}
                onManageLibraries={() => {
                  setSettingsDrawerHint({ drawer: 'libraries', key: Date.now() });
                  setSettingsOpen(true);
                }}
                onUpload={handleUploadClick}
                onSaveUrl={() => setSaveUrlOpen(true)}
              />
               </div>
              </div>
              {/* The mode tabs are a single fixed-position pill, always
                  rendered, overlaying the toolbar's invisible spacer slot
                  in the exact same place. When the toolbar rolls up on
                  scroll this pill simply stays put — no crossfade, no
                  shift, no flash. */}
              <div className="mode-pill-float">
                <ModePill mode={appMode} onModeChange={handleModeChange} />
              </div>
              {appMode === 'search' ? (
                // Dedicated Search tab — search-first canvas. Hero field
                // up top, then the landing chips (empty query) or the
                // scrollable masonry of matches, reusing the library Grid.
                <SearchView
                  search={search}
                  onSearchChange={setSearch}
                  onRecordSearch={recentSearches.recordSearch}
                  onClearRecentSearches={recentSearches.clearAll}
                  recentSearches={recentSearches.items}
                  suggestedTags={suggestedTags}
                  collections={collections}
                  onOpenCollection={handleOpenCollectionFromSearch}
                  searchInputRef={searchInputRef}
                  scrollRef={setGridScrollNode}
                  saves={visibleSaves}
                  selected={selected}
                  onSelect={handleSelect}
                  onSetSelection={(ids) => setSelected(new Set(ids))}
                  onOpen={handleOpenFromCard}
                  onContextMenu={handleCardContextMenu}
                  onDragStart={handleCardDragStart}
                  onHover={handleCardHover}
                  onForceClick={handleCardForceClick}
                  columns={gridColumns}
                  loading={loading}
                  view={view}
                  semanticSearchActive={semanticSearchActive}
                  colorFilter={colorFilter}
                  freshIds={freshIds}
                  layout={gridLayout}
                  morphId={morphId}
                  tweetTypeFilter={tweetTypeFilter}
                  sourceFilter={sourceFilter}
                  highlightId={highlightId}
                />
              ) : appMode === 'folders' && view.type === 'all' ? (
                // Folders mode, no folder picked yet → tile grid of
                // root-level folders. Clicking a tile sets view to
                // that collection; back-to-all returns here.
                <FolderGrid
                  folders={collections}
                  parentId={null}
                  onPickFolder={(id) => handleViewChange({ type: 'collection', id })}
                  onCreateFolder={handleCreateAndOpenCollection}
                  onRenameFolder={handleRenameCollection}
                  onDeleteFolder={handleDeleteCollection}
                  onReorderFolders={handleReorderCollections}
                  onAddSavesToBucket={handleAddSavesToBucket}
                  onDropFilesToBucket={handleDropFilesToBucket}
                  onExternalDropToBucket={handleExternalDropToBucket}
                  onSetAppDragging={setDragging}
                  onOpenCollectionAsSpace={handleOpenCollectionAsSpace}
                  scrollRef={setGridScrollNode}
                />
              ) : appMode === 'boards' ? (
                // Boards mode → tile grid of every board. Clicking
                // a tile sets view to that board, which is handled
                // higher in the render tree by BoardView (the canvas
                // owns the full main column when active).
                <BoardGrid
                  boards={boards}
                  onPickBoard={(id) => handleViewChange({ type: 'board', id })}
                  onCreateBoard={async () => {
                    const board = await handleCreateBoard();
                    if (board?.id) handleViewChange({ type: 'board', id: board.id });
                  }}
                  onRenameBoard={handleRenameBoard}
                  onDeleteBoard={handleDeleteBoard}
                  onReorderBoards={handleReorderBoards}
                  scrollRef={setGridScrollNode}
                />
              ) : (
              <div className="library-stage">
              <CollectionDropDock
                collections={collections}
                scrolled={(appMode === 'library' || (appMode === 'folders' && view.type === 'collection')) && scrolledHideBar}
                dragging={saveDragActive}
                inCollectionIds={dragInCollectionIds}
                onAddSavesToBucket={handleAddSavesToBucket}
                onDropFilesToBucket={handleDropFilesToBucket}
                onExternalDropToBucket={handleExternalDropToBucket}
                onSetAppDragging={setDragging}
                onOpenCollection={(id) => handleViewChange({ type: 'collection', id })}
                onDismiss={() => setSaveDragActive(false)}
              />
              <div className="grid-scroll" ref={setGridScrollNode}>
                {(appMode === 'library'
                  || (appMode === 'folders' && view.type === 'collection')) && (
                  <SmartChipRail
                    activeViewType={
                      ['all', 'unsorted', 'bookmarks', 'trash'].includes(view.type)
                        ? view.type
                        : 'all'
                    }
                    counts={smartCounts}
                    onPick={(v) => handleViewChange(v)}
                    tweetTypeFilter={tweetTypeFilter}
                    tweetTypeCounts={tweetTypeCounts}
                    onTweetTypeChange={setTweetTypeFilter}
                    sourceFilter={sourceFilter}
                    sourceCounts={sourceCounts}
                    onSourceChange={setSourceFilter}
                    sortMode={sortMode}
                    onSortChange={setSortMode}
                    columns={gridColumns}
                    onColumnsChange={setGridColumns}
                    viewTitle={view.type === 'collection'
                      ? collections.find((c) => c.id === view.id)?.name ?? null
                      : null}
                    onBack={view.type === 'collection'
                      ? () => handleViewChange({ type: 'all' })
                      : null}
                    onRenameViewTitle={view.type === 'collection'
                      ? (name) => handleRenameCollection({ id: view.id, name })
                      : null}
                    autoRenameSignal={renameViewSignal}
                  />
                )}
                {view.type === 'all' && collections.length > 0 && !search && (
                  <FeaturedBuckets
                    collections={collections}
                    onCreateCollection={handleCreateAndOpenCollection}
                    onPickBucket={(id) => handleViewChange({ type: 'collection', id })}
                    onRenameCollection={handleRenameCollection}
                    onDeleteCollection={handleDeleteCollection}
                    onShuffleView={handleShuffleView}
                    onAddSavesToBucket={handleAddSavesToBucket}
                    onDropFilesToBucket={handleDropFilesToBucket}
                    onExternalDropToBucket={handleExternalDropToBucket}
                    onSetAppDragging={setDragging}
                    onOpenCollectionAsSpace={handleOpenCollectionAsSpace}
                  />
                )}
                <Grid
                  saves={visibleSaves}
                  selected={selected}
                  onSelect={handleSelect}
                  onSetSelection={(ids) => setSelected(new Set(ids))}
                  onOpen={handleOpenFromCard}
                  onContextMenu={handleCardContextMenu}
                  onDragStart={handleCardDragStart}
                  onHover={handleCardHover}
                  onForceClick={handleCardForceClick}
                  columns={gridColumns}
                  loading={loading}
                  view={view}
                  search={search}
                  semanticSearchActive={semanticSearchActive}
                  colorFilter={colorFilter}
                  freshIds={freshIds}
                  layout={gridLayout}
                  morphId={morphId}
                  tweetTypeFilter={tweetTypeFilter}
                  sourceFilter={sourceFilter}
                  highlightId={highlightId}
                />
              </div>
              </div>
              )}
            </>
          )}
        </div>

        {focused && (
          <DetailPanel
            record={focused}
            allCollections={collections}
            allTags={allTags}
            aiConfigured={aiConfigured}
            aiIndexing={indexingIds.has(focused.id)}
            altImageIdx={focusedAltImageIdx}
            onAltImageIdxChange={setFocusedAltImageIdx}
            onClose={() => setFocusedId(null)}
            onCollectionsChanged={loadCollections}
            onTagsChanged={loadAllTags}
            onUpdateMeta={undoableUpdateSaveMeta}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSave={(id) => setFocusedId(id)}
            onOpenSpace={(boardId) => {
              setFocusedId(null);
              handleViewChange({ type: 'board', id: boardId });
            }}
          />
        )}
      </div>

      {actionToast && (
        <div className="trash-toast" role="status">
          {actionToast.thumb && (
            actionToast.action ? (
              <button
                type="button"
                className="trash-toast-thumb-btn"
                onClick={runActionToastAction}
                aria-label={actionToast.action.label || 'Show'}
                title={actionToast.action.label || 'Show'}
              >
                <img src={actionToast.thumb} alt="" className="trash-toast-thumb" />
              </button>
            ) : (
              <img src={actionToast.thumb} alt="" className="trash-toast-thumb" />
            )
          )}
          <span className="trash-toast-label">{actionToast.message}</span>
          {actionToast.countdown && (
            <span className="trash-toast-countdown" aria-label={`${countdownLeft} seconds to cancel`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle className="trash-toast-ring-track" cx="12" cy="12" r="10" />
                <circle
                  className="trash-toast-ring-progress"
                  cx="12"
                  cy="12"
                  r="10"
                  style={{ animationDuration: `${actionToast.durationMs}ms` }}
                />
              </svg>
              <span className="trash-toast-countdown-num">{countdownLeft}</span>
            </span>
          )}
          {actionToast.onUndo && (
            <button type="button" className="trash-toast-undo" onClick={handleActionToastUndo}>
              {actionToast.countdown ? 'Cancel' : 'Undo'}
            </button>
          )}
          {actionToast.action && (
            <button type="button" className="trash-toast-undo" onClick={runActionToastAction}>
              {actionToast.action.label}
            </button>
          )}
        </div>
      )}

      {!focused && selected.size > 0 && view.type === 'trash' && (
        <div className="selection-bar">
          <div className="selection-status">
            <span className="selection-count">{selected.size} selected</span>
            <button
              type="button"
              className="selection-clear-link"
              onClick={clearSelection}
            >
              Clear
            </button>
          </div>
          <button
            type="button"
            className="selection-btn selection-btn-compact"
            onClick={handleRestoreSelected}
            data-tooltip="Restore"
            aria-label="Restore"
          >
            <span className="selection-btn-icon"><RestoreIcon /></span>
          </button>
          <button
            type="button"
            className="selection-btn selection-btn-danger selection-btn-compact"
            onClick={handlePermanentDeleteSelected}
            data-tooltip="Delete forever"
            aria-label="Delete forever"
          >
            <span className="selection-btn-icon"><TrashIcon /></span>
          </button>
        </div>
      )}

      {!focused && selected.size > 0 && view.type !== 'trash' && (
        <div className="selection-bar">
          <div className="selection-status">
            <span className="selection-count">
              {selected.size} selected
            </span>
            <button
              type="button"
              className="selection-clear-link"
              onClick={clearSelection}
            >
              Clear
            </button>
          </div>
          {collections.length > 0 && (
            <button
              type="button"
              className="selection-btn selection-btn-compact"
              onClick={openBulkPicker}
              data-tooltip="Add to collection"
              aria-label="Add to folder"
            >
              <span className="selection-btn-icon"><CollectionIcon /></span>
            </button>
          )}
          <button
            type="button"
            className="selection-btn selection-btn-compact"
            onClick={(e) => openBulkTagPicker(e.currentTarget.getBoundingClientRect())}
            data-tooltip="Add tag"
            aria-label="Add tag to selection"
          >
            <span className="selection-btn-icon"><HashIcon /></span>
          </button>
          <button
            type="button"
            className="selection-btn selection-btn-compact"
            onClick={openExportPicker}
            data-tooltip="Export"
            aria-label="Export selected images"
          >
            <span className="selection-btn-icon"><DownloadIcon /></span>
            <span className="selection-btn-chevron" aria-hidden="true">
              <svg width="8" height="6" viewBox="0 0 8 6">
                <path d="M0 0l4 6 4-6z" fill="currentColor" />
              </svg>
            </span>
          </button>
          {selected.size >= 2 && (
            <button
              type="button"
              className="selection-btn selection-btn-compact"
              onClick={handleBulkExportBoard}
              data-tooltip="Make moodboard"
              aria-label="Composite the selection into a single moodboard PNG"
            >
              <span className="selection-btn-icon"><BoardExportIcon /></span>
            </button>
          )}
          <button
            type="button"
            className="selection-btn selection-btn-danger selection-btn-compact"
            onClick={handleDeleteSelected}
            data-tooltip="Delete"
            aria-label="Delete"
          >
            <span className="selection-btn-icon"><TrashIcon /></span>
          </button>
        </div>
      )}

      {!focused && view.type === 'trash' && selected.size === 0 && saves.length > 0 && (
        <div className="selection-bar">
          <div className="selection-status">
            <span className="selection-count">
              {saves.length} in Trash
            </span>
          </div>
          <button
            type="button"
            className="selection-btn selection-btn-danger selection-btn-compact"
            onClick={handleEmptyTrash}
            data-tooltip="Empty trash"
            aria-label="Empty trash"
          >
            <span className="selection-btn-icon"><TrashIcon /></span>
          </button>
        </div>
      )}

      {dragging && (
        <div className="drop-overlay">
          <span className="drop-message">Drop to save</span>
        </div>
      )}

      {librarySwitchOverlay && (
        <div className="library-switch-overlay" key={librarySwitchOverlay.id} aria-hidden="true">
          <div className="library-switch-card">
            <span className="library-switch-eyebrow">Library</span>
            <span className="library-switch-name">{librarySwitchOverlay.name}</span>
          </div>
        </div>
      )}


      {pendingUpdate && (
        <button
          type="button"
          className="update-pill"
          onClick={handleApplyUpdate}
          title="Restart to apply the downloaded update"
        >
          <span className="update-pill-dot" aria-hidden="true" />
          <span>
            <strong>
              {pendingUpdate.version ? `v${pendingUpdate.version} ready` : 'Update ready'}
            </strong>
            {' · Restart'}
          </span>
        </button>
      )}

      {/* Floating action — pinned bottom-right. Only shows when the
          user is sitting in Unsorted with stuff to sort and at least
          one bucket to sort it into. Hidden during the modal itself
          and during focused detail-view to keep the corner clean. */}
      {!focused
        && !focusedSortOpen
        && view.type === 'unsorted'
        && saves.length > 0
        && collections.length > 0 && (
        <button
          type="button"
          className="sort-fab"
          onClick={() => setFocusedSortOpen(true)}
          title="Open each unsorted save full-screen and file it with one keystroke"
        >
          <span className="sort-fab-icon"><SortFabIcon /></span>
          <span>Focused sort</span>
          <span className="sort-fab-count">{saves.length}</span>
        </button>
      )}

      {/* Scroll-to-top — shows once the masonry has been scrolled past
          ~720px. Stacks above the sort-fab via --scroll-top-offset
          when both are visible at the same time. */}
      {scrolledFar && !focused && !focusedSortOpen && (
        <button
          type="button"
          className="scroll-top-fab"
          onClick={scrollGridToTop}
          title="Scroll to top"
          aria-label="Scroll to top"
        >
          <ArrowUp aria-hidden="true" />
        </button>
      )}

      {focusedSortOpen && (
        <FocusedSortMode
          saves={saves}
          collections={collections}
          onAssign={focusedSortAssign}
          onClose={() => setFocusedSortOpen(false)}
        />
      )}

      {cardCtx && (
        <ContextMenu
          x={cardCtx.x}
          y={cardCtx.y}
          items={cardCtx.items}
          onClose={() => setCardCtx(null)}
        />
      )}

      <QuickLookOverlay
        save={peekedSaveId ? saves.find((s) => s.id === peekedSaveId) || null : null}
        onDismiss={() => setPeekedSaveId(null)}
      />

      <QuickSwitcher
        open={quickSwitcherOpen}
        onClose={() => setQuickSwitcherOpen(false)}
        collections={collections}
        allTags={allTags}
        onPickBucket={(id) => {
          setFocusedId(null);
          setView({ type: 'collection', id });
        }}
        onPickTag={(name) => {
          setFocusedId(null);
          if (view.type !== 'all') setView({ type: 'all' });
          setSearch(name);
          requestAnimationFrame(() => searchInputRef.current?.focus());
        }}
        onPickSave={(id) => {
          setFocusedId(id);
        }}
      />

      {bulkPicker && (
        <ContextMenu
          x={bulkPicker.x}
          y={bulkPicker.y}
          items={bulkPickerItems}
          onClose={() => setBulkPicker(null)}
        />
      )}

      {bulkTagPicker && (
        <BulkTagPicker
          anchor={bulkTagPicker}
          allTags={allTags}
          count={selected.size}
          onApply={handleBulkApplyTag}
          onClose={() => setBulkTagPicker(null)}
        />
      )}

      <RediscoverMode
        open={rediscoverOpen}
        saves={saves}
        collections={collections}
        onTrash={async (id) => {
          await deleteSave(id);
        }}
        onAddToBucket={async (saveId, collectionId) => {
          try {
            await window.moodmark.collections.addSave({ collectionId, saveId });
            loadCollections();
          } catch (err) {
            console.error('[rediscover] addSave failed:', err);
          }
        }}
        onEmptyTrash={async (ids) => {
          // Permanently remove exactly the items trashed this session —
          // matches the "Empty trash (N)" count on the recap screen.
          for (const id of ids || []) {
            try { await window.moodmark.saves.permanentDelete(id); }
            catch (err) { console.error('[rediscover] permanentDelete failed:', err); }
          }
        }}
        onClose={() => {
          setRediscoverOpen(false);
          // Refresh the grid view since trash + bucket changes
          // happened underneath while the overlay was open.
          reload();
        }}
      />

      {exportPicker && (
        <ContextMenu
          x={exportPicker.x}
          y={exportPicker.y}
          items={exportPickerItems}
          onClose={() => setExportPicker(null)}
        />
      )}

      <SettingsModal
        open={settingsOpen}
        drawerHint={settingsDrawerHint}
        onClose={() => setSettingsOpen(false)}
        onConfiguredChange={setAiConfigured}
        onPrefsChange={setPrefs}
        libraries={libraries}
        activeLibraryId={activeLibraryId}
        onSwitchLibrary={handleSwitchLibrary}
        onCreateLibrary={handleCreateLibrary}
        onRenameLibrary={handleRenameLibrary}
        onDeleteLibrary={handleDeleteLibrary}
        onLibraryWiped={() => {
          // Reset focus + selection in case the user was viewing a
          // save mid-wipe, then re-pull collections/saves/boards so
          // the UI reflects the now-empty (or freshly-restored)
          // library. Also used by the walkthrough's dev "Undo last
          // Start fresh" button.
          setFocusedId(null);
          setSelected(new Set());
          loadCollections();
          loadBoards();
          reload();
        }}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <AIUnlockedModal
        open={aiUnlockedOpen}
        onClose={() => setAiUnlockedOpen(false)}
      />

      <SaveUrlModal
        open={saveUrlOpen}
        onClose={() => setSaveUrlOpen(false)}
        onSaved={async (record) => {
          // Same FAB-in-collection behavior as the image upload
          // path: file the new save into the collection the user
          // was viewing.
          if (view.type === 'collection' && view.id && record?.id) {
            try {
              await window.moodmark.collections.addSave({
                collectionId: view.id, saveId: record.id,
              });
              loadCollections();
            } catch (err) {
              console.error('Add-URL-to-collection failed:', err);
            }
          }
          reload();
        }}
      />

      <PasteToSavePrompt
        // Don't pop the prompt over a modal or the focused view.
        paused={saveUrlOpen || !!focusedId}
        onVisibleChange={setPastePromptVisible}
        onSaved={async (record) => {
          if (view.type === 'collection' && view.id && record?.id) {
            try {
              await window.moodmark.collections.addSave({ collectionId: view.id, saveId: record.id });
              loadCollections();
            } catch (err) {
              console.error('Add-URL-to-collection failed:', err);
            }
          }
          reload();
        }}
      />

      <AddFab
        visible={
          // Library "All" view, or any collection view — regardless
          // of how the user got into the collection (FeaturedBuckets
          // card above the masonry, Collections tab tile, or a
          // sidebar entry). The folder-grid "all" on the Folders tab
          // is still excluded because there's no destination
          // collection for the new save to land in.
          !focusedId
          // Hidden while the paste-to-save prompt is up — they share the
          // bottom-right corner.
          && !pastePromptVisible
          && (
            (appMode === 'library' && view.type === 'all')
            || view.type === 'collection'
          )
        }
        onUpload={handleUploadClick}
        onSaveUrl={() => setSaveUrlOpen(true)}
      />

      <ConfirmHost />

      <SunBlinds open={sunBlindsOpen} onClose={() => setSunBlindsOpen(false)} />

      <WhatsNewModal
        open={!!whatsNewNotes}
        onClose={() => setWhatsNewNotes(null)}
        notes={whatsNewNotes}
      />

      <OnboardingOverlay />

      {/* Remote in-app notice (incident / heads-up / longform update),
          pushed from the Worker without an app release. */}
      <Announcement />

      {/* Free-tier upgrade banner (trial countdown / "upgrade to keep
          saving") and the upgrade modal opened from any locked action. */}
      <UpgradeBanner
        entitlement={ent}
        onUpgrade={() => { setUpgradeFeature(null); setUpgradeOpen(true); }}
      />
      <UpgradeModal
        open={upgradeOpen}
        feature={upgradeFeature}
        entitlement={ent}
        onClose={() => setUpgradeOpen(false)}
      />
    </div>
   </EntitlementProvider>
  );
}
