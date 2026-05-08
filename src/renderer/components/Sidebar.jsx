import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import styles from './Sidebar.module.css';
import ContextMenu from './ContextMenu.jsx';
import LibrarySwitcher from './LibrarySwitcher.jsx';
import SidebarSearch from './SidebarSearch.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { fileUrl } from '../lib/fileUrl.js';
import { extractDropImageUrls } from '../lib/dropUrls.js';

import {
  LayoutGrid,
  PanelLeft,
  Settings,
  Keyboard,
  FolderClosed,
  Inbox,
  Trash2,
  Check as LucideCheck,
  Pencil,
  Shuffle,
  ChevronRight,
  Megaphone,
  HelpCircle,
  Frame,
  CalendarHeart,
} from 'lucide-react';

// Tiny self-contained theme toggle that lives in the sidebar footer.
// Source of truth is <html data-theme>; clicking flips the attribute,
// persists the pref, and asks main to flip the macOS native chrome
// (traffic lights, scrollbars). No props needed — same IPC the
// Settings modal uses.
const SIDEBAR_ICON = { strokeWidth: 1.6, 'aria-hidden': true };
const GridIcon = () => <LayoutGrid {...SIDEBAR_ICON} />;
const CollapseSidebarIcon = () => <PanelLeft {...SIDEBAR_ICON} />;
const SettingsGearIcon = () => <Settings {...SIDEBAR_ICON} />;
const KeyboardIcon = () => <Keyboard {...SIDEBAR_ICON} />;
const MegaphoneIcon = () => <Megaphone {...SIDEBAR_ICON} />;
const HelpIcon = () => <HelpCircle {...SIDEBAR_ICON} />;
// Buckets read as folders in the sidebar — the previous bespoke
// pail icon doesn't have a clean Lucide equivalent, FolderClosed is
// the closest semantic match.
export const CollectionIcon = () => <FolderClosed {...SIDEBAR_ICON} />;
export const InboxIcon = () => <Inbox {...SIDEBAR_ICON} />;
export const TrashIcon = () => <Trash2 {...SIDEBAR_ICON} />;
export const BoardIcon = () => <Frame {...SIDEBAR_ICON} />;
const OnThisDayIcon = () => <CalendarHeart {...SIDEBAR_ICON} />;

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

const CheckIcon = () => <LucideCheck size={16} strokeWidth={2} aria-hidden="true" />;
const PencilIcon = () => <Pencil {...SIDEBAR_ICON} />;
const ShuffleIcon = () => <Shuffle {...SIDEBAR_ICON} />;

const SMART_VIEWS = [
  { id: 'all',        label: 'All',          color: 'var(--icon-blue)',     Icon: GridIcon },
  { id: 'unsorted',   label: 'Unsorted',     color: 'var(--icon-yellow)',   Icon: InboxIcon },
  { id: 'onThisDay',  label: 'On this day',  color: 'var(--icon-pink)',     Icon: OnThisDayIcon },
  { id: 'trash',      label: 'Trash',        color: 'var(--text-tertiary)', Icon: TrashIcon },
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
    <ChevronRight
      size={10}
      strokeWidth={1.6}
      style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 140ms ease' }}
      aria-hidden="true"
    />
  );
}

