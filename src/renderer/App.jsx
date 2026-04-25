import React, { useCallback, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Toolbar from './components/Toolbar.jsx';
import Grid from './components/Grid.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import FocusedView from './components/FocusedView.jsx';
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
        ? parseFloat(descriptor) * 1000 // arbitrary weight so 2x > 1x
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
    let u = url.trim();
    if (!u || seen.has(u)) return;
    if (!/^(https?:|data:)/i.test(u)) return;
    seen.add(u);
    candidates.push(u);
  };

  // 1. text/html — usually has the actual <img src>, sometimes srcset.
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

  // 2. text/uri-list — first non-comment line is the dragged URL.
  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList) {
    for (const line of uriList.split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith('#')) add(t);
    }
  }

  // 3. text/plain fallback.
  const text = dataTransfer.getData('text/plain');
  if (text) add(text);

  // The referer (page the image came from) is usually NOT a candidate
  // image but is useful for hot-link-protected hosts.
  let sourceUrl = null;
  if (uriList) {
    const firstUri = uriList
      .split(/\r?\n/)
      .find((l) => l && !l.startsWith('#'))
      ?.trim();
    if (firstUri && firstUri !== candidates[0]) sourceUrl = firstUri;
  }

  return { candidates, sourceUrl };
}

export default function App() {
  const {
    saves,
    loading,
    view,
    setView,
    search,
    setSearch,
    toggleFavorite,
    deleteSave,
  } = useLibrary();

  const [selected, setSelected] = useState(() => new Set());
  const [cardMinWidth, setCardMinWidth] = useState(220);
  const [focusedId, setFocusedId] = useState(null);
  const [dragging, setDragging] = useState(false);

  const focusedIndex = useMemo(
    () => (focusedId ? saves.findIndex((s) => s.id === focusedId) : -1),
    [saves, focusedId],
  );
  const focused = focusedIndex >= 0 ? saves[focusedIndex] : null;

  // If the focused record disappears (deleted, filtered out), drop focus.
  if (focusedId && !focused) {
    setFocusedId(null);
  }

  const handleSelect = useCallback((id, additive) => {
    setSelected((prev) => {
      const next = new Set(additive ? prev : []);
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!additive) setFocusedId(id);
  }, []);

  const handleOpenInPreview = useCallback((filePath) => {
    window.moodmark.image.openInPreview(filePath);
  }, []);

  const handleOpenFromCard = useCallback(
    (record) => {
      // Double-click bypasses the focused view and goes straight to Preview.app.
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

    // Files dragged from Finder, browser-downloaded images, etc.
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

    const { candidates, sourceUrl } = extractDropImageUrls(e.dataTransfer);
    if (candidates.length === 0) return;

    console.log('[drop] candidates:', candidates, 'referer:', sourceUrl);
    try {
      await window.moodmark.saves.dropUrl(candidates, sourceUrl);
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
        <Sidebar view={view} onViewChange={setView} />

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
                cardMinWidth={cardMinWidth}
                onCardMinWidthChange={setCardMinWidth}
                count={saves.length}
              />
              <div className="grid-scroll">
                <Grid
                  saves={saves}
                  selected={selected}
                  onSelect={handleSelect}
                  onOpen={handleOpenFromCard}
                  cardMinWidth={cardMinWidth}
                  loading={loading}
                />
              </div>
            </>
          )}
        </div>

        {focused && (
          <DetailPanel
            record={focused}
            onClose={() => setFocusedId(null)}
            onToggleFavorite={toggleFavorite}
            onDelete={handleDelete}
            onOpenInPreview={handleOpenInPreview}
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
    </div>
  );
}
