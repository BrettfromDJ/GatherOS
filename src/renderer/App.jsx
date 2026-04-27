import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar, { CollectionIcon } from './components/Sidebar.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import ShortcutsModal from './components/ShortcutsModal.jsx';
import Toolbar from './components/Toolbar.jsx';
import Grid from './components/Grid.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import FocusedView from './components/FocusedView.jsx';
import ContextMenu from './components/ContextMenu.jsx';
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
  const [dragging, setDragging] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c);
  }, []);

  // Settings modal + AI configured-state. The hasOpenAIKey check runs
  // once on mount and is updated whenever the user saves/clears via
  // SettingsModal's onConfiguredChange callback.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [prefs, setPrefs] = useState({ autoNameOnSave: true, semanticSearch: false });

  // Imperative handles for the global keyboard shortcuts.
  const searchInputRef = useRef(null);
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

  // Collections state
  const [collections, setCollections] = useState([]);

  const loadCollections = useCallback(async () => {
    const data = await window.moodmark.collections.getAll();
    setCollections(data);
  }, []);

  useEffect(() => { loadCollections(); }, [loadCollections]);

  // Refresh collection counts whenever the grid refreshes
  useEffect(() => {
    if (!loading) loadCollections();
  }, [loading, loadCollections]);

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

  const buildCardMenuItems = useCallback((saveId) => {
    const items = [];
    // Trash view gets a different menu — restore / delete forever.
    // No bucket actions, since trashed saves aren't "in the library".
    if (view.type === 'trash') {
      items.push({
        label: 'Restore',
        icon: <RestoreIcon />,
        onClick: async () => {
          await restoreSave(saveId);
          showRestoreToast([saveId]);
        },
      });
      items.push({
        label: 'Delete Forever',
        icon: <TrashIcon />,
        danger: true,
        onClick: () => showPermanentDeleteToast([saveId]),
      });
      return items;
    }
    if (view.type === 'collection') {
      items.push({
        label: 'Remove from Bucket',
        icon: <MinusCircleIcon />,
        danger: true,
        onClick: async () => {
          await window.moodmark.collections.removeSave({ collectionId: view.id, saveId });
          reload();
          loadCollections();
        },
      });
    }
    const others = view.type === 'collection'
      ? collections.filter((c) => c.id !== view.id)
      : collections;
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
          const sourceSave = saves.find((s) => s.id === saveId);
          flyToCollection({
            collectionId: col.id,
            items: [
              {
                saveId,
                imageSrc: sourceSave ? fileUrl(sourceSave.file_path) : null,
              },
            ],
          });
          await window.moodmark.collections.addSave({ collectionId: col.id, saveId });
          loadCollections();
          // In Unsorted view the save no longer matches the filter
          // (it now belongs to a bucket), so refresh to drop it.
          if (view.type === 'unsorted') reload();
        },
      }));
      items.push({
        label: 'Add to Bucket',
        icon: <CollectionIcon />,
        submenu,
      });
    }
    // Delete: soft-delete with the same undo toast as the bulk path.
    if (items.length > 0) items.push({ type: 'separator' });
    items.push({
      label: 'Delete',
      icon: <TrashIcon />,
      danger: true,
      onClick: async () => {
        await deleteSave(saveId);
        setSelected((prev) => {
          if (!prev.has(saveId)) return prev;
          const next = new Set(prev);
          next.delete(saveId);
          return next;
        });
        if (focusedId === saveId) setFocusedId(null);
        showTrashToast([saveId]);
      },
    });
    return items;
  }, [collections, view, reload, loadCollections, restoreSave, showRestoreToast, showPermanentDeleteToast, deleteSave, showTrashToast, focusedId, saves]);

  const handleCardContextMenu = useCallback((saveId, x, y) => {
    const items = buildCardMenuItems(saveId);
    if (items.length === 0) return;
    setCardCtx({ saveId, x, y, items });
  }, [buildCardMenuItems]);

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
  const handleAddSavesToBucket = useCallback(async (bucketId, saveIds) => {
    if (!bucketId || !Array.isArray(saveIds) || saveIds.length === 0) return;
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

  // Empty Trash: same deferred-toast pattern. Operates on every save
  // currently visible in the Trash view (so search-filtered Empty
  // Trash means "empty what you see"; an unfiltered view empties all).
  const handleEmptyTrash = useCallback(() => {
    const ids = saves.map((s) => s.id);
    if (ids.length === 0) return;
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

  const openBulkPicker = useCallback((e) => {
    if (collections.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setBulkPicker({ x: rect.left, y: rect.top - 4 });
  }, [collections.length]);

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

  const bulkPickerItems = useMemo(() => {
    if (!bulkPicker) return [];
    const ids = [...selected];
    return [
      { type: 'header', label: `Add ${ids.length} to Bucket` },
      ...collections.map((c) => ({
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
  }, [bulkPicker, selected, collections, saves, loadCollections, view, reload]);

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
              />
              <div className="grid-scroll">
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
            onColorFilter={handleColorFilter}
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
            title="Restore"
          >
            <span className="selection-btn-icon"><RestoreIcon /></span>
            <span className="selection-btn-label">Restore</span>
          </button>
          <button
            type="button"
            className="selection-btn selection-btn-danger selection-btn-compact"
            onClick={handlePermanentDeleteSelected}
            title="Delete Forever"
          >
            <span className="selection-btn-icon"><TrashIcon /></span>
            <span className="selection-btn-label">Delete Forever</span>
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
              title="Add to Bucket"
            >
              <span className="selection-btn-icon"><CollectionIcon /></span>
              <span className="selection-btn-label">Add to Bucket</span>
            </button>
          )}
          <button
            type="button"
            className="selection-btn selection-btn-compact"
            onClick={handleBulkExportFiles}
            title="Export selected images to a folder"
          >
            <span className="selection-btn-icon"><DownloadIcon /></span>
            <span className="selection-btn-label">Export</span>
          </button>
          {selected.size >= 2 && (
            <button
              type="button"
              className="selection-btn selection-btn-compact"
              onClick={handleBulkExportBoard}
              title="Composite the selection into a single moodboard PNG"
            >
              <span className="selection-btn-icon"><BoardExportIcon /></span>
              <span className="selection-btn-label">Generate Moodboard</span>
            </button>
          )}
          <button
            type="button"
            className="selection-btn selection-btn-danger selection-btn-compact"
            onClick={handleDeleteSelected}
            title="Delete"
          >
            <span className="selection-btn-icon"><TrashIcon /></span>
            <span className="selection-btn-label">Delete</span>
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
            title="Empty Trash"
          >
            <span className="selection-btn-icon"><TrashIcon /></span>
            <span className="selection-btn-label">Empty Trash</span>
          </button>
        </div>
      )}

      {dragging && (
        <div className="drop-overlay">
          <span className="drop-message">Drop to save</span>
        </div>
      )}

      {cardCtx && (
        <ContextMenu
          x={cardCtx.x}
          y={cardCtx.y}
          items={cardCtx.items}
          onClose={() => setCardCtx(null)}
        />
      )}

      {bulkPicker && (
        <ContextMenu
          x={bulkPicker.x}
          y={bulkPicker.y}
          items={bulkPickerItems}
          onClose={() => setBulkPicker(null)}
        />
      )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onConfiguredChange={setAiConfigured}
        onPrefsChange={setPrefs}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
