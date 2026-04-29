import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import styles from './Sidebar.module.css';
import ContextMenu from './ContextMenu.jsx';
import { fileUrl } from '../lib/fileUrl.js';

function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="5.5" height="5.5" rx="1.2" />
      <rect x="8.5" y="2" width="5.5" height="5.5" rx="1.2" />
      <rect x="2" y="8.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.2" />
    </svg>
  );
}

function CollapseSidebarIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <line x1="6" y1="3" x2="6" y2="13" />
    </svg>
  );
}

function SettingsGearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.6" y="4.4" width="12.8" height="7.2" rx="1.4" />
      <line x1="3.6" y1="6.7" x2="3.7" y2="6.7" />
      <line x1="6" y1="6.7" x2="6.1" y2="6.7" />
      <line x1="8.4" y1="6.7" x2="8.5" y2="6.7" />
      <line x1="10.8" y1="6.7" x2="10.9" y2="6.7" />
      <line x1="3.6" y1="9" x2="3.7" y2="9" />
      <line x1="12.4" y1="9" x2="12.5" y2="9" />
      <line x1="5.2" y1="9.6" x2="10.8" y2="9.6" />
    </svg>
  );
}

// Bucket icon — trapezoid pail with a handle. Used for every bucket
// entry in the sidebar. Tinted blue (var(--icon-blue)) everywhere via
// currentColor — buckets don't have per-bucket colors anymore.
export function CollectionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      {/* handle */}
      <path d="M5 5.4 C5 3.5, 11 3.5, 11 5.4" />
      {/* pail body */}
      <path d="M3.6 5.6 L4.6 13 a1 1 0 0 0 1 0.9 h4.8 a1 1 0 0 0 1 -0.9 L12.4 5.6 Z" fill="currentColor" fillOpacity="0.18" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.4 9.5 L4 3.5 a1 1 0 0 1 1 -0.7 h6 a1 1 0 0 1 1 0.7 L13.6 9.5" />
      <path d="M2.4 9.5 H6 l1 1.5 h2 l1 -1.5 h3.6 V12.6 a1 1 0 0 1 -1 1 H3.4 a1 1 0 0 1 -1 -1 Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5 H13" />
      <path d="M6.4 4.5 V3.4 a0.8 0.8 0 0 1 0.8 -0.8 h1.6 a0.8 0.8 0 0 1 0.8 0.8 V4.5" />
      <path d="M4.4 4.5 L5.1 13 a1 1 0 0 0 1 0.9 h3.8 a1 1 0 0 0 1 -0.9 L11.6 4.5" />
      <path d="M6.8 7 V11.5 M9.2 7 V11.5" />
    </svg>
  );
}

function ConfettiBurst({ anchor, onDone }) {
  // Pre-roll a fixed set of particle vectors for this burst so the
  // motion is stable across re-renders within the same animation.
  const particles = React.useMemo(() => {
    const COLORS = ['#34c759', '#ffcc00', '#ff9500', '#0a84ff', '#af52de', '#ff3b30', '#5ac8fa'];
    return Array.from({ length: 22 }, (_, i) => {
      // Bias the spread upward and to the right (away from the
      // sidebar's left edge) so most pieces fly toward the canvas.
      const angle = -110 + Math.random() * 140; // -110° to +30° (mostly up + right)
      const distance = 28 + Math.random() * 60;
      return {
        id: i,
        dx: Math.cos((angle * Math.PI) / 180) * distance,
        dy: Math.sin((angle * Math.PI) / 180) * distance,
        rot: (Math.random() * 540 - 270),
        delay: Math.random() * 80,
        size: 4 + Math.random() * 4,
        color: COLORS[i % COLORS.length],
      };
    });
  }, []);

  React.useEffect(() => {
    const t = setTimeout(onDone, 1500);
    return () => clearTimeout(t);
  }, [onDone]);

  if (!anchor) return null;
  return ReactDOM.createPortal(
    <div className={styles.confetti} style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}>
      {particles.map((p) => (
        <span
          key={p.id}
          className={styles.confettiPiece}
          style={{
            '--dx': `${p.dx}px`,
            '--dy': `${p.dy}px`,
            '--rot': `${p.rot}deg`,
            '--delay': `${p.delay}ms`,
            background: p.color,
            width: `${p.size}px`,
            height: `${p.size}px`,
          }}
        />
      ))}
    </div>,
    document.body,
  );
}

