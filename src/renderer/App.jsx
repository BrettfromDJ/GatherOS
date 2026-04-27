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
    toggleFavorite,
    deleteSave,
    updateSaveMeta,
  } = useLibrary();

  const handleColorFilter = useCallback((hex) => {
    setColorFilter(hex);
    setFocusedId(null); // back to the grid so the filtered set is visible
  }, [setColorFilter]);

  const [selected, setSelected] = useState(() => new Set());
  const [gridColumns, setGridColumns] = useState(3);
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

  // Card context menu
  const [cardCtx, setCardCtx] = useState(null); // { saveId, x, y, items }
  // Bulk "Add to Collection" picker, anchored above the selection bar.
  const [bulkPicker, setBulkPicker] = useState(null); // { x, y }

  const buildCardMenuItems = useCallback((saveId) => {
    const items = [];
    if (view.type === 'collection') {
      items.push({
        label: 'Remove from Collection',
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
      items.push({ type: 'header', label: 'Add to Collection' });
      for (const col of others) {
        items.push({
          label: col.name,
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
          },
        });
      }
    }
    return items;
  }, [collections, view, reload, loadCollections]);

  const handleCardContextMenu = useCallback((saveId, x, y) => {
    const items = buildCardMenuItems(saveId);
    if (items.length === 0) return;
    setCardCtx({ saveId, x, y, items });
  }, [buildCardMenuItems]);

  // Drag-out: hand the selected files (or just the dragged card if it
  // isn't part of the selection) over to the OS via Electron's
  // webContents.startDrag so the user can drop into Figma / Slack /
  // Mail / Finder / etc.
  const handleCardDragStart = useCallback((record) => {
    const dragSet = selected.has(record.id) && selected.size > 1
      ? saves.filter((s) => selected.has(s.id))
      : [record];
    const files = dragSet.map((s) => s.file_path).filter(Boolean);
    if (files.length === 0) return;
    window.moodmark.drag.start({
      files,
      thumbPath: record.thumb_path || record.file_path,
    });
  }, [selected, saves]);

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
      const ok = await window.moodmark.saves.confirmDelete(1);
      if (!ok) return;
      await deleteSave(id);
      if (focusedId === id) setFocusedId(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [deleteSave, focusedId],
  );

  const handleDeleteSelected = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await window.moodmark.saves.confirmDelete(ids.length);
    if (!ok) return;
    for (const id of ids) {
      await deleteSave(id);
    }
    setSelected(new Set());
    if (focusedId && ids.includes(focusedId)) setFocusedId(null);
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

  const bulkPickerItems = useMemo(() => {
    if (!bulkPicker) return [];
    const ids = [...selected];
    return [
      { type: 'header', label: `Add ${ids.length} to Collection` },
      ...collections.map((c) => ({
        label: c.name,
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
        },
      })),
    ];
  }, [bulkPicker, selected, collections, saves, loadCollections]);

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

  // After a successful drop we want to land the user on the new save's
  // detail view. saves is refreshed asynchronously by the save:created
  // listener in useLibrary, so we stash the id and let an effect promote
  // it to focusedId once the list contains it.
  const [pendingFocusId, setPendingFocusId] = useState(null);

  useEffect(() => {
    if (!pendingFocusId) return;
    if (saves.some((s) => s.id === pendingFocusId)) {
      setFocusedId(pendingFocusId);
      setPendingFocusId(null);
    }
  }, [pendingFocusId, saves]);

  const focusAfterDrop = useCallback((id) => {
    if (!id) return;
    // Drops always land in All Saves; bounce out of any filtered view so
    // the new record is actually reachable when saves reloads.
    if (view.type !== 'all') setView({ type: 'all' });
    setSelected(new Set());
    setPendingFocusId(id);
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
      if (lastId) focusAfterDrop(lastId);
      return;
    }

    const candidates = extractDropImageUrls(e.dataTransfer);
    if (candidates.length === 0) return;

    try {
      const record = await window.moodmark.saves.dropUrl(candidates);
      if (record?.id) focusAfterDrop(record.id);
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
    if (lastId) focusAfterDrop(lastId);
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
              onToggleFavorite={toggleFavorite}
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
                count={saves.length}
                onToggleSidebar={sidebarCollapsed ? toggleSidebar : null}
                semanticSearchActive={semanticSearchActive}
                colorFilter={colorFilter}
                onClearColorFilter={() => setColorFilter(null)}
                searchInputRef={searchInputRef}
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

      {!focused && selected.size > 0 && (
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
              title="Add to Collection"
            >
              <span className="selection-btn-icon"><CollectionIcon /></span>
              <span className="selection-btn-label">Add to Collection</span>
            </button>
          )}
          {selected.size >= 2 && (
            <button
              type="button"
              className="selection-btn selection-btn-compact"
              onClick={handleBulkExportBoard}
              title="Export as Moodboard"
            >
              <span className="selection-btn-icon"><BoardExportIcon /></span>
              <span className="selection-btn-label">Export as Moodboard</span>
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
