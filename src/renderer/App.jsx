import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar, { CollectionIcon } from './components/Sidebar.jsx';
import QuickSwitcher from './components/QuickSwitcher.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import AIUnlockedModal from './components/AIUnlockedModal.jsx';
import WelcomeModal from './components/WelcomeModal.jsx';
import ShortcutsModal from './components/ShortcutsModal.jsx';
import Toolbar from './components/Toolbar.jsx';
import Grid from './components/Grid.jsx';
import FeaturedBuckets from './components/FeaturedBuckets.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import FocusedView from './components/FocusedView.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import CompostBurst from './components/CompostBurst.jsx';
import FocusedSortMode from './components/FocusedSortMode.jsx';
import { useLibrary } from './hooks/useLibrary.js';
import { fileUrl } from './lib/fileUrl.js';
import { flyToCollection } from './lib/flyToCollection.js';

function BoardExportIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="5" height="6" rx="1" />
      <rect x="9" y="2" width="5" height="4" rx="1" />
      <rect x="2" y="10" width="5" height="4" rx="1" />
      <rect x="9" y="8" width="5" height="6" rx="1" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5 V10.5" />
      <path d="M4.5 7 L8 10.5 L11.5 7" />
      <path d="M3 13 H13" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 4h11" />
      <path d="M5.5 4V2.5a0.75 0.75 0 0 1 0.75 -0.75h3.5a0.75 0.75 0 0 1 0.75 0.75V4" />
      <path d="M3.75 4v9a0.75 0.75 0 0 0 0.75 0.75h7a0.75 0.75 0 0 0 0.75 -0.75V4" />
      <path d="M6.5 7v4M9.5 7v4" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8 a5 5 0 1 0 1.6 -3.6" />
      <path d="M3 2.5 V5 H5.5" />
    </svg>
  );
}

function MinusCircleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <line x1="5" y1="8" x2="11" y2="8" />
    </svg>
  );
}

function SortFabIcon() {
  // Card-with-arrow — reads as "move this card somewhere".
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3" width="9" height="11" rx="1.4" />
      <path d="M11 8.5 H16 M13.5 6 L16 8.5 L13.5 11" />
    </svg>
  );
}

function pickLargestFromSrcset(srcset) {
  if (!srcset) return null;
  let best = null;
  let bestWidth = -1;
  for (const part of srcset.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [url, descriptor] = trimmed.split(/\s+/);
    const w = descriptor && descriptor.endsWith('w')
      ? parseFloat(descriptor)
      : descriptor && descriptor.endsWith('x')
        ? parseFloat(descriptor) * 1000
        : 0;
    if (url && w > bestWidth) {
      best = url;
      bestWidth = w;
    }
  }
  return best;
}

