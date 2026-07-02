import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SquareLibrary, Bookmark, Chrome, Folder, Download, RotateCw, Plus } from 'lucide-react';
import ImageCard from './ImageCard.jsx';
import styles from './Grid.module.css';
import { resolveAsset } from '../lib/asset.js';
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
  saves, selected, onSelect, onSetSelection, onOpen, onContextMenu, onDragStart, onHover, onForceClick,
  columns, loading, view, search, semanticSearchActive, colorFilter,
  freshIds, layout = 'masonry', morphId = null, tweetTypeFilter = 'all', sourceFilter = 'all',
  highlightId = null,
  // Empty-state actions — each state's hint gets a button that DOES the
  // thing instead of describing where to do it. All optional; the
  // button only renders when the handler is wired.
  onAddImages = null,
  onClearColorFilter = null,
  onClearSearch = null,
  onShowAllBookmarks = null,
}) {
  const marqueeRef = useRef(null);
  const [marqueeRect, setMarqueeRect] = useState(null);

  // Lasso/marquee selection. Mousedown on the masonry grid (but not
  // on a card or any interactive control inside it) starts a drag-
  // select. Cards intersecting the rectangle live-update the
  // selection; shift-drag adds to whatever was already selected.
  // List view skips this — the rectangle math doesn't translate to
  // a flat list and selection there is single-row anyway.
  function startMarquee(e) {
    if (e.button !== 0) return;
    if (layout !== 'masonry') return;
    if (!onSetSelection) return;
    const target = e.target;
    if (target.closest && target.closest('[data-save-id], button, input, a, [role="button"], .scroll-top-fab, .sort-fab')) {
      return;
    }
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const baseline = additive ? new Set(selected) : new Set();
    marqueeRef.current = { startX, startY, baseline, additive };

    const onMove = (ev) => {
      const m = marqueeRef.current;
      if (!m) return;
      const left = Math.min(m.startX, ev.clientX);
      const top = Math.min(m.startY, ev.clientY);
      const right = Math.max(m.startX, ev.clientX);
      const bottom = Math.max(m.startY, ev.clientY);
      setMarqueeRect({ left, top, width: right - left, height: bottom - top });

      // Suppress hit-testing until the cursor's traveled a few px so
      // a sloppy click doesn't flicker the selection.
      if (Math.abs(ev.clientX - m.startX) < 4 && Math.abs(ev.clientY - m.startY) < 4) return;

      const hits = [];
      document.querySelectorAll('[data-save-id]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
          const id = el.getAttribute('data-save-id');
          if (id) hits.push(id);
        }
      });
      const next = new Set(m.baseline);
      for (const id of hits) next.add(id);
      onSetSelection([...next]);
    };

    const onUp = (ev) => {
      const m = marqueeRef.current;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setMarqueeRect(null);
      marqueeRef.current = null;
      // Bare empty-area click (no meaningful drag) clears selection,
      // matching the Finder convention. Shift-click preserves it.
      if (!m) return;
      const moved = ev
        && (Math.abs(ev.clientX - m.startX) >= 4 || Math.abs(ev.clientY - m.startY) >= 4);
      if (!moved && !m.additive) {
        onSetSelection([]);
      }
      // Drop any text selection the drag may have started before the
      // no-select class kicked in (e.g. over a tweet card's text).
      if (moved) window.getSelection?.()?.removeAllRanges?.();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Defensive cleanup — if the grid unmounts mid-drag (view change,
  // focused view enter), drop the global listeners.
  useEffect(() => () => {
    if (marqueeRef.current) {
      marqueeRef.current = null;
      setMarqueeRect(null);
    }
  }, []);

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
    const isBookmarks = view?.type === 'bookmarks';
    const isTrash = view?.type === 'trash';
    const isBrandNewLibrary =
      !trimmedSearch && !colorFilter && !isCollection && !isUnsorted && !isBookmarks && !isTrash;

    // First-launch hero. No tutorial copy — a fanned card stack
    // (same motif as FeaturedBuckets / FolderGrid tiles) signals
    // "this is where your images live," and three icon chips show
    // the three ways to fill it.
    if (isBrandNewLibrary) {
      const mac = /Mac/i.test(navigator.platform);
      const mod = mac ? '⌘' : 'Ctrl';
      return (
        <div className={styles.state}>
          <div className={styles.heroFan} aria-hidden="true">
            <span className={styles.heroFanCard} />
            <span className={styles.heroFanCard}>
              <SquareLibrary size={22} strokeWidth={1.5} className={styles.heroFanIcon} />
            </span>
            <span className={styles.heroFanCard} />
          </div>
          <div className={styles.heroTitle}>Start your library</div>
          <div className={styles.heroActions}>
            <span className={styles.heroAction}>Drag</span>
            <span className={styles.heroDot} aria-hidden="true">·</span>
            <span className={styles.heroAction}>
              <kbd className={styles.heroKbd}>{mod}</kbd>
              <kbd className={styles.heroKbd}>V</kbd>
              Paste
            </span>
            <span className={styles.heroDot} aria-hidden="true">·</span>
            <span className={styles.heroAction}>
              <kbd className={styles.heroKbd}>{mod}</kbd>
              <kbd className={styles.heroKbd}>⇧</kbd>
              <kbd className={styles.heroKbd}>S</kbd>
              Screenshot
            </span>
          </div>
          {/* Or fill it automatically by syncing X + Instagram. */}
          <div className={styles.heroOr} aria-hidden="true">
            <span className={styles.heroOrLine} />
            <span className={styles.heroOrText}>or</span>
            <span className={styles.heroOrLine} />
          </div>
          <div className={styles.heroExtension}>
            <span className={styles.heroExtensionText}>
              Sync your X bookmarks &amp; Instagram saves with the Chrome extension.
            </span>
            <button
              type="button"
              className={styles.emptyAction}
              onClick={() => window.moodmark?.shell?.openUrl?.('https://chromewebstore.google.com/detail/gatheros/jflmnonpoapjncoeankehcmenldecojk')}
            >
              <Chrome size={16} strokeWidth={1.8} aria-hidden="true" />
              Get the Chrome extension
            </button>
          </div>
        </div>
      );
    }

    // Saved view, genuinely empty (no search / color / type / source
    // filter): onboard the two ways to fill it, assuming the extension is
    // set up. Now spans X bookmarks + Instagram saves.
    if (isBookmarks && !trimmedSearch && !colorFilter
        && !(tweetTypeFilter && tweetTypeFilter !== 'all')
        && !(sourceFilter && sourceFilter !== 'all')) {
      return (
        <div className={styles.state}>
          <div className={styles.emptyIcon} style={{ color: 'var(--icon-muted)' }}>
            <Bookmark {...EMPTY_ICON} />
          </div>
          <div className={styles.emptyTitle}>No saves yet</div>
          <div className={styles.emptyHint}>
            Bookmark on X or save on Instagram — they sync in automatically once the GatherOS extension is installed.
          </div>
          <button
            type="button"
            className={styles.emptyAction}
            onClick={() => window.moodmark?.shell?.openUrl?.('https://chromewebstore.google.com/detail/gatheros/jflmnonpoapjncoeankehcmenldecojk')}
          >
            <Chrome size={16} strokeWidth={1.8} aria-hidden="true" />
            Get the Chrome extension
          </button>
          <div className={styles.bmDiscloser}>
            <span className={styles.bmTrigger} tabIndex={0}>
              <span className={styles.bmInfo} aria-hidden="true">?</span>
              How it works
            </span>
            <div className={styles.bmReveal} role="tooltip">
              <div className={styles.bmMethod}>
                <span className={styles.bmStepNum}>
                  <Download size={16} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className={styles.bmStepText}>
                  <span className={styles.bmStepTitle}>Backfill existing</span>
                  <span className={styles.bmStepDesc}>
                    Open the GatherOS panel and click <strong>Import bookmarks</strong> or <strong>Import saved</strong>.
                  </span>
                </span>
              </div>
              <div className={styles.bmMethod}>
                <span className={styles.bmStepNum}>
                  <RotateCw size={16} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className={styles.bmStepText}>
                  <span className={styles.bmStepTitle}>Save as you browse</span>
                  <span className={styles.bmStepDesc}>
                    Bookmark on X or save on Instagram and it imports here automatically.
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    let title = 'Nothing saved yet';
    let hint = 'Press ⌘⇧S to screenshot, or drag images into this window';
    let EmptyIcon = null;
    let emptyIconColor = null;
    let emptyAction = null;
    if (trimmedSearch) {
      title = `No matches for "${trimmedSearch}"`;
      hint = semanticSearchActive
        ? 'Try a different description.'
        : 'Try a different keyword.';
      if (onClearSearch) {
        emptyAction = (
          <button type="button" className={styles.emptyAction} onClick={onClearSearch}>
            Clear search
          </button>
        );
      }
    } else if (colorFilter) {
      title = 'No saves match that color';
      hint = 'Nothing in your library carries that color.';
      if (onClearColorFilter) {
        emptyAction = (
          <button type="button" className={styles.emptyAction} onClick={onClearColorFilter}>
            Clear color filter
          </button>
        );
      } else {
        // No handler wired (shouldn't happen) — fall back to pointing
        // at the toolbar chip.
        hint = 'Click the chip in the toolbar to clear the filter.';
      }
    } else if (isCollection) {
      title = 'Collection is empty';
      hint = 'Drop an image, paste a URL, or ⌘⇧S to capture.';
      EmptyIcon = Folder;
      emptyIconColor = 'var(--icon-muted)';
      if (onAddImages) {
        // Picked files route through the same pipeline as the + FAB,
        // which already files new saves into the open collection.
        emptyAction = (
          <button type="button" className={styles.emptyAction} onClick={onAddImages}>
            <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
            Add images
          </button>
        );
      }
    } else if (isUnsorted) {
      title = 'Nothing unsorted';
      hint = 'Every save belongs to at least one collection.';
      EmptyIcon = InboxIcon;
      emptyIconColor = 'var(--icon-muted)';
    } else if (isBookmarks && tweetTypeFilter && tweetTypeFilter !== 'all') {
      // Bookmarks exist, just none of the filtered type — don't show the
      // "no bookmarks yet" onboarding CTA here.
      const label = { text: 'text', image: 'image', video: 'video' }[tweetTypeFilter] || tweetTypeFilter;
      title = `No ${label} bookmarks`;
      hint = 'No bookmarks of this type yet.';
      EmptyIcon = Bookmark;
      emptyIconColor = 'var(--icon-muted)';
      if (onShowAllBookmarks) {
        emptyAction = (
          <button type="button" className={styles.emptyAction} onClick={onShowAllBookmarks}>
            Show all bookmarks
          </button>
        );
      }
      // The genuinely-empty bookmarks view is handled by the two-method
      // onboarding early-return above.
    } else if (isBookmarks && sourceFilter && sourceFilter !== 'all') {
      // Saves exist, just none from the selected source.
      const label = sourceFilter === 'instagram' ? 'Instagram' : 'X';
      title = `No ${label} saves yet`;
      hint = `Nothing from ${label} here yet.`;
      EmptyIcon = Bookmark;
      emptyIconColor = 'var(--icon-muted)';
      if (onShowAllBookmarks) {
        emptyAction = (
          <button type="button" className={styles.emptyAction} onClick={onShowAllBookmarks}>
            Show all saves
          </button>
        );
      }
    } else if (isTrash) {
      title = 'Trash is empty';
      // No action to point at — an empty trash has nothing to empty.
      // (The old copy referenced "Empty Trash", an action that only
      // exists when the trash has items.)
      hint = 'Deleted saves land here.';
      EmptyIcon = TrashIcon;
      emptyIconColor = 'var(--icon-muted)';
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
        {emptyAction}
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
              data-save-title={s.title || undefined}
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
                  src={resolveAsset(s, 'thumb')}
                  alt=""
                  loading="lazy"
                  decoding="async"
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
      className={`${styles.grid}${marqueeRect ? ` ${styles.marqueeActive}` : ''}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      onMouseDown={startMarquee}
    >
      {marqueeRect && (
        <div
          className={styles.marquee}
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
          aria-hidden="true"
        />
      )}
      {columnBuckets.map((bucket, colIdx) => (
        <div key={colIdx} className={styles.column}>
          {bucket.map(({ save: s, staggerMs }) => (
            <ImageCard
              key={s.id}
              record={s}
              columns={columns}
              selected={selected.has(s.id)}
              selectionActive={selected.size > 0}
              highlighted={highlightId === s.id}
              onSelect={onSelect}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onHover={onHover}
              onForceClick={onForceClick}
              fresh={freshIds?.has(s.id)}
              staggerMs={staggerMs}
              morphSource={morphId === s.id}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
