import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  X,
  FolderClosed,
  LayoutGrid,
  Inbox,
  ChevronDown,
  Check,
} from 'lucide-react';
import styles from './BoardView.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Static option metadata for the folder dropdown — used both to
// render the trigger label and to seed the popup menu. Per-collection
// rows are appended at render time.
const STATIC_OPTIONS = [
  { id: 'all',      label: 'All images', Icon: LayoutGrid },
  { id: 'unsorted', label: 'Unsorted',   Icon: Inbox },
];

// Library drawer for the board canvas. Lets the user search the
// full library, narrow by folder, and drag thumbnails onto the
// board. Self-fetches its filtered save list so the parent doesn't
// have to thread search/collection state through every render.
export default function BoardLibraryDrawer({ collections, boardId, onClose }) {
  const [search, setSearch] = useState('');
  const [collectionId, setCollectionId] = useState('all'); // 'all' | 'unsorted' | <collection-id>
  const [saves, setSaves] = useState([]);
  const [loading, setLoading] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Bumped by the save:created subscription below so the drawer
  // refreshes whenever a new image lands in the library — including
  // images dropped onto the board canvas while the drawer is open.
  const [refreshTick, setRefreshTick] = useState(0);
  const requestId = useRef(0);
  // Set of save ids already on the canvas. Drives the "in this space"
  // check badge on each thumb. Refreshed alongside the saves list so
  // a drop or remove on the canvas updates the badges live.
  const [onCanvasIds, setOnCanvasIds] = useState(() => new Set());

  // Debounce typed search so we don't spam IPC on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 140);
    return () => clearTimeout(t);
  }, [search]);

  // Load filtered saves whenever the search, folder, or refresh
  // tick changes. The tick is bumped externally by the save:created
  // subscription so newly-saved images show up in the drawer live.
  useEffect(() => {
    const myId = ++requestId.current;
    setLoading(true);
    (async () => {
      const view = collectionId === 'unsorted' ? 'unsorted' : 'all';
      const data = await window.moodmark.saves.getAll({
        search: debouncedSearch,
        sort: 'newest',
        view,
        collectionId:
          collectionId !== 'all' && collectionId !== 'unsorted'
            ? collectionId
            : undefined,
      });
      if (requestId.current !== myId) return;
      setSaves(Array.isArray(data) ? data : []);
      setLoading(false);
    })();
  }, [debouncedSearch, collectionId, refreshTick]);

  // Live-refresh on every new save in the library, regardless of
  // where it was added (board canvas, masonry, paste, capture).
  useEffect(() => {
    return window.moodmark.on('save:created', () => {
      setRefreshTick((t) => t + 1);
    });
  }, []);

  // Reload the set of save ids already on this board whenever it
  // changes. Tied to refreshTick so click-to-drop / drag-drop updates
  // the badges as soon as the canvas reflects the change.
  useEffect(() => {
    if (!boardId) {
      setOnCanvasIds(new Set());
      return undefined;
    }
    let cancelled = false;
    function refresh() {
      window.moodmark.boards.getSaveIds(boardId).then((ids) => {
        if (cancelled) return;
        setOnCanvasIds(new Set(Array.isArray(ids) ? ids : []));
      });
    }
    refresh();
    function onChange(e) {
      if (!e.detail || e.detail.boardId === boardId) refresh();
    }
    window.addEventListener('moodmark:board-items-changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('moodmark:board-items-changed', onChange);
    };
  }, [boardId, refreshTick]);

  const activeOption = useMemo(() => {
    const fromStatic = STATIC_OPTIONS.find((o) => o.id === collectionId);
    if (fromStatic) return fromStatic;
    const c = collections.find((x) => x.id === collectionId);
    return c
      ? { id: c.id, label: c.name, Icon: FolderClosed }
      : STATIC_OPTIONS[0];
  }, [collectionId, collections]);

  const count = saves.length;
  const countLabel = `${count} ${count === 1 ? 'image' : 'images'}`;

  // Custom dropdown: native <select> can't render icons next to its
  // options, so we paint a button + popup ourselves. Click-outside
  // and Escape both dismiss.
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const folderMenuRef = useRef(null);
  useEffect(() => {
    if (!folderMenuOpen) return;
    function onDown(e) {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target)) {
        setFolderMenuOpen(false);
      }
    }
    function onKey(e) { if (e.key === 'Escape') setFolderMenuOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [folderMenuOpen]);

  const ActiveIcon = activeOption.Icon;

  return (
    <div className={styles.drawer}>
      <div className={styles.drawerHeader}>
        <span className={styles.drawerTitle}>Library</span>
        <button
          type="button"
          className={styles.drawerClose}
          onClick={onClose}
          title="Close library"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div className={styles.drawerControls}>
        <label className={styles.drawerSearch}>
          <Search size={13} strokeWidth={1.8} className={styles.drawerSearchIcon} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search images…"
            className={styles.drawerSearchInput}
          />
          {search && (
            <button
              type="button"
              className={styles.drawerSearchClear}
              onClick={() => setSearch('')}
              title="Clear"
            >
              <X size={11} strokeWidth={2.2} />
            </button>
          )}
        </label>

        <div className={styles.drawerFolderRow} ref={folderMenuRef}>
          <button
            type="button"
            className={styles.drawerFolder}
            onClick={() => setFolderMenuOpen((s) => !s)}
            title={activeOption.label}
            aria-haspopup="listbox"
            aria-expanded={folderMenuOpen}
          >
            <ActiveIcon size={13} strokeWidth={1.8} className={styles.drawerFolderIcon} />
            <span className={styles.drawerFolderLabel}>{activeOption.label}</span>
            <ChevronDown
              size={13}
              strokeWidth={2}
              className={styles.drawerFolderChevron}
            />
          </button>
          <span className={styles.drawerCount}>{countLabel}</span>

          {folderMenuOpen && (
            <div className={styles.drawerFolderMenu} role="listbox">
              {STATIC_OPTIONS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={collectionId === id}
                  className={[
                    styles.drawerFolderOption,
                    collectionId === id && styles.drawerFolderOptionActive,
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    setCollectionId(id);
                    setFolderMenuOpen(false);
                  }}
                >
                  <Icon size={13} strokeWidth={1.8} className={styles.drawerFolderOptionIcon} />
                  <span className={styles.drawerFolderOptionLabel}>{label}</span>
                  {collectionId === id && (
                    <Check size={13} strokeWidth={2} className={styles.drawerFolderOptionCheck} />
                  )}
                </button>
              ))}
              {collections.length > 0 && <div className={styles.drawerFolderMenuSep} />}
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={collectionId === c.id}
                  className={[
                    styles.drawerFolderOption,
                    collectionId === c.id && styles.drawerFolderOptionActive,
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    setCollectionId(c.id);
                    setFolderMenuOpen(false);
                  }}
                >
                  <FolderClosed size={13} strokeWidth={1.8} className={styles.drawerFolderOptionIcon} />
                  <span className={styles.drawerFolderOptionLabel}>{c.name}</span>
                  {collectionId === c.id && (
                    <Check size={13} strokeWidth={2} className={styles.drawerFolderOptionCheck} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={styles.drawerGrid}>
        {loading && saves.length === 0 ? (
          <div className={styles.drawerEmpty}>Loading…</div>
        ) : saves.length === 0 ? (
          <div className={styles.drawerEmpty}>
            {search ? 'No images match your search' : 'No images here yet'}
          </div>
        ) : (
          (() => {
            // Manual 2-column layout: split items into two flex
            // columns rather than relying on CSS columns, which can
            // silently spill into a 3rd column when content overflows
            // a constrained height. Approximate balance by appending
            // each save to whichever column has the smaller cumulative
            // aspect-driven height.
            const cols = [[], []];
            const heights = [0, 0];
            for (const s of saves) {
              const ar = s.width && s.height ? s.height / s.width : 1;
              const target = heights[0] <= heights[1] ? 0 : 1;
              cols[target].push(s);
              heights[target] += ar;
            }
            const renderThumb = (s) => {
              const inSpace = onCanvasIds.has(s.id);
              return (
                <div
                  key={s.id}
                  className={[styles.drawerThumb, inSpace && styles.drawerThumbInSpace].filter(Boolean).join(' ')}
                  draggable
                  role="button"
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData(
                      'application/x-moodmark-board-save',
                      JSON.stringify({ saveId: s.id }),
                    );
                  }}
                  onClick={() => {
                    if (!boardId) return;
                    window.dispatchEvent(new CustomEvent('moodmark:add-saves-to-board', {
                      detail: { boardId, ids: [s.id] },
                    }));
                  }}
                  title={
                    inSpace
                      ? (s.title ? `${s.title} — already on this canvas` : 'Already on this canvas')
                      : (s.title ? `${s.title} — click to add to canvas` : 'Click to add to canvas')
                  }
                  style={{
                    aspectRatio:
                      s.width && s.height ? `${s.width} / ${s.height}` : '1',
                    cursor: 'pointer',
                  }}
                >
                  <img
                    src={fileUrl(s.thumb_path || s.file_path)}
                    alt=""
                    draggable={false}
                  />
                  {inSpace && (
                    <span className={styles.drawerThumbBadge} aria-label="Already on this canvas">
                      <Check size={11} strokeWidth={2.4} aria-hidden="true" />
                    </span>
                  )}
                  {s.title && <div className={styles.drawerThumbCaption}>{s.title}</div>}
                </div>
              );
            };
            return (
              <>
                <div className={styles.drawerCol}>{cols[0].map(renderThumb)}</div>
                <div className={styles.drawerCol}>{cols[1].map(renderThumb)}</div>
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}