function extractDropImageUrls(dataTransfer) {
  const seen = new Set();
  const candidates = [];
  const add = (url) => {
    if (!url) return;
    const u = url.trim();
    if (!u || seen.has(u)) return;
    if (!/^(https?:|data:)/i.test(u)) return;
    seen.add(u);
    candidates.push(u);
  };

  const html = dataTransfer.getData('text/html');
  if (html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const img of doc.querySelectorAll('img')) {
        add(pickLargestFromSrcset(img.getAttribute('srcset')));
        add(img.getAttribute('src'));
        add(img.getAttribute('data-src'));
        add(img.getAttribute('data-original'));
      }
    } catch {
      const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m) add(m[1]);
    }
  }

  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList) {
    for (const line of uriList.split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith('#')) add(t);
    }
  }

  const text = dataTransfer.getData('text/plain');
  if (text) add(text);

  return candidates;
}

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
    reload,
    deleteSave,
    restoreSave,
    hideSavesLocal,
    updateSaveMeta,
    freshIds,
  } = useLibrary();

  const handleColorFilter = useCallback((hex) => {
    setColorFilter(hex);
    setFocusedId(null); // back to the grid so the filtered set is visible
  }, [setColorFilter]);

  const [selected, setSelected] = useState(() => new Set());
  const [gridColumns, setGridColumns] = useState(3);
  const [gridLayout, setGridLayout] = useState(() => {
    try { return localStorage.getItem('moodmark.gridLayout') || 'masonry'; }
    catch { return 'masonry'; }
  });
  useEffect(() => {
    try { localStorage.setItem('moodmark.gridLayout', gridLayout); } catch {}
  }, [gridLayout]);
  const [focusedId, setFocusedId] = useState(null);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Splash that runs once per app launch. The LoadingScreen calls
  // onDone after its 0→100 count + exit animation completes, at which
  // point we unmount it for the rest of the session.
  const [booting, setBooting] = useState(true);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c);
  }, []);

  // Settings modal + AI configured-state. The hasOpenAIKey check runs
  // once on mount and is updated whenever the user saves/clears via
  // SettingsModal's onConfiguredChange callback.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiUnlockedOpen, setAiUnlockedOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  // Dev-only console handles for QA. Lets us pop the onboarding /
  // celebration modals without juggling localStorage flags or wiping
  // the library. Stripped from production renderer builds anyway by
  // virtue of being inert (no UI hookups, just window assignments).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__moodmarkDebug = {
      showWelcome: () => setWelcomeOpen(true),
      showAIUnlocked: () => setAiUnlockedOpen(true),
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
    window.moodmark.settings.hasOpenAIKey().then(setAiConfigured);
    window.moodmark.settings.getPrefs().then(setPrefs);
  }, []);
  // True when both the toggle is on AND a key is configured — search will
  // route through embeddings rather than LIKE.
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
  const [smartCounts, setSmartCounts] = useState({ all: 0, unsorted: 0, trash: 0 });

  const loadCollections = useCallback(async () => {
    const [cols, counts] = await Promise.all([
      window.moodmark.collections.getAll(),
      window.moodmark.saves.counts(),
    ]);
    setCollections(cols);
    setSmartCounts(counts && typeof counts === 'object' ? counts : { all: 0, unsorted: 0, trash: 0 });
  }, []);

  useEffect(() => { loadCollections(); }, [loadCollections]);

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

  const showActionToast = useCallback(({ message, onUndo, onCommit, durationMs = 5000 }) => {
    runPendingCommit();
    actionToastCommitRef.current = onCommit || null;
    setActionToast({ message, onUndo });
    actionToastTimerRef.current = setTimeout(() => {
      const commit = actionToastCommitRef.current;
      actionToastCommitRef.current = null;
      actionToastTimerRef.current = null;
      setActionToast(null);
      if (commit) commit();
    }, durationMs);
  }, [runPendingCommit]);

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
        label: `Remove from Bucket${suffix}`,
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
      const submenu = others.map((col) => ({
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
        },
      }));
      items.push({
        label: `Add to Bucket${suffix}`,
        icon: <CollectionIcon />,
        submenu,
      });
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
  }, [selected, collections, view, reload, loadCollections, restoreSave, showRestoreToast, showPermanentDeleteToast, deleteSave, showTrashToast, focusedId, saves]);

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

      const canvas = document.createElement('canvas');
      canvas.width = PREVIEW_W;
      canvas.height = previewH;
      const ctx = canvas.getContext('2d');
      // Round corners by clipping to a rounded path before drawing.
      const r = 6;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(PREVIEW_W, 0, PREVIEW_W, previewH, r);
      ctx.arcTo(PREVIEW_W, previewH, 0, previewH, r);
      ctx.arcTo(0, previewH, 0, 0, r);
      ctx.arcTo(0, 0, PREVIEW_W, 0, r);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(cardImg, 0, 0, PREVIEW_W, previewH);

      // Multi-select: paint a +N pill in the top-right corner.
      if (ids.length > 1) {
        const label = `+${ids.length - 1}`;
        ctx.font = 'bold 11px -apple-system, system-ui, sans-serif';
        const textW = ctx.measureText(label).width;
        const pillH = 17;
        const pillW = Math.max(pillH, textW + 10);
        const px = PREVIEW_W - pillW - 4;
        const py = 4;
        // White outline ring
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.roundRect(px - 1.5, py - 1.5, pillW + 3, pillH + 3, (pillH + 3) / 2);
        ctx.fill();
        // Blue pill
        ctx.fillStyle = '#0a84ff';
        ctx.beginPath();
        ctx.roundRect(px, py, pillW, pillH, pillH / 2);
        ctx.fill();
        // Number
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(label, px + pillW / 2, py + pillH / 2 + 0.5);
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
  }, [saves, loadCollections, view, reload]);

  const handleCreateCollection = useCallback(async (payload) => {
    await window.moodmark.collections.create(payload);
    loadCollections();
  }, [loadCollections]);

  const handleRenameCollection = useCallback(async (payload) => {
    await window.moodmark.collections.rename(payload);
    loadCollections();
  }, [loadCollections]);

  // Sidebar nav also drops focus + selection so users land on the masonry grid
  // instead of staying inside the FocusedView.
  const handleViewChange = useCallback((newView) => {
    setView(newView);
    setFocusedId(null);
    setSelected(new Set());
  }, [setView]);

  const handleDeleteCollection = useCallback(async (id) => {
    await window.moodmark.collections.delete(id);
    // If we were viewing the deleted collection, go back to All
    if (view.type === 'collection' && view.id === id) handleViewChange({ type: 'all' });
    loadCollections();
  }, [view, handleViewChange, loadCollections]);

  const handleReorderCollections = useCallback(async (orderedIds) => {
    // Optimistic local reorder so the sidebar doesn't flash back to old order.
    setCollections((prev) => {
      const byId = new Map(prev.map((c) => [c.id, c]));
      return orderedIds.map((id) => byId.get(id)).filter(Boolean);
    });
    await window.moodmark.collections.reorder(orderedIds);
    loadCollections();
  }, [loadCollections]);

  const focusedIndex = useMemo(
    () => (focusedId ? saves.findIndex((s) => s.id === focusedId) : -1),
    [saves, focusedId],
  );
  const focused = focusedIndex >= 0 ? saves[focusedIndex] : null;

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
    setFocusedId(id);
  }, []);

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

  const focusedSortAssign = useCallback(async (saveId, collectionId) => {
    await window.moodmark.collections.addSave({ collectionId, saveId });
    // The save just became sorted, so the Unsorted view should drop
    // it. Reload + refresh collection counts so progress stays in
    // sync with the underlying state.
    reload();
    loadCollections();
  }, [reload, loadCollections]);

  // Composting-trash burst state. When the user empties trash we
  // capture each card's on-screen rect + palette swatches, then
  // paint a one-shot canvas overlay where every card erupts into
  // colored pixels that spiral toward the toast and dissolve into
  // a warm glow. Pure visual flourish on top of the existing
  // delete-with-undo flow.
  const [compostBurst, setCompostBurst] = useState(null);

  // Empty Trash: same deferred-toast pattern. Operates on every save
  // currently visible in the Trash view (so search-filtered Empty
  // Trash means "empty what you see"; an unfiltered view empties all).
  const handleEmptyTrash = useCallback(() => {
    if (saves.length === 0) return;
    // Snapshot rects + palettes BEFORE hideSavesLocal yanks the DOM.
    // The burst plays on a canvas overlay, so it only needs the
    // start positions in screen space (and the colors to paint).
    const sources = [];
    for (const s of saves) {
      const el = document.querySelector(`[data-save-id="${s.id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      let colors = [];
      if (s.palette) {
        try {
          const arr = JSON.parse(s.palette);
          if (Array.isArray(arr)) colors = arr.slice(0, 6);
        } catch {}
      }
      sources.push({
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        colors,
      });
    }
    if (sources.length > 0) {
      setCompostBurst({
        id: Date.now(),
        sources,
        target: {
          x: window.innerWidth / 2,
          y: window.innerHeight - 44, // ~ where the trash toast sits
        },
      });
    }

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
    setBulkAlreadyIn(already);
    setBulkPicker({ x: rect.left, y: rect.top - 4 });
  }, [collections.length, selected]);

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
    // Hide buckets every selected save is already a member of —
    // adding again would be a no-op for all of them.
    const offer = collections.filter((c) => !bulkAlreadyIn.has(c.id));
    if (offer.length === 0) {
      return [{ type: 'header', label: 'Already in every bucket' }];
    }
    return [
      { type: 'header', label: `Add ${ids.length} to Bucket` },
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

  const goPrev = useCallback(() => {
    if (focusedIndex > 0) setFocusedId(saves[focusedIndex - 1].id);
  }, [focusedIndex, saves]);

  const goNext = useCallback(() => {
    if (focusedIndex >= 0 && focusedIndex < saves.length - 1) {
      setFocusedId(saves[focusedIndex + 1].id);
    }
  }, [focusedIndex, saves]);

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
  }, [focusedId, selected, handleDeleteSelected, goNext, goPrev]);

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

      <div className={`layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        {!sidebarCollapsed && (
          <Sidebar
            view={view}
            onViewChange={handleViewChange}
            collections={collections}
            smartCounts={smartCounts}
            onCreateCollection={handleCreateCollection}
            onRenameCollection={handleRenameCollection}
            onDeleteCollection={handleDeleteCollection}
            onReorderCollections={handleReorderCollections}
            onAddSavesToBucket={handleAddSavesToBucket}
            onToggleCollapse={toggleSidebar}
            onUpload={handleUploadClick}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            createCollectionSignal={createCollectionSignal}
          />
        )}

        <div className="main-col">
          {focused ? (
            <FocusedView
              record={focused}
              index={focusedIndex}
              total={saves.length}
              onBack={() => setFocusedId(null)}
              onPrev={goPrev}
              onNext={goNext}
              hasPrev={focusedIndex > 0}
              hasNext={focusedIndex < saves.length - 1}
              onOpenInPreview={handleOpenInPreview}
              onDelete={handleDelete}
              onToggleSidebar={sidebarCollapsed ? toggleSidebar : null}
            />
          ) : (
            <>
              <Toolbar
                search={search}
                onSearchChange={setSearch}
                columns={gridColumns}
                onColumnsChange={setGridColumns}
                layout={gridLayout}
                onLayoutChange={setGridLayout}
                onOpenQuickSwitcher={() => setQuickSwitcherOpen(true)}
                onToggleSidebar={sidebarCollapsed ? toggleSidebar : null}
                semanticSearchActive={semanticSearchActive}
                colorFilter={colorFilter}
                onClearColorFilter={() => setColorFilter(null)}
                searchInputRef={searchInputRef}
                viewTitle={(() => {
                  if (view.type === 'collection') {
                    return collections.find((c) => c.id === view.id)?.name ?? null;
                  }
                  if (view.type === 'unsorted') return 'Unsorted';
                  if (view.type === 'trash') return 'Trash';
                  return null;
                })()}
                onBackToAll={view.type === 'collection' ? () => handleViewChange({ type: 'all' }) : null}
              />
              <div className="grid-scroll">
                {view.type === 'all' && collections.length > 0 && !search && (
                  <FeaturedBuckets
                    collections={collections}
                    onPickBucket={(id) => handleViewChange({ type: 'collection', id })}
                  />
                )}
                <Grid
                  saves={saves}
                  selected={selected}
                  onSelect={handleSelect}
                  onOpen={handleOpenFromCard}
                  onContextMenu={handleCardContextMenu}
                  onDragStart={handleCardDragStart}
                  columns={gridColumns}
                  loading={loading}
                  view={view}
                  search={search}
                  semanticSearchActive={semanticSearchActive}
                  colorFilter={colorFilter}
                  freshIds={freshIds}
                  layout={gridLayout}
                />
              </div>
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
            onUpdateMeta={updateSaveMeta}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSave={(id) => setFocusedId(id)}
          />
        )}
      </div>

      {actionToast && (
        <div className="trash-toast" role="status">
          <span className="trash-toast-label">{actionToast.message}</span>
          {actionToast.onUndo && (
            <button type="button" className="trash-toast-undo" onClick={handleActionToastUndo}>
              Undo
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
              data-tooltip="Add to bucket"
              aria-label="Add to bucket"
            >
              <span className="selection-btn-icon"><CollectionIcon /></span>
            </button>
          )}
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

      {compostBurst && (
        <CompostBurst
          key={compostBurst.id}
          sources={compostBurst.sources}
          target={compostBurst.target}
          onDone={() => setCompostBurst(null)}
        />
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
        onClose={() => setSettingsOpen(false)}
        onConfiguredChange={setAiConfigured}
        onPrefsChange={setPrefs}
        onKeySaved={() => setAiUnlockedOpen(true)}
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
    </div>
  );
}
