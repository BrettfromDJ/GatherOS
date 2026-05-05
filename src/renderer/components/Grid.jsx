import React, { useEffect, useMemo, useState } from 'react';
import ImageCard from './ImageCard.jsx';
import styles from './Grid.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { InboxIcon, TrashIcon } from './Sidebar.jsx';

const EMPTY_ICON = { size: 24, strokeWidth: 1.6, 'aria-hidden': true };

// Lightweight loading shimmer — masonry-shaped placeholders that
// only fade in after a 150ms grace period, so flash-fast loads
// (cached library reopens, view switches with warm data) don't
// blink a skeleton frame.
function Skeletons({ columns }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return <div className={styles.state} />;

  const heights = [200, 260, 180, 240, 320, 220, 280, 200, 160, 240, 300, 200];
  const cols = Array.from({ length: columns }, (_, c) =>
    Array.from({ length: 4 }, (_, r) => heights[(c * 4 + r) % heights.length]),
  );
  return (
    <div
      className={styles.grid}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      aria-hidden="true"
    >
      {cols.map((heights, i) => (
        <div key={i} className={styles.column}>
          {heights.map((h, j) => (
            <div
              key={j}
              className={styles.skeleton}
              style={{ height: h }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function relativeDate(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'Today';
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w ago`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))}mo ago`;
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

function hostnameOf(url) {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

export default function Grid({
  saves, selected, onSelect, onOpen, onContextMenu, onDragStart,
  columns, loading, view, search, semanticSearchActive, colorFilter,
  freshIds, layout = 'masonry',
}) {
  const columnBuckets = useMemo(() => {
    const buckets = Array.from({ length: columns }, () => []);
    saves.forEach((save, i) => {
      // Stagger delay piggy-backed on the bucket entry: 50ms per
      // card, capped so a 100-image library doesn't take 5s. The
      // global index gives a left-to-right top-to-bottom wave even
      // though we're round-robining into columns.
      buckets[i % columns].push({ save, staggerMs: Math.min(i * 50, 600) });
    });
    return buckets;
  }, [saves, columns]);

  if (loading && saves.length === 0) {
    return <Skeletons columns={columns} />;
  }

  if (saves.length === 0) {
    const trimmedSearch = (search || '').trim();
    const isCollection = view?.type === 'collection';
    const isUnsorted = view?.type === 'unsorted';
    const isTrash = view?.type === 'trash';

    let title = 'Nothing saved yet';
    let hint = 'Press ⌘⇧S to screenshot, or drag images into this window';
    let EmptyIcon = null;
    let emptyIconColor = null;
    if (trimmedSearch) {
      title = `No matches for "${trimmedSearch}"`;
      hint = semanticSearchActive
        ? 'Try a different description, or turn off Visual search to fall back to keyword matching.'
        : 'Try a different keyword.';
    } else if (colorFilter) {
      title = 'No saves match that color';
      hint = 'Click the chip in the toolbar to clear the filter.';
    } else if (isCollection) {
      title = 'Folder is empty';
      hint = 'Drop an image, paste a URL, or ⌘⇧S to capture.';
    } else if (isUnsorted) {
      title = 'Nothing unsorted';
      hint = 'Every save belongs to at least one folder.';
      EmptyIcon = InboxIcon;
      emptyIconColor = 'var(--text-tertiary)';
    } else if (isTrash) {
      title = 'Trash is empty';
      hint = 'Deleted saves land here. Empty Trash to remove for good.';
      EmptyIcon = TrashIcon;
      emptyIconColor = 'var(--text-tertiary)';
    }

    return (
      <div className={styles.state}>
        {EmptyIcon && (
          <div className={styles.emptyIcon} style={{ color: emptyIconColor }}>
            <EmptyIcon {...EMPTY_ICON} />
          </div>
        )}
        <div className={styles.emptyTitle}>{title}</div>
        <div className={styles.emptyHint}>{hint}</div>
      </div>
    );
  }

  if (layout === 'list') {
    return (
      <div className={styles.list}>
        {saves.map((s) => {
          const isSelected = selected.has(s.id);
          const isFresh = freshIds?.has(s.id);
          return (
            <div
              key={s.id}
              data-save-id={s.id}
              className={[
                styles.listRow,
                isSelected && styles.listRowSelected,
                isFresh && styles.listRowFresh,
              ].filter(Boolean).join(' ')}
              draggable={!!onDragStart}
              onClick={(e) => onSelect(s.id, e.metaKey || e.ctrlKey || e.shiftKey)}
              onDoubleClick={() => onOpen(s)}
              onContextMenu={(e) => {
                if (onContextMenu) {
                  e.preventDefault();
                  onContextMenu(s.id, e.clientX, e.clientY);
                }
              }}
              onDragStart={(e) => {
                if (!onDragStart) return;
                onDragStart(e, s);
              }}
            >
              <div className={styles.listThumb}>
                <img
                  src={fileUrl(s.thumb_path || s.file_path)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                />
              </div>
              <div className={styles.listMain}>
                <div className={styles.listTitle}>
                  {s.title || <span className={styles.listUntitled}>Untitled</span>}
                </div>
                {s.source_url && (
                  <div className={styles.listSource}>{hostnameOf(s.source_url)}</div>
                )}
              </div>
              {s.width && s.height && (
                <div className={styles.listDims}>
                  {s.width}×{s.height}
                </div>
              )}
              <div className={styles.listDate}>{relativeDate(s.created_at)}</div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={styles.grid}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {columnBuckets.map((bucket, colIdx) => (
        <div key={colIdx} className={styles.column}>
          {bucket.map(({ save: s, staggerMs }) => (
            <ImageCard
              key={s.id}
              record={s}
              selected={selected.has(s.id)}
              selectionActive={selected.size > 0}
              onSelect={onSelect}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              fresh={freshIds?.has(s.id)}
              staggerMs={staggerMs}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
