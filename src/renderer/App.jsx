import React, { useCallback, useMemo, useState, useEffect } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Toolbar from './components/Toolbar.jsx';
import Grid from './components/Grid.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import FocusedView from './components/FocusedView.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import { useLibrary } from './hooks/useLibrary.js';

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
    reload,
    toggleFavorite,
    deleteSave,
  } = useLibrary();

  const [selected, setSelected] = useState(() => new Set());
  const [gridColumns, setGridColumns] = useState(3);
  const [focusedId, setFocusedId] = useState(null);
  const [dragging, setDragging] = useState(false);

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

  const handleCreateCollection = useCallback(async (payload) => {
    await window.moodmark.collections.create(payload);
    loadCollections();
  }, [loadCollections]);

  const handleRenameCollection = useCallback(async (payload) => {
    await window.moodmark.collections.rename(payload);
    loadCollections();
  }, [loadCollections]);

  const handleDeleteCollection = useCallback(async (id) => {
    await window.moodmark.collections.delete(id);
    // If we were viewing the deleted collection, go back to All
    if (view.type === 'collection' && view.id === id) setView({ type: 'all' });
    loadCollections();
  }, [view, setView, loadCollections]);

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

  const bulkPickerItems = useMemo(() => {
    if (!bulkPicker) return [];
    const ids = [...selected];
    return [
      { type: 'header', label: `Add ${ids.length} to Collection` },
      ...collections.map((c) => ({
        label: c.name,
        onClick: async () => {
          for (const saveId of ids) {
            await window.moodmark.collections.addSave({ collectionId: c.id, saveId });
          }
          loadCollections();
        },
      })),
    ];
  }, [bulkPicker, selected, collections, loadCollections]);

  const goPrev = useCallback(() => {
    if (focusedIndex > 0) setFocusedId(saves[focusedIndex - 1].id);
  }, [focusedIndex, saves]);

  const goNext = useCallback(() => {
    if (focusedIndex >= 0 && focusedIndex < saves.length - 1) {
      setFocusedId(saves[focusedIndex + 1].id);
    }
  }, [focusedIndex, saves]);

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

  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);

    const files = [...e.dataTransfer.files].filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length > 0) {
      for (const file of files) {
        try {
          await window.moodmark.saves.dropFile(file);
        } catch (err) {
          console.error('Drop failed:', err);
        }
      }
      return;
    }

    const candidates = extractDropImageUrls(e.dataTransfer);
    if (candidates.length === 0) return;

    try {
      await window.moodmark.saves.dropUrl(candidates);
    } catch (err) {
      console.error('URL drop failed:', err);
    }
  }, []);

  return (
    <div
      className={`app-shell${dragging ? ' drag-over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="layout">
        <Sidebar
          view={view}
          onViewChange={setView}
          collections={collections}
          onCreateCollection={handleCreateCollection}
          onRenameCollection={handleRenameCollection}
          onDeleteCollection={handleDeleteCollection}
          onReorderCollections={handleReorderCollections}
        />

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
            />
          ) : (
            <>
              <Toolbar
                search={search}
                onSearchChange={setSearch}
                columns={gridColumns}
                onColumnsChange={setGridColumns}
                count={saves.length}
              />
              <div className="grid-scroll">
                <Grid
                  saves={saves}
                  selected={selected}
                  onSelect={handleSelect}
                  onOpen={handleOpenFromCard}
                  onContextMenu={handleCardContextMenu}
                  columns={gridColumns}
                  loading={loading}
                  view={view}
                />
              </div>
            </>
          )}
        </div>

        {focused && (
          <DetailPanel
            record={focused}
            allCollections={collections}
            onClose={() => setFocusedId(null)}
            onToggleFavorite={toggleFavorite}
            onDelete={handleDelete}
            onOpenInPreview={handleOpenInPreview}
            onCollectionsChanged={loadCollections}
          />
        )}
      </div>

      {!focused && selected.size > 0 && (
        <div className="selection-bar">
          <span className="selection-count">
            {selected.size} selected
          </span>
          <button
            type="button"
            className="selection-btn"
            onClick={clearSelection}
          >
            Clear
          </button>
          {collections.length > 0 && (
            <button
              type="button"
              className="selection-btn"
              onClick={openBulkPicker}
            >
              Add to Collection
            </button>
          )}
          <button
            type="button"
            className="selection-btn selection-btn-danger"
            onClick={handleDeleteSelected}
          >
            Delete
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
    </div>
  );
}