export default function Sidebar({
  libraries,
  activeLibraryId,
  onSwitchLibrary,
  onCreateLibrary,
  onRenameLibrary,
  onDeleteLibrary,
  search,
  onSearchChange,
  onShuffleView,
  view,
  onViewChange,
  collections = [],
  smartCounts = { all: 0, unsorted: 0, trash: 0 },
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onReorderCollections,
  onAddSavesToBucket,
  onExternalDropToBucket,
  onSetAppDragging,
  onToggleCollapse,
  onUpload,
  onOpenSettings,
  onOpenShortcuts,
  onOpenReleaseNotes,
  onOpenRediscover,
  releaseNotesUnseen = false,
  createCollectionSignal,
  boards = [],
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
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
  // Smart-view context menu (All / Unsorted / Trash). All gets a
  // Shuffle entry; the others currently render no items but the
  // hook is kept open for future actions.
  const [smartCtx, setSmartCtx] = useState(null); // { x, y, viewId }
  const [boardCtx, setBoardCtx] = useState(null);  // { x, y, board }

  const [draggingId, setDraggingId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // Anchor rect for the portaled help popover. Recomputed on open
  // and on resize/scroll so the popover stays glued to the trigger.
  const [helpAnchor, setHelpAnchor] = useState(null);
  const helpBtnRef = useRef(null);
  const helpPopRef = useRef(null);

  useEffect(() => {
    if (!helpOpen) {
      setHelpAnchor(null);
      return undefined;
    }
    const measure = () => {
      const el = helpBtnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setHelpAnchor({ left: r.left, top: r.top, width: r.width });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [helpOpen]);

  // Close the help popover on outside click / Escape.
  useEffect(() => {
    if (!helpOpen) return undefined;
    function onPointerDown(e) {
      const inBtn = helpBtnRef.current && helpBtnRef.current.contains(e.target);
      const inPop = helpPopRef.current && helpPopRef.current.contains(e.target);
      if (!inBtn && !inPop) setHelpOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setHelpOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [helpOpen]);

  function helpAction(fn) {
    return () => {
      setHelpOpen(false);
      fn?.();
    };
  }
  // 'reorder' | 'nest' — which gesture the current dragOver maps to.
  // Three-zone hit test: top 30% / bottom 30% = reorder above/below
  // (we only render the existing top line for either since the
  // reorder handler doesn't distinguish), middle 40% = nest under
  // the target.
  const [dropMode, setDropMode] = useState('reorder');

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

// ── Hover preview ────────────────────────────────────────────────────────
  // Brief 2×2 mosaic preview when hovering a bucket row. Fetched lazily
  // on hover with a short delay so quick mouse-overs don't fire IPC.
  const [hoverPreview, setHoverPreview] = useState(null);
  // { bucketId, saves: [...], x, y } | null
  const previewTimerRef = useRef(null);
  // Generation counter so cancelled fetches don't commit late.
  const previewGenRef = useRef(0);

  // Generic hover preview — works for either a bucket (fetched via
  // saves.getAll filtered by collectionId) or a board (fetched via
  // boards.getPreviewSaves which joins the first N image items'
  // saves on the main side, avoiding a round-trip per item).
  function scheduleHoverPreview(kind, id, target) {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    const rect = target.getBoundingClientRect();
    const gen = ++previewGenRef.current;
    previewTimerRef.current = setTimeout(async () => {
      if (gen !== previewGenRef.current) return;
      let data = [];
      try {
        if (kind === 'board') {
          data = await window.moodmark.boards.getPreviewSaves(id, 4);
        } else {
          data = await window.moodmark.saves.getAll({ collectionId: id });
        }
      } catch { return; }
      if (gen !== previewGenRef.current) return;
      const slice = (data || []).slice(0, 4);
      if (slice.length === 0) return;
      setHoverPreview({
        sourceId: id,
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

    // Three-zone hit test based on cursor Y within the row.
    // Middle 40% = nest as child; top/bottom 30% each = reorder.
    // Restrictions on nesting:
    //  - target can't be the row being dragged
    //  - target can't be a child folder (one-level cap)
    //  - dragging folder can't host children when it has its own
    //    children (the setParent helper promotes them, but we hide
    //    the affordance for visual honesty).
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
    const target = collections.find((c) => c.id === id);
    const dragging = collections.find((c) => c.id === draggingId);
    const targetIsChild = !!target?.parent_id;
    const draggingHasChildren = dragging
      && collections.some((c) => c.parent_id === dragging.id);
    const canNest = !!target
      && id !== draggingId
      && !targetIsChild
      && !draggingHasChildren
      && dragging?.parent_id !== id; // already nested under this parent
    const mode = canNest && ratio > 0.3 && ratio < 0.7 ? 'nest' : 'reorder';

    if (dropTargetId !== id) setDropTargetId(id);
    if (dropMode !== mode) setDropMode(mode);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDropTargetId(null);
    setDropMode('reorder');
  }

  async function handleDrop(e, targetId) {
    e.preventDefault();
    e.stopPropagation();
    const fromId = draggingId;
    const mode = dropMode;
    handleDragEnd();
    if (!fromId || fromId === targetId) return;

    if (mode === 'nest') {
      // Move under the target as a child. Server-side helper rejects
      // invalid nesting (cycles, two-level chains).
      try {
        const res = await window.moodmark.collections.setParent(fromId, targetId);
        if (res?.ok) {
          // Auto-expand the new parent so the child is visible.
          setExpandedBuckets((prev) => {
            const next = new Set(prev || []);
            next.add(targetId);
            return next;
          });
          await onReorderCollections?.(collections.map((c) => c.id));
        }
      } catch (err) {
        console.error('[gatheros] setParent failed:', err);
      }
      return;
    }

    // Reorder mode. If the dragged folder ends up positioned among
    // a different parent's siblings (or at the top level), update
    // its parent_id to match the target's. This is the inverse of
    // the nest gesture: drag a child folder up to a top-level row's
    // reorder zone and drop → it gets promoted to top-level. Drop a
    // top-level folder onto a child's reorder zone → it joins that
    // parent's children. setParent server-side enforces the schema's
    // one-level cap so we don't have to re-validate here.
    const draggedItem = collections.find((c) => c.id === fromId);
    const targetItem = collections.find((c) => c.id === targetId);
    const desiredParentId = targetItem?.parent_id || null;
    if (draggedItem && (draggedItem.parent_id || null) !== desiredParentId) {
      try {
        await window.moodmark.collections.setParent(fromId, desiredParentId);
      } catch (err) {
        console.error('[gatheros] setParent failed during reorder:', err);
      }
    }

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

  function isExternalImageDrag(e) {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    const arr = Array.from(types);
    return arr.includes('Files')
      || arr.includes('text/uri-list')
      || arr.includes('text/html');
  }

  function handleSaveDragOver(e, bucketId) {
    const internal = isSaveDrag(e);
    const external = !internal && isExternalImageDrag(e);
    if (!internal && !external) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (saveDropTargetId !== bucketId) setSaveDropTargetId(bucketId);

    // External drag is over a folder row → suppress the app-shell's
    // catch-all "Drop to save" overlay so the user sees a clear,
    // single drop affordance (the highlighted row). stopPropagation
    // prevents the app-shell's bubbling onDragOver from re-flipping
    // the overlay back on as the cursor moves over the sidebar.
    if (external) {
      e.stopPropagation();
      onSetAppDragging?.(false);
    }

    // Spring-load (auto-switch view after a hover) only fires for
    // in-app save drags. External file drops arrive without the
    // user having committed to a folder yet — auto-switching the
    // view mid-drag would be jarring.
    if (internal && springTargetRef.current !== bucketId) {
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
    if (isSaveDrag(e)) {
      e.preventDefault();
      e.stopPropagation();
      setSaveDropTargetId(null);
      clearSpringLoad();
      let ids;
      try { ids = JSON.parse(e.dataTransfer.getData(SAVE_DROP_MIME) || '[]'); }
      catch { return; }
      if (!Array.isArray(ids) || ids.length === 0) return;
      await onAddSavesToBucket?.(bucketId, ids);
      return;
    }

    if (isExternalImageDrag(e)) {
      // External file or URL dropped directly onto a folder row.
      // Save through the standard pipeline (dedup-aware), then drop
      // the resulting save ids into this folder. stopPropagation
      // prevents the .app-shell drop handler from running and
      // double-saving.
      e.preventDefault();
      e.stopPropagation();
      setSaveDropTargetId(null);
      clearSpringLoad();

      // dataTransfer is invalidated after the synchronous portion
      // of the drop handler returns, so capture everything we need
      // here — File objects + parsed URLs — and hand a plain object
      // off to the parent.
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
      const urls = files.length === 0 ? extractDropImageUrls(e.dataTransfer) : [];
      // App-shell's onDrop won't fire (we stopPropagation), so we
      // explicitly clear the overlay flag here.
      onSetAppDragging?.(false);
      onExternalDropToBucket?.(bucketId, { files, urls });
    }
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
        ...(typeof onShuffleView === 'function' ? [{
          label: 'Shuffle',
          icon: <ShuffleIcon />,
          onClick: () => onShuffleView({ type: 'collection', id: ctxMenu.collection.id }),
        }] : []),
        { label: 'Rename', icon: <PencilIcon />, onClick: () => startRename(ctxMenu.collection) },
        // Only top-level buckets can have children — single level cap.
        ...(ctxMenu.collection.parent_id ? [] : [{
          label: 'Add Child Folder',
          icon: <CollectionIcon />,
          onClick: () => startCreatingChild(ctxMenu.collection.id),
        }]),
        { label: 'Delete Folder', icon: <TrashIcon />, danger: true, onClick: () => onDeleteCollection(ctxMenu.collection.id) },
      ]
    : [];

  // Smart-view context menu items. All / Unsorted both support
  // shuffle; Trash gets none (it's already random and this surface
  // shouldn't add noise).
  const boardCtxItems = boardCtx
    ? [
        {
          label: 'Rename',
          icon: <PencilIcon />,
          onClick: () => {
            const next = window.prompt(`Rename "${boardCtx.board.name}" to:`, boardCtx.board.name);
            if (next == null) return;
            const trimmed = next.trim();
            if (trimmed && trimmed !== boardCtx.board.name) {
              onRenameBoard?.({ id: boardCtx.board.id, name: trimmed });
            }
          },
        },
        {
          label: 'Delete Board',
          icon: <TrashIcon />,
          danger: true,
          onClick: () => {
            if (window.confirm(`Delete "${boardCtx.board.name}"? This can't be undone.`)) {
              onDeleteBoard?.(boardCtx.board.id);
            }
          },
        },
      ]
    : [];

  const smartCtxItems = smartCtx && (smartCtx.viewId === 'all' || smartCtx.viewId === 'unsorted')
    ? [
        ...(typeof onShuffleView === 'function' ? [{
          label: 'Shuffle',
          icon: <ShuffleIcon />,
          onClick: () => onShuffleView({ type: smartCtx.viewId }),
        }] : []),
      ]
    : [];

  function handleSmartViewContextMenu(e, viewId) {
    if (viewId === 'trash') return; // no menu items defined for trash
    e.preventDefault();
    setSmartCtx({ x: e.clientX, y: e.clientY, viewId });
  }

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
      {Array.isArray(libraries) && libraries.length > 0 && (
        <LibrarySwitcher
          libraries={libraries}
          activeId={activeLibraryId}
          onSwitch={onSwitchLibrary}
          onCreate={onCreateLibrary}
          onRename={onRenameLibrary}
          onDelete={onDeleteLibrary}
        />
      )}
      {typeof onSearchChange === 'function' && (
        <div className={styles.searchSlot}>
          <SidebarSearch value={search} onChange={onSearchChange} />
        </div>
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
        {SMART_VIEWS.map(({ id, label, Icon }, viewIdx) => {
          const active = view.type === id;
          const count = smartCounts[id] ?? 0;
          const inboxZero = id === 'unsorted' && count === 0;
          return (
            <React.Fragment key={id}>
              <button
                data-smart-view={id}
                className={`${styles.item} ${active ? styles.active : ''}`}
                onClick={() => onViewChange({ type: id })}
                onContextMenu={(e) => handleSmartViewContextMenu(e, id)}
                title={inboxZero ? 'Inbox zero — every save is in a folder' : undefined}
              >
                <span className={styles.icon}>
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
              {/* Rediscover sits directly under All. It's an action,
                  not a view — clicking it pops the full-screen
                  shuffle overlay instead of changing the active
                  filter, so we don't pass it through onViewChange. */}
              {viewIdx === 0 && onOpenRediscover && (
                <button
                  className={styles.item}
                  onClick={onOpenRediscover}
                  title="Random save full-screen — ←→↑ to swipe / bucket / skip"
                >
                  <span className={styles.icon}>
                    <ShuffleIcon />
                  </span>
                  <span className={styles.label}>Rediscover</span>
                </button>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      <div className={styles.sectionHeaderRow}>
        <span className={styles.sectionHeaderLabel}>Boards</span>
        {onCreateBoard && (
          <button
            className={styles.addBtn}
            onClick={async () => {
              const board = await onCreateBoard();
              if (board?.id) onViewChange?.({ type: 'board', id: board.id });
            }}
            title="New Board"
          >
            +
          </button>
        )}
      </div>

      <nav className={styles.section}>
        {boards.length === 0 ? (
          <div className={styles.empty}>No boards yet</div>
        ) : (
          boards.map((b) => {
            const active = view.type === 'board' && view.id === b.id;
            return (
              <button
                key={b.id}
                className={`${styles.item} ${active ? styles.active : ''}`}
                onClick={() => onViewChange?.({ type: 'board', id: b.id })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setBoardCtx({ x: e.clientX, y: e.clientY, board: b });
                }}
                onMouseEnter={(e) => scheduleHoverPreview('board', b.id, e.currentTarget)}
                onMouseLeave={cancelHoverPreview}
                title={b.name}
              >
                <span className={styles.icon}>
                  <BoardIcon />
                </span>
                <span className={styles.label}>{b.name}</span>
              </button>
            );
          })
        )}
      </nav>

      <div className={styles.sectionHeaderRow} data-onboarding="buckets">
        <span className={styles.sectionHeaderLabel}>Folders</span>
        <button
          className={styles.addBtn}
          onClick={startCreating}
          title="New Folder"
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
            placeholder="Folder name"
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
                    placeholder="Child folder name"
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
            const isNestTarget = isDropTarget && dropMode === 'nest';
            const itemClass = [
              styles.item,
              active && styles.active,
              isDragging && styles.dragging,
              isDropTarget && !isNestTarget && styles.dropTarget,
              isNestTarget && styles.dropTargetNest,
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
                onMouseEnter={(e) => scheduleHoverPreview('bucket', c.id, e.currentTarget)}
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
                  // In-app save-card drag → add to folder
                  // External file/URL drag → save + add to folder
                  // Folder-reorder drag → handleDrop (existing)
                  if (isSaveDrag(e) || isExternalImageDrag(e)) {
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
                <span className={styles.icon}>
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
            onDrop={async (e) => {
              if (!draggingId || isSaveDrag(e)) return;
              e.preventDefault();
              e.stopPropagation();
              const fromId = draggingId;
              handleDragEnd();
              // Tail dropzone always lands at top-level. If the
              // dragged folder is currently nested, promote it
              // first so the order-only reorder doesn't leave it
              // visually inside its old parent.
              const draggedItem = collections.find((c) => c.id === fromId);
              if (draggedItem?.parent_id) {
                try {
                  await window.moodmark.collections.setParent(fromId, null);
                } catch (err) {
                  console.error('[gatheros] tail-drop promote failed:', err);
                }
              }
              const ids = collections.map((c) => c.id).filter((id) => id !== fromId);
              ids.push(fromId);
              onReorderCollections?.(ids);
            }}
            aria-hidden="true"
          />
        )}
      </nav>

      <div className={styles.footer}>
        {(onOpenSettings || onOpenShortcuts || onOpenReleaseNotes) && (
          <button
            ref={helpBtnRef}
            type="button"
            className={[styles.footerBtn, helpOpen && styles.footerBtnActive].filter(Boolean).join(' ')}
            onClick={() => setHelpOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={helpOpen}
            title="Help, settings, and shortcuts"
            data-onboarding="settings"
          >
            <span className={styles.footerIcon}><HelpIcon /></span>
            <span className={styles.footerLabel}>Help</span>
            {releaseNotesUnseen && (
              <span className={styles.footerBadge} aria-label="New release notes available" />
            )}
          </button>
        )}
        <ThemeToggle className={styles.themeToggle} />

          {helpOpen && helpAnchor && ReactDOM.createPortal(
            <div
              ref={helpPopRef}
              className={styles.helpPopover}
              role="menu"
              // mousedown stopPropagation prevents the document-level
              // outside-click handler from racing the button's click
              // (some sequences fire the close-effect before the click
              // reaches the menu item, leaving the popover unmounted
              // before the action fires).
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                left: helpAnchor.left,
                bottom: window.innerHeight - helpAnchor.top + 4,
                width: helpAnchor.width,
              }}
            >
              {onOpenReleaseNotes && (
                <>
                  <div className={styles.helpGroupLabel}>Updates</div>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.helpItem}
                    onClick={helpAction(onOpenReleaseNotes)}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      helpAction(onOpenReleaseNotes)();
                    }}
                  >
                    <span className={styles.helpItemIcon}><MegaphoneIcon /></span>
                    <span className={styles.helpItemLabel}>What's New</span>
                    {releaseNotesUnseen && (
                      <span className={styles.helpItemDot} aria-hidden="true" />
                    )}
                  </button>
                </>
              )}

              {(onOpenSettings || onOpenShortcuts) && (
                <>
                  {onOpenReleaseNotes && <div className={styles.helpDivider} />}
                  <div className={styles.helpGroupLabel}>Essentials</div>
                  {onOpenSettings && (
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.helpItem}
                      onClick={helpAction(onOpenSettings)}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        helpAction(onOpenSettings)();
                      }}
                    >
                      <span className={styles.helpItemIcon}><SettingsGearIcon /></span>
                      <span className={styles.helpItemLabel}>Settings</span>
                    </button>
                  )}
                  {onOpenShortcuts && (
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.helpItem}
                      onClick={helpAction(onOpenShortcuts)}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        helpAction(onOpenShortcuts)();
                      }}
                    >
                      <span className={styles.helpItemIcon}><KeyboardIcon /></span>
                      <span className={styles.helpItemLabel}>Shortcuts</span>
                    </button>
                  )}
                </>
              )}
            </div>,
            document.body,
          )}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {boardCtx && (
        <ContextMenu
          x={boardCtx.x}
          y={boardCtx.y}
          items={boardCtxItems}
          onClose={() => setBoardCtx(null)}
        />
      )}
      {smartCtx && smartCtxItems.length > 0 && (
        <ContextMenu
          x={smartCtx.x}
          y={smartCtx.y}
          items={smartCtxItems}
          onClose={() => setSmartCtx(null)}
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
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </aside>
  );
}
