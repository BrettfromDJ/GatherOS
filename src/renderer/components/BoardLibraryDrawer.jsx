import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, FolderClosed } from 'lucide-react';
import styles from './BoardView.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Library drawer for the board canvas. Lets the user search the
// full library, narrow by folder, and drag thumbnails onto the
// board. Self-fetches its filtered save list so the parent doesn't
// have to thread search/collection state through every render.
export default function BoardLibraryDrawer({ collections, onClose }) {
  const [search, setSearch] = useState('');
  const [collectionId, setCollectionId] = useState('all'); // 'all' | 'unsorted' | <collection-id>
  const [saves, setSaves] = useState([]);
  const [loading, setLoading] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const requestId = useRef(0);

  // Debounce typed search so we don't spam IPC on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 140);
    return () => clearTimeout(t);
  }, [search]);

  // Load filtered saves whenever the search or folder changes.
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
  }, [debouncedSearch, collectionId]);

  const folderLabel = useMemo(() => {
    if (collectionId === 'all') return 'All images';
    if (collectionId === 'unsorted') return 'Unsorted';
    const c = collections.find((x) => x.id === collectionId);
    return c?.name || 'Folder';
  }, [collectionId, collections]);

  const count = saves.length;
  const countLabel = `${count} ${count === 1 ? 'image' : 'images'}`;

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

        <div className={styles.drawerFolderRow}>
          <FolderClosed size={13} strokeWidth={1.8} className={styles.drawerFolderIcon} />
          <select
            className={styles.drawerFolder}
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            title={folderLabel}
          >
            <option value="all">All images</option>
            <option value="unsorted">Unsorted</option>
            {collections.length > 0 && <option disabled>──────────</option>}
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className={styles.drawerCount}>{countLabel}</span>
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
          saves.map((s) => (
            <div
              key={s.id}
              className={styles.drawerThumb}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData(
                  'application/x-moodmark-board-save',
                  JSON.stringify({ saveId: s.id }),
                );
              }}
              title={s.title || ''}
              style={{
                aspectRatio:
                  s.width && s.height ? `${s.width} / ${s.height}` : '1',
              }}
            >
              <img
                src={fileUrl(s.thumb_path || s.file_path)}
                alt=""
                draggable={false}
              />
              {s.title && <div className={styles.drawerThumbCaption}>{s.title}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