// Inline count badge that briefly slide-fades on every change. The
// effect skips the first render — opening the app shouldn't fire a
// wave of animations on every populated badge in the sidebar. After
// that, each value bump remounts via a fresh `key` so the CSS
// keyframe restarts cleanly.
function AnimatedCount({ value, className }) {
  const [bumpKey, setBumpKey] = React.useState(null);
  const prev = React.useRef(value);
  React.useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setBumpKey((k) => (k == null ? 1 : k + 1));
    }
  }, [value]);
  return (
    <span
      key={bumpKey ?? 'init'}
      className={[className, bumpKey != null && styles.countBump].filter(Boolean).join(' ')}
    >
      {value}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5 L6.5 12 L13 4.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 2.5 L13.5 5 L5.5 13 H3 V10.5 Z" />
      <path d="M9.5 4 L12 6.5" />
    </svg>
  );
}


const SMART_VIEWS = [
  { id: 'all',      label: 'All',      color: 'var(--icon-blue)',   Icon: GridIcon },
  { id: 'unsorted', label: 'Unsorted', color: 'var(--icon-yellow)', Icon: InboxIcon },
  { id: 'trash',    label: 'Trash',    color: 'var(--text-tertiary)', Icon: TrashIcon },
];

// Walk the (already order_index-sorted) collections list and emit a
// flat render queue: each top-level bucket immediately followed by its
// children (when expanded). Orphaned children (parent_id pointing at a
// deleted bucket) are promoted to top-level so they don't disappear
// from the sidebar. `creatingForParent`, when set, injects a
// `newChild` sentinel after that parent's children block — that's
// where the inline child-create input renders.
function flattenCollections(collections, creatingForParent, expandedBuckets) {
  const ids = new Set(collections.map((c) => c.id));
  const childrenByParent = new Map();
  const tops = [];
  for (const c of collections) {
    if (c.parent_id && ids.has(c.parent_id)) {
      const arr = childrenByParent.get(c.parent_id) || [];
      arr.push(c);
      childrenByParent.set(c.parent_id, arr);
    } else {
      tops.push(c);
    }
  }
  const out = [];
  for (const t of tops) {
    const kids = childrenByParent.get(t.id) || [];
    const hasChildren = kids.length > 0 || creatingForParent === t.id;
    // Default to expanded (null sentinel from caller). Once the user
    // toggles anything, expandedBuckets is a real Set and we honor it.
    const isExpanded = !expandedBuckets || expandedBuckets.has(t.id);
    out.push({
      kind: 'collection',
      collection: t,
      depth: 0,
      hasChildren,
      isExpanded,
    });
    if (isExpanded) {
      for (const k of kids) {
        out.push({ kind: 'collection', collection: k, depth: 1, hasChildren: false });
      }
      if (creatingForParent === t.id) {
        out.push({ kind: 'newChild', parentId: t.id });
      }
    }
  }
  return out;
}

function DisclosureChevron({ expanded }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="10"
      height="10"
      style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 140ms ease' }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2.5L8 6L4 9.5" />
    </svg>
  );
}

