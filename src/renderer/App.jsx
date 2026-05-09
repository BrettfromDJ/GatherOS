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
import WelcomeModal from './components/WelcomeModal.jsx';
import WhatsNewModal from './components/WhatsNewModal.jsx';
import { pickNotesForUpgrade, RELEASE_NOTES } from './data/releaseNotes.js';
import ShortcutsModal from './components/ShortcutsModal.jsx';
import Toolbar from './components/Toolbar.jsx';
import Grid from './components/Grid.jsx';
import FeaturedBuckets from './components/FeaturedBuckets.jsx';
import FolderGrid from './components/FolderGrid.jsx';
import BoardGrid from './components/BoardGrid.jsx';
import SmartChipRail from './components/SmartChipRail.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import FocusedView from './components/FocusedView.jsx';
import BoardView from './components/BoardView.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import FocusedSortMode from './components/FocusedSortMode.jsx';
import VariantOptionsModal from './components/VariantOptionsModal.jsx';
import {
  LayoutDashboard,
  Download,
  X,
  Inbox,
  Trash2,
  RotateCcw,
  Copy,
  MinusCircle,
  ArrowRightFromLine,
  ArrowUp,
  Clipboard,
  ExternalLink,
  Hash,
  Share,
  Sparkles,
} from 'lucide-react';
import { useLibrary } from './hooks/useLibrary.js';
import { useUndoStack } from './hooks/useUndoStack.js';
import { useRecentSearches } from './hooks/useRecentSearches.js';
import { extractDropImageUrls } from './lib/dropUrls.js';
import { fileUrl } from './lib/fileUrl.js';
import { flyToCollection } from './lib/flyToCollection.js';
import { seededShuffle } from './lib/shuffle.js';

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
const SortFabIcon = () => <ArrowRightFromLine {...ICON} />;
const ClipboardIcon = () => <Clipboard {...ICON} />;
const ExternalLinkIcon = () => <ExternalLink {...ICON} />;
const HashIcon = () => <Hash {...ICON} />;
const ShareIcon = () => <Share {...ICON} />;
const SparklesIcon = () => <Sparkles {...ICON} />;