export default function Sidebar({
  view,
  onViewChange,
  collections = [],
  smartCounts = { all: 0, unsorted: 0, trash: 0 },
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onReorderCollections,
  onAddSavesToBucket,
  onToggleCollapse,
  onUpload,
  onOpenSettings,
  onOpenShortcuts,
  createCollectionSignal,
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  // When set, the next "create bucket" commit will be inserted as a
  // child of this parent id rather than as a top-level bucket. Always
  // null while creating === false.
  const [creatingForParent, setCreatingForParent] = useState(null);

  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, collection }

  const [draggingId, setDraggingId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);

  // Which top-level buckets are currently expanded. `null` is the
  // first-render sentinel meaning "default to all expanded" — once
  // the user toggles anything we hydrate it with a real Set and from
  // then on persist explicit expand/collapse decisions.
  const [expandedBuckets, setExpandedBuckets] = useState(() => {
    try {
      const raw = localStorage.getItem('moodmark.expandedBuckets');
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    return null;
  });

  useEffect(() => {
    if (!expandedBuckets) return;
    try {
      localStorage.setItem(
        'moodmark.expandedBuckets',
        JSON.stringify([...expandedBuckets]),
      );
    } catch {}
  }, [expandedBuckets]);

  // Whether any visible bucket has a child. Drives whether *every*
  // row reserves a disclosure column on its left — when there's no
  // nesting, labels can sit flush-left without an empty spacer.
  // Includes the in-progress child-create case so the column
  // appears the instant the user starts typing a child name.
  const showDisclosureColumn = useMemo(() => {
    const ids = new Set(collections.map((c) => c.id));
    const hasNested = collections.some((c) => c.parent_id && ids.has(c.parent_id));
    return hasNested || !!creatingForParent;
  }, [collections, creatingForParent]);

  function toggleBucketExpanded(id) {
    setExpandedBuckets((prev) => {
      // First explicit toggle: seed from "all parents expanded" so the
      // user's first click only affects the bucket they clicked.
      const seed = prev || new Set(
        collections.filter((c) => !c.parent_id).map((c) => c.id),
      );
      const next = new Set(seed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const createInputRef = useRef(null);
  const renameInputRef = useRef(null);

  function startCreating() {
    setCreating(true);
    setCreatingForParent(null);
    setNewName('');
    requestAnimationFrame(() => createInputRef.current?.focus());
  }

  // Inline child-bucket creation, anchored under a specific parent.
  // Auto-expands the parent if it was collapsed so the user sees the
  // input + the eventual child appear in place.
  function startCreatingChild(parentId) {
    setCreating(true);
    setCreatingForParent(parentId);
    setNewName('');
    if (expandedBuckets && !expandedBuckets.has(parentId)) {
      setExpandedBuckets((prev) => {
        const next = new Set(prev);
        next.add(parentId);
        return next;
      });
    }
    requestAnimationFrame(() => createInputRef.current?.focus());
  }

  // Bumped signal counter from App when ⌘N fires; trigger the inline
  // creation flow whenever the value changes (skipping the initial
  // mount value).
  useEffect(() => {
    if (createCollectionSignal === undefined || createCollectionSignal === 0) return;
    startCreating();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createCollectionSignal]);

  function cancelCreating() {
    setCreating(false);
    setCreatingForParent(null);
    setNewName('');
  }

  async function commitCreate() {
    const name = newName.trim();
    if (!name) { cancelCreating(); return; }
    await onCreateCollection({ name, parentId: creatingForParent });
    cancelCreating();
  }

  function handleCreateKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitCreate(); }
    if (e.key === 'Escape') cancelCreating();
  }

  function startRename(collection) {
    setRenamingId(collection.id);
    setRenameValue(collection.name);
    requestAnimationFrame(() => renameInputRef.current?.select());
  }

  async function commitRename(id) {
    const name = renameValue.trim();
    if (name) await onRenameCollection({ id, name });
    setRenamingId(null);
  }

  function handleRenameKeyDown(e, id) {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(id); }
    if (e.key === 'Escape') setRenamingId(null);
  }

  function handleCollectionContextMenu(e, collection) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, collection });
  }

  // ── Inbox-zero confetti ───────────────────────────────────────────────
  // Fire a one-shot burst when smartCounts.unsorted transitions from
  // > 0 to 0. Anchored on the right edge of the Unsorted row so pieces
  // emerge from where the green check appears.
  const [confetti, setConfetti] = useState(null); // { id, x, y } | null
  const prevUnsortedRef = useRef(smartCounts.unsorted);
  useEffect(() => {
    if (prevUnsortedRef.current > 0 && smartCounts.unsorted === 0) {
      requestAnimationFrame(() => {
        const row = document.querySelector('[data-smart-view="unsorted"]');
        if (!row) return;
        const rect = row.getBoundingClientRect();
        setConfetti({
          id: Date.now(),
          x: rect.right - 14,
          y: rect.top + rect.height / 2,
        });
      });
    }
    prevUnsortedRef.current = smartCounts.unsorted;
  }, [smartCounts.unsorted]);

  // ── Hover preview ────────────────────────────────────────────────────────
  // Brief 2×2 mosaic preview when hovering a bucket row. Fetched lazily
  // on hover with a short delay so quick mouse-overs don't fire IPC.
  const [hoverPreview, setHoverPreview] = useState(null);
  // { bucketId, saves: [...], x, y } | null
  const previewTimerRef = useRef(null);
  // Generation counter so cancelled fetches don't commit late.
  const previewGenRef = useRef(0);

  function scheduleHoverPreview(bucketId, target) {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    const rect = target.getBoundingClientRect();
    const gen = ++previewGenRef.current;
    previewTimerRef.current = setTimeout(async () => {
      if (gen !== previewGenRef.current) return;
      let data = [];
      try {
        data = await window.moodmark.saves.getAll({ collectionId: bucketId });
      } catch { return; }
      if (gen !== previewGenRef.current) return;
      const slice = (data || []).slice(0, 4);
      if (slice.length === 0) return;
      setHoverPreview({
        bucketId,
        saves: slice,
        x: rect.right + 8,
        y: rect.top + rect.height / 2,
      });
    }, 320);
  }

  function cancelHoverPreview() {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewGenRef.current++;
    setHoverPreview(null);
  }

  useEffect(() => () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
  }, []);

  // ── Drag-to-reorder ──────────────────────────────────────────────────────
  function handleDragStart(e, id) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Setting some data is required by Firefox/Electron for drag to start.
    e.dataTransfer.setData('text/moodmark-collection', id);
  }

  function handleDragOver(e, id) {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetId !== id) setDropTargetId(id);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDropTargetId(null);
  }

  async function handleDrop(e, targetId) {
    e.preventDefault();
    e.stopPropagation();
    const fromId = draggingId;
    handleDragEnd();
    if (!fromId || fromId === targetId) return;
    const ids = collections.map((c) => c.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    // Dragging downward (from above the target) → insert *after* the
    // target. Dragging upward (from below) → insert *before*. The
    // earlier "always insert before" rule meant dragging the first of
    // two items onto the second was a no-op (it filtered out the
    // dragged id, then reinserted it before the target — its original
    // position).
    const filtered = ids.filter((id) => id !== fromId);
    const targetIdxAfterRemove = filtered.indexOf(targetId);
    if (targetIdxAfterRemove < 0) return;
    const insertIdx = fromIdx < toIdx
      ? targetIdxAfterRemove + 1
      : targetIdxAfterRemove;
    filtered.splice(insertIdx, 0, fromId);
    await onReorderCollections?.(filtered);
  }

  // ── Drag-saves-into-bucket ───────────────────────────────────────────────
  // The grid cards drag with the SAVE_DROP_MIME payload (a JSON array
  // of save ids). These handlers light up a bucket on hover and call
  // back to App on drop so the addSave + flyToCollection happens once.
  const SAVE_DROP_MIME = 'application/x-moodmark-save-ids';
  const [saveDropTargetId, setSaveDropTargetId] = useState(null);
  // Spring-loaded buckets: hover a bucket while dragging a save and
  // after a beat we switch the active view to that bucket so you
  // can peek inside before committing to drop.
  const springTargetRef = useRef(null);
  const springTimerRef = useRef(null);
  const SPRING_LOAD_MS = 700;

  function clearSpringLoad() {
    if (springTimerRef.current) clearTimeout(springTimerRef.current);
    springTimerRef.current = null;
    springTargetRef.current = null;
  }

  function isSaveDrag(e) {
    return e.dataTransfer.types.includes(SAVE_DROP_MIME);
  }

  function handleSaveDragOver(e, bucketId) {
    if (!isSaveDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (saveDropTargetId !== bucketId) setSaveDropTargetId(bucketId);

    // Restart the spring-load timer when we land on a different
    // bucket. Skip if we're already viewing this bucket — no point
    // springing into the view we're already on.
    if (springTargetRef.current !== bucketId) {
      springTargetRef.current = bucketId;
      if (springTimerRef.current) clearTimeout(springTimerRef.current);
      const isAlreadyActive = view.type === 'collection' && view.id === bucketId;
      if (!isAlreadyActive) {
        springTimerRef.current = setTimeout(() => {
          // Re-check via the ref so a quick mouse-out cancels.
          if (springTargetRef.current === bucketId) {
            onViewChange?.({ type: 'collection', id: bucketId });
          }
        }, SPRING_LOAD_MS);
      }
    }
  }

  function handleSaveDragLeave(e) {
    // dragleave fires when entering child elements too — only reset if
    // we really left the row.
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setSaveDropTargetId(null);
      clearSpringLoad();
    }
  }

  async function handleSaveDrop(e, bucketId) {
    if (!isSaveDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setSaveDropTargetId(null);
    clearSpringLoad();
    let ids;
    try { ids = JSON.parse(e.dataTransfer.getData(SAVE_DROP_MIME) || '[]'); }
    catch { return; }
    if (!Array.isArray(ids) || ids.length === 0) return;
    await onAddSavesToBucket?.(bucketId, ids);
  }

  // Drag-end anywhere should also cancel a pending spring-load — if
  // the user dropped outside any bucket or hit Escape, we don't want
  // a stray timer to fire later.
  useEffect(() => {
    const onEnd = () => clearSpringLoad();
    document.addEventListener('dragend', onEnd);
    document.addEventListener('drop', onEnd);
    return () => {
      document.removeEventListener('dragend', onEnd);
      document.removeEventListener('drop', onEnd);
    };
  }, []);

  const ctxItems = ctxMenu
    ? [
        { label: 'Rename', icon: <PencilIcon />, onClick: () => startRename(ctxMenu.collection) },
        // Only top-level buckets can have children — single level cap.
        ...(ctxMenu.collection.parent_id ? [] : [{
          label: 'Add Child Bucket',
          icon: <CollectionIcon />,
          onClick: () => startCreatingChild(ctxMenu.collection.id),
        }]),
        { label: 'Delete Bucket', icon: <TrashIcon />, danger: true, onClick: () => onDeleteCollection(ctxMenu.collection.id) },
      ]
    : [];

  return (
    <aside className={styles.sidebar}>
      {onToggleCollapse && (
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          title="Collapse sidebar"
        >
          <CollapseSidebarIcon />
        </button>
      )}
      <div className={styles.sectionHeaderRow}>
        <span className={styles.sectionHeaderLabel}>Library</span>
        {onUpload && (
          <button
            type="button"
            className={styles.addBtn}
            onClick={onUpload}
            title="Upload image"
          >
            +
          </button>
        )}
      </div>

      <nav className={styles.section}>
        {SMART_VIEWS.map(({ id, label, Icon }) => {
          const active = view.type === id;
          const count = smartCounts[id] ?? 0;
          const inboxZero = id === 'unsorted' && count === 0;
          return (
            <button
              key={id}
              data-smart-view={id}
              className={`${styles.item} ${active ? styles.active : ''}`}
              onClick={() => onViewChange({ type: id })}
              title={inboxZero ? 'Inbox zero — every save is in a bucket' : undefined}
            >
              <span
                className={styles.icon}
                style={{ color: active ? '#fff' : 'var(--text-secondary)' }}
              >
                <Icon />
              </span>
              <span className={styles.label}>{label}</span>
              {inboxZero ? (
                <span
                  className={`${styles.inboxZero}${active ? ' ' + styles.inboxZeroActive : ''}`}
                  aria-label="Inbox zero"
                >
                  <CheckIcon />
                </span>
              ) : (
                <AnimatedCount value={count} className={styles.smartCount} />
              )}
            </button>
          );
        })}
      </nav>

      <div className={styles.sectionHeaderRow}>
        <span className={styles.sectionHeaderLabel}>Buckets</span>
        <button
          className={styles.addBtn}
          onClick={startCreating}
          title="New Bucket"
        >
          +
        </button>
      </div>

      {creating && !creatingForParent && (
        <div className={styles.newCollectionForm}>
          <input
            ref={createInputRef}
            className={styles.newCollectionInput}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleCreateKeyDown}
            placeholder="Bucket name"
          />
          <div className={styles.newCollectionBtns}>
            <button className={styles.formBtn} onClick={cancelCreating}>Cancel</button>
            <button
              className={`${styles.formBtn} ${styles.formBtnPrimary}`}
              onClick={commitCreate}
            >
              Create
            </button>
          </div>
        </div>
      )}

      <nav className={styles.section}>
        {collections.length === 0 && !creating ? (
          <div className={styles.empty}>No buckets yet</div>
        ) : (
          flattenCollections(collections, creatingForParent, expandedBuckets).map((entry) => {
            // Inline sentinel: the inline create-child input that
            // belongs under a specific parent.
            if (entry.kind === 'newChild') {
              return (
                <div
                  key="__newChild__"
                  className={`${styles.newCollectionForm} ${styles.childForm}`}
                >
                  <input
                    ref={createInputRef}
                    className={styles.newCollectionInput}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={handleCreateKeyDown}
                    placeholder="Child bucket name"
                  />
                  <div className={styles.newCollectionBtns}>
                    <button className={styles.formBtn} onClick={cancelCreating}>Cancel</button>
                    <button
                      className={`${styles.formBtn} ${styles.formBtnPrimary}`}
                      onClick={commitCreate}
                    >
                      Create
                    </button>
                  </div>
                </div>
              );
            }
            const c = entry.collection;
            const depth = entry.depth;
            const active = view.type === 'collection' && view.id === c.id;
            const isDragging = draggingId === c.id;
            const isDropTarget = dropTargetId === c.id && draggingId && draggingId !== c.id;
            const itemClass = [
              styles.item,
              active && styles.active,
              isDragging && styles.dragging,
              isDropTarget && styles.dropTarget,
              depth > 0 && styles.itemChild,
            ].filter(Boolean).join(' ');

            if (renamingId === c.id) {
              return (
                <div key={c.id} className={itemClass}>
                  {showDisclosureColumn && (
                    <span className={styles.disclosureSpacer} aria-hidden="true" />
                  )}
                  <span className={styles.icon}>
                    <CollectionIcon />
                  </span>
                  <input
                    ref={renameInputRef}
                    className={styles.renameInput}
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => handleRenameKeyDown(e, c.id)}
                    onBlur={() => commitRename(c.id)}
                  />
                </div>
              );
            }
            const isSaveDropTarget = saveDropTargetId === c.id;
            const itemClassWithDrop = [itemClass, isSaveDropTarget && styles.saveDropTarget]
              .filter(Boolean).join(' ');
            return (
              <button
                key={c.id}
                data-collection-id={c.id}
                className={itemClassWithDrop}
                onClick={() => {
                  // Click a collapsed parent → expand it as well as
                  // filtering. We don't auto-collapse on a second
                  // click because that would conflict with the row's
                  // primary "filter to this bucket" action — collapse
                  // is reachable via the chevron.
                  if (entry.depth === 0 && entry.hasChildren && !entry.isExpanded) {
                    toggleBucketExpanded(c.id);
                  }
                  onViewChange({ type: 'collection', id: c.id });
                }}
                onDoubleClick={(e) => {
                  // In-place rename — same flow as Right-click → Rename.
                  // preventDefault stops the OS text-select that double-
                  // click usually fires.
                  e.preventDefault();
                  startRename(c);
                }}
                onContextMenu={(e) => handleCollectionContextMenu(e, c)}
                onMouseEnter={(e) => scheduleHoverPreview(c.id, e.currentTarget)}
                onMouseLeave={cancelHoverPreview}
                draggable
                onDragStart={(e) => handleDragStart(e, c.id)}
                onDragOver={(e) => {
                  handleSaveDragOver(e, c.id);
                  handleDragOver(e, c.id);
                }}
                onDragLeave={handleSaveDragLeave}
                onDragEnd={handleDragEnd}
                onDrop={(e) => {
                  if (isSaveDrag(e)) {
                    handleSaveDrop(e, c.id);
                  } else {
                    handleDrop(e, c.id);
                  }
                }}
              >
                {showDisclosureColumn && (
                  entry.depth === 0 && entry.hasChildren ? (
                    <span
                      className={styles.disclosure}
                      role="button"
                      aria-label={entry.isExpanded ? 'Collapse' : 'Expand'}
                      aria-expanded={entry.isExpanded}
                      onMouseDown={(e) => {
                        // Stop the parent button from receiving focus /
                        // firing its onClick when the chevron is hit.
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleBucketExpanded(c.id);
                      }}
                    >
                      <DisclosureChevron expanded={entry.isExpanded} />
                    </span>
                  ) : (
                    <span className={styles.disclosureSpacer} aria-hidden="true" />
                  )
                )}
                <span
                  className={styles.icon}
                  style={{ color: active ? '#fff' : 'var(--icon-blue)' }}
                >
                  <CollectionIcon />
                </span>
                <span className={styles.label}>{c.name}</span>
                {c.save_count > 0 && (
                  <AnimatedCount value={c.save_count} className={styles.count} />
                )}
              </button>
            );
          })
        )}
        {/* Tail dropzone — captures drops in the empty space below the
            last bucket so users can "send to end" by dragging past
            the list. Visible only while a bucket is being dragged
            (the per-row drop handlers cover dropping onto an
            existing row). */}
        {draggingId && collections.length > 0 && (
          <div
            className={[
              styles.tailDropzone,
              dropTargetId === '__end__' && styles.tailDropzoneActive,
            ].filter(Boolean).join(' ')}
            onDragOver={(e) => {
              if (!draggingId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dropTargetId !== '__end__') setDropTargetId('__end__');
            }}
            onDragLeave={() => {
              if (dropTargetId === '__end__') setDropTargetId(null);
            }}
            onDrop={(e) => {
              if (!draggingId || isSaveDrag(e)) return;
              e.preventDefault();
              e.stopPropagation();
              const fromId = draggingId;
              handleDragEnd();
              const ids = collections.map((c) => c.id).filter((id) => id !== fromId);
              ids.push(fromId);
              onReorderCollections?.(ids);
            }}
            aria-hidden="true"
          />
        )}
      </nav>

      {(onOpenSettings || onOpenShortcuts) && (
        <div className={styles.footer}>
          {onOpenSettings && (
            <button
              type="button"
              className={styles.footerBtn}
              onClick={onOpenSettings}
              title="Settings"
            >
              <span className={styles.footerIcon}><SettingsGearIcon /></span>
              <span className={styles.footerLabel}>Settings</span>
            </button>
          )}
          {onOpenShortcuts && (
            <button
              type="button"
              className={styles.footerBtn}
              onClick={onOpenShortcuts}
              title="Keyboard shortcuts"
            >
              <span className={styles.footerIcon}><KeyboardIcon /></span>
              <span className={styles.footerLabel}>Shortcuts</span>
            </button>
          )}
        </div>
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {hoverPreview && ReactDOM.createPortal(
        <div
          className={styles.bucketPreview}
          style={{ left: `${hoverPreview.x}px`, top: `${hoverPreview.y}px` }}
        >
          <div className={styles.bucketPreviewStack}>
            {hoverPreview.saves.slice(0, 4).map((s) => (
              <img
                key={s.id}
                src={fileUrl(s.thumb_path || s.file_path)}
                alt=""
                draggable={false}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
      {confetti && (
        <ConfettiBurst
          key={confetti.id}
          anchor={{ x: confetti.x, y: confetti.y }}
          onDone={() => setConfetti(null)}
        />
      )}
    </aside>
  );
}