export default function App() {
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
      return raw === 'folders' || raw === 'boards' ? raw : 'library';
    } catch { return 'library'; }
  });
  useEffect(() => {
    try { localStorage.setItem('moodmark.appMode', appMode); } catch {}
  }, [appMode]);

  // Switching the pill always returns to the mode's "root" — Library
  // shows the unfiltered masonry, Folders shows the tile grid (root
  // level), Boards shows the boards grid. Without this, switching to
  // Folders while already drilled into a collection would render the
  // drilled-in masonry instead of the grid the user expected.
  const handleModeChange = useCallback((nextMode) => {
    setAppMode(nextMode);
    setView({ type: 'all' });
  }, [setView]);

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
  const [gridColumns, setGridColumns] = useState(3);

  // In-flight image variant generations. Each entry is a placeholder
  // that prepends to the masonry while the OpenAI call is running so
  // the user sees an immediate "something is happening" affordance.
  // The card shows the source image at reduced opacity with a loading
  // overlay; the entry is dropped from this list on success or
  // failure.
  const [pendingVariants, setPendingVariants] = useState([]);

  // Active sort mode for the masonry. Persisted per-app (not per-
  // view) — the user's preference is a global setting, not a
  // per-folder toggle. Shuffle takes precedence when active.
  const [sortMode, setSortMode] = useState(() => {
    try {
      const raw = localStorage.getItem('moodmark.sortMode');
      if (raw === 'oldest' || raw === 'name_asc' || raw === 'name_desc') return raw;
    } catch {}
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
  // Restore the focused-view save on launch from the persisted
  // window state. If the save no longer exists we'll clear it once
  // the saves list loads (see effect below) so the focused view
  // doesn't render empty forever.
  const [focusedId, setFocusedId] = useState(
    () => window.moodmark?.app?.windowState?.focusedId || null,
  );
  // Spacebar Quick Look — a lightweight, dismissible peek of the
  // currently-focused save without opening the full focused view.
  // Holds a save id while the overlay is up, null when dismissed.
  const [peekedSaveId, setPeekedSaveId] = useState(null);
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
  // Tracks which save is currently morphing between grid and focused
  // view. Used to attach the matching view-transition-name on both
  // source (masonry image) and target (focused image) so the browser
  // animates the shared element in place.
  const [morphId, setMorphId] = useState(null);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Sidebar removed in nav stage 4d. The legacy auto-collapse-on-
  // board-entry effect lived here; with no sidebar there's nothing
  // to collapse.

  // Multi-library state. Loaded once on mount; refreshed whenever
  // the user creates / renames / deletes from the library switcher.
  const [libraries, setLibraries] = useState([]);
  const [activeLibraryId, setActiveLibraryId] = useState(null);
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
          setCreateCollectionSignal((s) => s + 1);
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

  // Splash runs once on the user's first-ever launch only. Subsequent
  // launches go straight into the app — TTI under ~200ms is more
  // important than a brand moment for a returning user. The
  // localStorage flag persists alongside other UI prefs (cheap and
  // user-scoped; no IPC needed).
  const SPLASH_FLAG_KEY = 'moodmark.splashSeen';
  const [booting, setBooting] = useState(() => {
    try { return localStorage.getItem(SPLASH_FLAG_KEY) !== '1'; }
    catch { return false; }
  });
  useEffect(() => {
    if (booting) return;
    try { localStorage.setItem(SPLASH_FLAG_KEY, '1'); } catch {}
  }, [booting]);

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
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [whatsNewNotes, setWhatsNewNotes] = useState(null);
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
      showWelcome: () => setWelcomeOpen(true),
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
  const [prefs, setPrefs] = useState({ autoNameOnSave: true, semanticSearch: false });

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
  // Counter rather than boolean — Sidebar's effect listens for any
  // change so the same shortcut can fire repeatedly (close + reopen
  // the inline form).
  const [createCollectionSignal, setCreateCollectionSignal] = useState(0);
  useEffect(() => {
    window.moodmark.ai.hasSession().then(setAiConfigured);
    window.moodmark.settings.getPrefs().then(setPrefs);
  }, []);
  // True when both the toggle is on AND the user is signed-in to a
  // license session — search will route through embeddings rather
  // than LIKE.
  const semanticSearchActive = aiConfigured && !!prefs.semanticSearch;

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
  const [smartCounts, setSmartCounts] = useState({ all: 0, unsorted: 0, trash: 0, onThisDay: 0 });

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
      : { all: 0, unsorted: 0, trash: 0, onThisDay: 0 });
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

  const handleCreateBoard = useCallback(async () => {
    const board = await window.moodmark.boards.create({ name: 'Untitled board' });
    await loadBoards();
    return board;
  }, [loadBoards]);

  const handleRenameBoard = useCallback(async ({ id, name }) => {
    await window.moodmark.boards.rename({ id, name });
    await loadBoards();
  }, [loadBoards]);

  const handleDeleteBoard = useCallback(async (id) => {
    await window.moodmark.boards.delete(id);
    setView((v) => (v.type === 'board' && v.id === id ? { type: 'all' } : v));
    await loadBoards();
  }, [loadBoards, setView]);

  // Refresh collection counts whenever the grid refreshes — and also
  // whenever the local saves array shrinks/grows from an optimistic
  // mutation (delete, restore, empty-trash). Without the saves.length
  // dep, sidebar count badges go stale until the next full reload.
  useEffect(() => {
    if (!loading) loadCollections();
  }, [loading, saves.length, loadCollections]);

  // First-launch starter-pack install. Once the initial library
  // load resolves and we know the user has zero saves AND the
  // localStorage flag isn't set, kick off the install. The save:
  // created notifications fired by the main-process handler stream
  // in via the existing save:created listener and refresh the grid.
  const starterInstallStartedRef = useRef(false);
  useEffect(() => {
    if (starterInstallStartedRef.current) return;
    if (loading) return; // wait for the first saves.getAll to resolve
    let installed = false;
    try { installed = localStorage.getItem('moodmark.starterInstalled') === '1'; }
    catch {}
    if (installed) return;
    if (smartCounts.all > 0 || collections.length > 0) {
      // The user already has data — they migrated in or the install
      // ran on a prior launch before the flag was written. Mark the
      // flag and skip.
      try { localStorage.setItem('moodmark.starterInstalled', '1'); } catch {}
      return;
    }
    starterInstallStartedRef.current = true;
    (async () => {
      try {
        const result = await window.moodmark.library.installStarter();
        if (result?.ok) {
          try { localStorage.setItem('moodmark.starterInstalled', '1'); } catch {}
          loadCollections();
          // Show the welcome walkthrough once on first successful
          // install. The flag is written *before* opening the modal
          // so a re-render mid-flow doesn't re-trigger it.
          let alreadyShown = false;
          try { alreadyShown = localStorage.getItem('moodmark.welcomeShown') === '1'; }
          catch {}
          if (!alreadyShown) {
            try { localStorage.setItem('moodmark.welcomeShown', '1'); } catch {}
            setWelcomeOpen(true);
          }
        } else {
          // Don't pin the flag — leave room for a retry on next launch
          // (or via the Restore toast) instead of locking the user into
          // a permanently-empty library.
          console.error('Starter pack install returned not-ok:', result);
          starterInstallStartedRef.current = false;
        }
      } catch (err) {
        console.error('Starter pack install failed:', err);
        starterInstallStartedRef.current = false;
      }
    })();
  }, [loading, smartCounts.all, collections.length, loadCollections]);

  // Post-wipe restore-starter toast. Surfaces a "Restore starter
  // pack?" pill if the user has already onboarded (starterInstalled
  // is set) AND the library is currently empty AND they haven't
  // permanently dismissed the toast via its X. Dismiss is persisted
  // in localStorage so the toast goes away forever on that device.
  const [starterToastDismissed, setStarterToastDismissed] = useState(() => {
    try { return localStorage.getItem('moodmark.starterToastDismissed') === '1'; }
    catch { return false; }
  });
  const [starterRestoreError, setStarterRestoreError] = useState(false);
  // Re-read the starterInstalled flag whenever it might change. We
  // don't observe localStorage directly; instead we just refresh on
  // the same triggers the auto-install effect uses.
  const starterInstalled = (() => {
    try { return localStorage.getItem('moodmark.starterInstalled') === '1'; }
    catch { return false; }
  })();
  const showStarterToast = !loading
    && starterInstalled
    && !starterToastDismissed
    && smartCounts.all === 0
    && collections.length === 0
    && !focusedId;

  const handleRestoreStarterPack = useCallback(async () => {
    setStarterRestoreError(false);
    try {
      const result = await window.moodmark.library.installStarter();
      if (!result?.ok) {
        setStarterRestoreError(true);
        return;
      }
      loadCollections();
      reload();
    } catch (err) {
      console.error('Restore starter pack failed:', err);
      setStarterRestoreError(true);
    }
  }, [loadCollections, reload]);

  const handleDismissStarterToast = useCallback(() => {
    try { localStorage.setItem('moodmark.starterToastDismissed', '1'); } catch {}
    setStarterToastDismissed(true);
  }, []);

  // Tags state — used by DetailPanel for autocomplete suggestions.
  const [allTags, setAllTags] = useState([]);

  const loadAllTags = useCallback(async () => {
    const data = await window.moodmark.tags.getAll();
    setAllTags(data);
  }, []);

  useEffect(() => { loadAllTags(); }, [loadAllTags]);

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

  const showActionToast = useCallback(({ message, onUndo, action, onCommit, durationMs = 5000 }) => {
    runPendingCommit();
    actionToastCommitRef.current = onCommit || null;
    setActionToast({ message, onUndo, action });
    actionToastTimerRef.current = setTimeout(() => {
      const commit = actionToastCommitRef.current;
      actionToastCommitRef.current = null;
      actionToastTimerRef.current = null;
      setActionToast(null);
      if (commit) commit();
    }, durationMs);
  }, [runPendingCommit]);

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
  const showPermanentDeleteToast = useCallback((ids) => {
    if (!ids?.length) return;
    hideSavesLocal(ids);
    showActionToast({
      message: ids.length === 1 ? 'Deleted forever' : `${ids.length} deleted forever`,
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

  // Modal-backed variant generation. The opener (right-click or
  // DetailPanel) sets `variantOptions` with a saveId + whether the
  // user wants the result auto-opened in focus view; the modal
  // collects prompt + aspect, then calls handleGenerateVariant.
  // From the grid we don't auto-focus (would yank the user out of
  // browsing). From the focused view we do — they're already there.
  const [variantOptions, setVariantOptions] = useState(null);

  const handleGenerateVariant = useCallback(async (saveId, opts = {}) => {
    const { prompt, aspect, openOnComplete = false } = opts;
    const source = saves.find((s) => s.id === saveId);
    const pendingId = `pending-${saveId}-${Date.now()}`;
    if (source) {
      setPendingVariants((prev) => [
        ...prev,
        {
          id: pendingId,
          __pending: true,
          file_path: source.file_path,
          thumb_path: source.thumb_path,
          width: source.width,
          height: source.height,
          title: source.title,
          created_at: Date.now(),
        },
      ]);
    }
    const result = await window.moodmark.ai.generateVariant(saveId, { prompt, aspect });
    setPendingVariants((prev) => prev.filter((p) => p.id !== pendingId));
    if (result?.ok) {
      await reload();
      if (openOnComplete && result.save?.id) {
        setFocusedId(result.save.id);
      }
      showActionToast({ message: 'Variation created', durationMs: 1800 });
    } else if (result?.reason === 'monthly_cap_reached') {
      showActionToast({
        message: 'Monthly image limit reached. Resets at the start of next month.',
        durationMs: 3200,
      });
    } else {
      showActionToast({
        message: result?.detail || 'Could not generate variation',
        durationMs: 2400,
      });
    }
  }, [saves, reload, showActionToast]);

  const openVariantModal = useCallback((saveId, openOnComplete) => {
    setVariantOptions({ saveId, openOnComplete });
  }, []);

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
        label: `Remove from Folder${suffix}`,
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
          undoStack.push('add to folder', async () => {
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
        label: `Add to Folder${suffix}`,
        icon: <CollectionIcon />,
        submenu,
      });
    }
    // Find similar — single-save action only (multi-select doesn't
    // make semantic sense; we'd need to merge anchors). Hidden when
    // already viewing a similar-to set anchored on this same save.
    if (!isMulti && similarTo?.id !== saveId) {
      if (items.length > 0) items.push({ type: 'separator' });
      items.push({
        label: 'Find similar',
        icon: <SimilarIcon />,
        onClick: () => {
          const anchor = saves.find((s) => s.id === saveId);
          if (!anchor) return;
          setSimilarTo({
            id: anchor.id,
            thumb_path: anchor.thumb_path,
            file_path: anchor.file_path,
            title: anchor.title,
          });
        },
      });
    }

    // Generate a new image inspired by this one. Single-save AI
    // action; gated on the licensing session being present (the
    // worker proxies the OpenAI call). Per-image cost is tracked
    // separately from the token meter — see ai_usage_monthly's
    // image_count column.
    if (!isMulti && aiConfigured) {
      if (items.length > 0) items.push({ type: 'separator' });
      items.push({
        label: 'Generate variation',
        icon: <SparklesIcon />,
        // Grid-triggered: open the prompt/aspect modal but don't
        // auto-focus the result on success — the user is browsing.
        onClick: () => openVariantModal(saveId, false),
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
      // Native Share sheet — Messages / Mail / AirDrop / Notes / etc.
      // macOS only; the IPC bails on other platforms so the menu
      // entry just no-ops there.
      if (anchor?.file_path && window.moodmark.share?.save) {
        items.push({
          label: 'Share…',
          icon: <ShareIcon />,
          onClick: () => {
            window.moodmark.share.save({
              filePath: anchor.file_path,
              sourceUrl: anchor.source_url || null,
            });
          },
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
  }, [selected, collections, view, reload, loadCollections, restoreSave, showRestoreToast, showPermanentDeleteToast, deleteSave, showTrashToast, focusedId, saves, undoStack, similarTo, setSimilarTo, showActionToast, aiConfigured, openVariantModal]);

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

    // Drag image: paint the card's already-loaded <img> into a small
    // canvas, then use that canvas as the drag image. Canvases have
    // their pixels available synchronously after drawImage, unlike a
    // freshly-created <img>, so the preview is reliable on every drag.
    // Wrapped in a div with transparent left padding so the cursor
    // anchors to the LEFT of the visible thumbnail (bucket under the
    // cursor stays visible).
    const cardImg = e.currentTarget.querySelector?.('img');
    if (cardImg && cardImg.naturalWidth > 0) {
      const PREVIEW_W = 72;
      const aspect = cardImg.naturalWidth / cardImg.naturalHeight;
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
      ctx.drawImage(cardImg, 0, PAD, PREVIEW_W, previewH);
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
      saveIds.length === 1 ? 'add to folder' : 'add to folder',
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
  }, [activeLibraryId, loadCollections, reload, setColorFilter, setSearch, setView]);

  const handleCreateLibrary = useCallback(async (name) => {
    const res = await window.moodmark.libraries.create(name);
    if (res?.ok && res.library) {
      await refreshLibraries();
      // Auto-switch to the newly-created library so the user lands
      // in their fresh empty space.
      await handleSwitchLibrary(res.library.id);
    }
  }, [refreshLibraries, handleSwitchLibrary]);

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
      undoStack.push('new folder', async () => {
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

  // Duplicate-on-save toast. Main fires 'save:duplicate' with the
  // existing row whenever a drop / capture / drop-url tries to add
  // bytes that already live in the library. We show a brief toast
  // with a Show button that switches to All and focuses that save.
  useEffect(() => {
    return window.moodmark.on('save:duplicate', (existing) => {
      if (!existing?.id) return;
      showActionToast({
        message: 'Already in your library',
        durationMs: 4500,
        action: {
          label: 'Show',
          run: () => {
            handleViewChange({ type: 'all' });
            // Let the view-change reload settle before opening the
            // focused panel; otherwise focusedIndex resolves against
            // a stale displaySaves and the panel renders empty.
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

  // Prepend in-flight variant placeholders to the visible list so
  // they appear at the top of the masonry while generation runs.
  // The __pending flag tells ImageCard to render a loading overlay
  // over the source thumb instead of the normal image. New saves
  // arrive at the top via the recent sort, so the placeholder's
  // position predicts where the real save will land.
  const visibleSaves = useMemo(() => {
    if (pendingVariants.length === 0) return displaySaves;
    return [...pendingVariants, ...displaySaves];
  }, [pendingVariants, displaySaves]);

  const focusedIndex = useMemo(
    () => (focusedId ? displaySaves.findIndex((s) => s.id === focusedId) : -1),
    [displaySaves, focusedId],
  );
  const focused = focusedIndex >= 0 ? displaySaves[focusedIndex] : null;

  if (focusedId && !focused) {
    setFocusedId(null);
  }

  const handleSelect = useCallback((id, additive) => {
    if (additive) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setSelected(new Set());
    morphFocus({
      setMorphId,
      applyState: () => setFocusedId(id),
      id,
    });
  }, []);

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
  const scrollHandlerRef = useRef(null);
  const [scrolledFar, setScrolledFar] = useState(false);
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
      return;
    }
    let ticking = false;
    const fn = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setScrolledFar(node.scrollTop > 720);
        ticking = false;
      });
    };
    scrollHandlerRef.current = { node, fn };
    node.addEventListener('scroll', fn, { passive: true });
    setScrolledFar(node.scrollTop > 720);
  }, []);
  const scrollGridToTop = useCallback(() => {
    gridScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

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
    const ids = saves.map((s) => s.id);
    setSelected(new Set());
    showPermanentDeleteToast(ids);
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

  // Right-click on the focused image. Builds the same menu as the
  // grid card (Add to Folder, Find similar, Copy image, Delete) but
  // prepends focused-view-specific actions (Open in Preview, Export)
  // since they're the operations a user is most likely to want once
  // they're studying the full-size image.
  const handleFocusedContextMenu = useCallback(async (e) => {
    e.preventDefault();
    if (!focused) return;
    const saveId = focused.id;
    let memberIds = [];
    try {
      const rows = await window.moodmark.collections.getForSave(saveId);
      memberIds = (rows || []).map((r) => r.id);
    } catch { /* fall through with empty list */ }
    const cardItems = buildCardMenuItems(saveId, memberIds);

    const ext = (focused.file_path.split('.').pop() || 'png').toLowerCase();
    const exportName = focused.title
      ? `${focused.title}.${ext}`
      : `moodmark-${focused.id.slice(0, 8)}.${ext}`;

    const focusedItems = [
      {
        label: 'Open in Preview',
        icon: <ExternalLinkIcon />,
        onClick: () => handleOpenInPreview(focused.file_path),
      },
      {
        label: 'Export…',
        icon: <DownloadIcon />,
        onClick: () => window.moodmark.image.export(focused.file_path, exportName),
      },
    ];

    const items = cardItems.length > 0
      ? [...focusedItems, { type: 'separator' }, ...cardItems]
      : focusedItems;

    setCardCtx({ saveId, x: e.clientX, y: e.clientY, items });
  }, [focused, buildCardMenuItems, handleOpenInPreview]);

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
      showActionToast({ message: 'Already in every folder', durationMs: 1800 });
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
      { type: 'header', label: `Add ${ids.length} to Folder` },
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
        setCreateCollectionSignal((s) => s + 1);
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
  }, [focusedId, selected, handleDeleteSelected, goNext, goPrev, peekedSaveId, hoveredSaveId, handleModeChange]);

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
      // following a vertical one.
      if (Math.abs(e.deltaX) > SWIPE_DELTA_X && Math.abs(e.deltaY) < SWIPE_DELTA_Y_MAX) {
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

    const files = [...e.dataTransfer.files].filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length > 0) {
      let lastId = null;
      for (const file of files) {
        try {
          const record = await window.moodmark.saves.dropFile(file);
          if (record?.id) lastId = record.id;
        } catch (err) {
          console.error('Drop failed:', err);
        }
      }
      if (lastId) focusAfterDrop();
      return;
    }

    const candidates = extractDropImageUrls(e.dataTransfer);
    if (candidates.length === 0) return;

    try {
      const record = await window.moodmark.saves.dropUrl(candidates);
      if (record?.id) focusAfterDrop();
    } catch (err) {
      console.error('URL drop failed:', err);
    }
  }, [focusAfterDrop]);

  // Hidden file picker — triggered by the "+" button on the All Saves
  // sidebar row. Routes the chosen files through the same dropFile +
  // focusAfterDrop pipeline as drag-and-drop.
  const fileInputRef = useRef(null);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback(async (e) => {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/'));
    e.target.value = ''; // reset so re-picking the same file fires onChange again
    if (files.length === 0) return;
    let lastId = null;
    for (const file of files) {
      try {
        const record = await window.moodmark.saves.dropFile(file);
        if (record?.id) lastId = record.id;
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }
    if (lastId) focusAfterDrop();
  }, [focusAfterDrop]);

  return (
    <div
      className={`app-shell${dragging ? ' drag-over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {booting && <LoadingScreen onDone={() => setBooting(false)} />}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
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
              onExit={() => setView({ type: 'all' })}
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
              onOpenInPreview={handleOpenInPreview}
              onDelete={handleDelete}
              morphSource={morphId === focused.id}
              onContextMenu={handleFocusedContextMenu}
            />
          ) : (
            <>
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
                viewTitle={(() => {
                  // Only drilled-into-collection shows a title here.
                  // Smart views (unsorted / trash) advertise themselves
                  // via the underlined chip in the rail below.
                  if (view.type === 'collection') {
                    return collections.find((c) => c.id === view.id)?.name ?? null;
                  }
                  return null;
                })()}
                viewIcon={null}
                onBackToAll={view.type === 'collection' ? () => handleViewChange({ type: 'all' }) : null}
                mode={appMode}
                onModeChange={handleModeChange}
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenShortcuts={() => setShortcutsOpen(true)}
                onOpenReleaseNotes={handleOpenReleaseNotes}
                releaseNotesUnseen={releaseNotesUnseen}
                libraries={libraries}
                activeLibraryId={activeLibraryId}
                onSwitchLibrary={handleSwitchLibrary}
                onCreateLibrary={handleCreateLibrary}
                onRenameLibrary={handleRenameLibrary}
                onDeleteLibrary={handleDeleteLibrary}
                onManageLibraries={() => {
                  setSettingsDrawerHint({ drawer: 'libraries', key: Date.now() });
                  setSettingsOpen(true);
                }}
                onUpload={handleUploadClick}
              />
              {appMode === 'folders' && view.type === 'all' ? (
                // Folders mode, no folder picked yet → tile grid of
                // root-level folders. Clicking a tile sets view to
                // that collection; back-to-all returns here.
                <FolderGrid
                  folders={collections}
                  parentId={null}
                  onPickFolder={(id) => handleViewChange({ type: 'collection', id })}
                  onCreateFolder={async () => {
                    const result = await window.moodmark.collections.create({ name: 'New folder' });
                    await loadCollections();
                    return result;
                  }}
                  onRenameFolder={handleRenameCollection}
                  onDeleteFolder={handleDeleteCollection}
                  onAddSavesToBucket={handleAddSavesToBucket}
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
                />
              ) : (
              <div className="grid-scroll" ref={setGridScrollNode}>
                {appMode === 'library' && (
                  <SmartChipRail
                    activeViewType={
                      ['all', 'unsorted', 'trash'].includes(view.type)
                        ? view.type
                        : 'all'
                    }
                    counts={smartCounts}
                    onPick={(v) => handleViewChange(v)}
                    sortMode={sortMode}
                    onSortChange={setSortMode}
                    columns={gridColumns}
                    onColumnsChange={setGridColumns}
                  />
                )}
                {view.type === 'all' && collections.length > 0 && !search && (
                  <FeaturedBuckets
                    collections={collections}
                    onPickBucket={(id) => handleViewChange({ type: 'collection', id })}
                    onRenameCollection={handleRenameCollection}
                    onDeleteCollection={handleDeleteCollection}
                    onShuffleView={handleShuffleView}
                    onAddSavesToBucket={handleAddSavesToBucket}
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
                  onForceClick={(id) => setPeekedSaveId(id)}
                  columns={gridColumns}
                  loading={loading}
                  view={view}
                  search={search}
                  semanticSearchActive={semanticSearchActive}
                  colorFilter={colorFilter}
                  freshIds={freshIds}
                  layout={gridLayout}
                  morphId={morphId}
                />
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
            onClose={() => setFocusedId(null)}
            onCollectionsChanged={loadCollections}
            onTagsChanged={loadAllTags}
            onUpdateMeta={undoableUpdateSaveMeta}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSave={(id) => setFocusedId(id)}
            onGenerateVariant={(id) => openVariantModal(id, true)}
          />
        )}
      </div>

      <VariantOptionsModal
        open={!!variantOptions}
        record={variantOptions ? saves.find((s) => s.id === variantOptions.saveId) : null}
        onCancel={() => setVariantOptions(null)}
        onConfirm={({ prompt, aspect }) => {
          const { saveId, openOnComplete } = variantOptions;
          setVariantOptions(null);
          handleGenerateVariant(saveId, { prompt, aspect, openOnComplete });
        }}
      />

      {actionToast && (
        <div className="trash-toast" role="status">
          <span className="trash-toast-label">{actionToast.message}</span>
          {actionToast.onUndo && (
            <button type="button" className="trash-toast-undo" onClick={handleActionToastUndo}>
              Undo
            </button>
          )}
          {actionToast.action && (
            <button
              type="button"
              className="trash-toast-undo"
              onClick={() => {
                if (actionToastTimerRef.current) clearTimeout(actionToastTimerRef.current);
                actionToastTimerRef.current = null;
                actionToastCommitRef.current = null;
                setActionToast(null);
                actionToast.action.run();
              }}
            >
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
              data-tooltip="Add to folder"
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

      {showStarterToast && (
        <div className="selection-bar" role="status">
          <div className="selection-status">
            <span className="selection-count">
              {starterRestoreError ? 'Restore failed — try restarting the app' : 'Restore the starter pack?'}
            </span>
          </div>
          {!starterRestoreError && (
            <button
              type="button"
              className="selection-btn"
              onClick={handleRestoreStarterPack}
            >
              Restore
            </button>
          )}
          <button
            type="button"
            className="selection-bar-close"
            onClick={handleDismissStarterToast}
            data-tooltip="Dismiss forever"
            aria-label="Dismiss forever"
          >
            ×
          </button>
        </div>
      )}

      {dragging && (
        <div className="drop-overlay">
          <span className="drop-message">Drop to save</span>
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
          title="Sort each unsorted save one at a time, with keyboard shortcuts"
        >
          <span className="sort-fab-icon"><SortFabIcon /></span>
          <span>Sort one by one</span>
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
          style={{
            '--scroll-top-offset':
              view.type === 'unsorted'
                && saves.length > 0
                && collections.length > 0
                ? '60px'
                : '0px',
          }}
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
          // save mid-wipe, then re-pull collections/saves so the UI
          // reflects the now-empty library. The starterInstalled
          // localStorage flag is set inside SettingsModal before
          // this callback fires, so the auto-install effect skips.
          setFocusedId(null);
          setSelected(new Set());
          loadCollections();
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

      <WelcomeModal
        open={welcomeOpen}
        onClose={() => setWelcomeOpen(false)}
      />

<WhatsNewModal
        open={!!whatsNewNotes}
        onClose={() => setWhatsNewNotes(null)}
        notes={whatsNewNotes}
      />
    </div>
  );
}
