import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Info as InfoIcon, Eclipse as LayersIcon } from 'lucide-react';
import styles from './DetailPanelV2.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { resolveAsset } from '../lib/asset.js';
import ContextMenu from './ContextMenu.jsx';
import TagSuggestions from './TagSuggestions.jsx';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { findNearDuplicateTag } from '../lib/tagSimilarity.js';
import { CollectionIcon } from './Sidebar.jsx';
import { useEntitlementValue, isLocked, requestUpgrade } from '../context/entitlement.jsx';

const SUGGESTION_LIMIT = 6;

function SparkleIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M7 1l1.1 3 3 1.1-3 1.1L7 9.2 5.9 6.2 2.9 5.1l3-1.1z" />
      <path d="M11.5 8.5l0.55 1.5 1.45 0.55-1.45 0.55L11.5 12.6l-0.55-1.5L9.5 10.55l1.45-0.55z" opacity="0.7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="6.4" width="8" height="6" rx="1.2" />
      <path d="M4.8 6.4V4.5a2.2 2.2 0 0 1 4.4 0v1.9" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2.5 5h9M2.5 9h9M5.5 2l-1 10M9.5 2l-1 10" />
    </svg>
  );
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Friendly relative timestamp ("3h ago", "yesterday") — the absolute
// date is surfaced as a hover tooltip via formatAbsoluteDate.
function formatRelativeDate(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'just now';
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 2 * day) return 'yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return formatDate(ts);
}

function formatAbsoluteDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatBytes(n) {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function fileTypeLabel(filePath) {
  if (!filePath) return null;
  const ext = (filePath.split('.').pop() || '').toUpperCase();
  if (!ext) return null;
  return ext === 'JPG' ? 'JPEG' : ext;
}

// Permissive: accepts "x.com", "www.x.com", "https://x.com" — basically
// anything with a dot, no spaces, and a non-empty piece on each side.
function looksLikeUrl(input) {
  const s = (input || '').trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\/.+/i.test(s)) return true;
  return /^[^.\s][^\s]*\.[^\s.]+/i.test(s);
}

function normalizeUrl(input) {
  const s = (input || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 2h3.5v3.5" />
      <path d="M12 2L7 7" />
      <path d="M11.5 8.5V11.5a0.5 0.5 0 0 1 -0.5 0.5H3a0.5 0.5 0 0 1 -0.5 -0.5V3.5a0.5 0.5 0 0 1 0.5 -0.5H5.5" />
    </svg>
  );
}

export default function DetailPanel({
  record,
  allCollections = [],
  allTags = [],
  aiConfigured = false,
  aiIndexing = false,
  onClose,
  onCollectionsChanged,
  onTagsChanged,
  onUpdateMeta,
  onOpenSettings,
  onOpenSave,
  onGenerateVariant,
  onOpenSpace,
}) {
  // AI features (auto-tag, prompt generation, "more like this") are pro;
  // locked in the free tier. Fails open to unlocked.
  const proLocked = isLocked(useEntitlementValue());
  const src = fileUrl(record.file_path);
  const typeLabel = fileTypeLabel(record.file_path);
  const [copiedColor, setCopiedColor] = useState(null);
  const imageRef = useRef(null);
  const previewWrapRef = useRef(null);
  const [tilting, setTilting] = useState(false);

  // Mouse-driven 3D tilt on the detail thumbnail. Tracks the cursor
  // position over the preview area, normalises it to -0.5..0.5 from
  // the image's centre, and writes --tilt-x / --tilt-y CSS vars on
  // the wrap. CSS handles the rotateX/rotateY mapping; the .tilting
  // class swaps in a snappy transition for live tracking and the
  // default longer transition handles the spring-back on leave.
  const handleTiltMove = (e) => {
    const wrap = previewWrapRef.current;
    if (!wrap) return;
    if (!tilting) setTilting(true);
    const rect = wrap.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    const tiltY = nx * 18;  // rotateY follows horizontal mouse
    const tiltX = -ny * 14; // rotateX follows vertical (inverted)
    wrap.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`);
    wrap.style.setProperty('--tilt-y', `${tiltY.toFixed(2)}deg`);
  };

  const handleTiltLeave = () => {
    const wrap = previewWrapRef.current;
    if (!wrap) return;
    setTilting(false);
    wrap.style.setProperty('--tilt-x', '0deg');
    wrap.style.setProperty('--tilt-y', '0deg');
  };
  const [autoTagging, setAutoTagging] = useState(false);
  const [autoTagError, setAutoTagError] = useState('');
  const [promptGenerating, setPromptGenerating] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  // V2: secondary metadata (URL, Notes, Image Prompt) lives behind a
  // "More" toggle so the panel reads as scannable on open. Re-collapse
  // whenever the record changes so the next open starts compact too.
  const [showMore, setShowMore] = useState(false);

  const [nameDraft, setNameDraft] = useState(record.title || '');
  const [urlDraft, setUrlDraft] = useState(record.source_url || '');
  // Notes — a free-text field per save. Hidden behind a small
  // "+ Add note" link until it has content or the user opts in.
  const [notesDraft, setNotesDraft] = useState(record.notes || '');
  const [editingNotes, setEditingNotes] = useState(false);
  const notesRef = React.useRef(null);

  // Per-save metadata blob (JSON in DB). Lives behind tag-specific
  // sections — currently the "font" tag exposes name/designer/buy_url.
  const recordMeta = useMemo(() => {
    if (!record.meta) return {};
    try { return JSON.parse(record.meta) || {}; } catch { return {}; }
  }, [record.meta]);
  const fontMeta = recordMeta.font || {};
  const [fontNameDraft, setFontNameDraft] = useState(fontMeta.name || '');
  const [fontDesignerDraft, setFontDesignerDraft] = useState(fontMeta.designer || '');
  const [fontBuyUrlDraft, setFontBuyUrlDraft] = useState(fontMeta.buy_url || '');

  // Reset drafts whenever the user moves to a different record.
  useEffect(() => {
    setNameDraft(record.title || '');
    setUrlDraft(record.source_url || '');
    setNotesDraft(record.notes || '');
    setEditingNotes(false);
    setShowMore(false);
  }, [record.id, record.title, record.source_url, record.notes]);

  function commitNotes() {
    const next = notesDraft;
    if ((next || '') === (record.notes || '')) {
      // No change; if the user opened the editor on an empty note
      // and didn't type anything, collapse back to the link.
      if (!next) setEditingNotes(false);
      return;
    }
    onUpdateMeta?.(record.id, { notes: next.trim() ? next : null });
    if (!next.trim()) setEditingNotes(false);
  }

  useEffect(() => {
    setFontNameDraft(fontMeta.name || '');
    setFontDesignerDraft(fontMeta.designer || '');
    setFontBuyUrlDraft(fontMeta.buy_url || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, record.meta]);

  // Persist a font-meta change. Reads the latest record.meta, mutates
  // the `font` slot, stringifies, and ships through onUpdateMeta.
  function commitFontMeta(patch) {
    const merged = { ...recordMeta, font: { ...fontMeta, ...patch } };
    // If every font field is empty, drop the whole slot to keep the
    // JSON clean.
    if (!merged.font.name && !merged.font.designer && !merged.font.buy_url) {
      delete merged.font;
    }
    const out = Object.keys(merged).length ? JSON.stringify(merged) : null;
    onUpdateMeta?.(record.id, { meta: out });
  }

  const persistedUrl = (record.source_url || '').trim();
  const canOpenUrl = looksLikeUrl(persistedUrl);

  function commitName() {
    const next = nameDraft.trim();
    if (next === (record.title || '')) return;
    onUpdateMeta?.(record.id, { title: next || null });
  }

  function commitUrl() {
    const next = urlDraft.trim();
    if (next === (record.source_url || '')) return;
    onUpdateMeta?.(record.id, { sourceUrl: next || null });
  }

  const [memberships, setMemberships] = useState([]);
  const [picker, setPicker] = useState(null); // { x, y }

  // Spaces this save appears on (image items where data.saveId
  // matches). Loaded alongside collections / tags below.
  const [spaceMemberships, setSpaceMemberships] = useState([]);

  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const tagInputRef = React.useRef(null);

  const suggestions = useMemo(() => {
    const draft = tagDraft.trim().toLowerCase().replace(/^#+/, '');
    if (!draft) return [];
    const usedIds = new Set(tags.map((t) => t.id));
    // Fuzzy match across every existing tag, prefer existing over
    // creating new — the showCreateRow below only adds the "Create"
    // option when no existing tag matches exactly. Sort first by
    // fuzzy score (better = lower), then by save_count to surface
    // the more-used tag among equally-good matches.
    return allTags
      .filter((t) => !usedIds.has(t.id))
      .map((t) => ({ tag: t, match: fuzzyMatch(draft, t.name) }))
      .filter((x) => x.match)
      .sort((a, b) => {
        if (a.match.score !== b.match.score) return a.match.score - b.match.score;
        const cd = (b.tag.save_count || 0) - (a.tag.save_count || 0);
        if (cd !== 0) return cd;
        return a.tag.name.localeCompare(b.tag.name);
      })
      .slice(0, SUGGESTION_LIMIT)
      .map((x) => x.tag);
  }, [tagDraft, tags, allTags]);

  // "Create '<draft>'" row when the draft doesn't exactly match any
  // existing tag (used or unused). Fuzzy matches don't suppress the
  // Create option — the user might genuinely want a new tag whose
  // name resembles an existing one — but an exact-name hit does so
  // we don't offer to create a duplicate.
  const showCreateRow = useMemo(() => {
    const draft = tagDraft.trim().toLowerCase().replace(/^#+/, '');
    if (!draft) return false;
    const exists = allTags.some((t) => t.name.toLowerCase() === draft);
    return !exists;
  }, [tagDraft, allTags]);

  // Near-duplicate guard: when the draft isn't an exact existing tag but
  // looks like a plural/typo/separator variant of one ("gradients" when
  // "gradient" exists), surface that tag as a "merge" row so the user
  // can fold into the canonical tag instead of fragmenting. Only when a
  // Create row would otherwise show (no exact match) and the candidate
  // isn't already in the fuzzy list.
  const nearDuplicate = useMemo(() => {
    if (!showCreateRow) return null;
    const usedIds = new Set(tags.map((t) => t.id));
    const suggestedIds = new Set(suggestions.map((s) => s.id));
    const dup = findNearDuplicateTag(tagDraft, allTags, { excludeIds: usedIds });
    if (!dup || suggestedIds.has(dup.id)) return null;
    return dup;
  }, [showCreateRow, tagDraft, allTags, tags, suggestions]);

  // The list the popover actually renders: the merge row (if any) leads,
  // then the fuzzy suggestions. Indexing/commit run off this so keyboard
  // nav and Enter stay correct.
  const visibleSuggestions = useMemo(
    () => (nearDuplicate ? [{ ...nearDuplicate, __merge: true }, ...suggestions] : suggestions),
    [nearDuplicate, suggestions],
  );

  const totalSuggestionRows = visibleSuggestions.length + (showCreateRow ? 1 : 0);

  // Reset highlight whenever the suggestion list changes shape.
  useEffect(() => {
    setSuggestionIndex(0);
  }, [tagDraft]);

  // Reopen the suggestion popover whenever a fresh draft starts.
  useEffect(() => {
    if (tagDraft) setSuggestionsOpen(true);
  }, [tagDraft]);

  function startAddingTag() {
    setAddingTag(true);
    requestAnimationFrame(() => tagInputRef.current?.focus());
  }

  function focusTagInput() {
    requestAnimationFrame(() => tagInputRef.current?.focus());
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.moodmark.collections.getForSave(record.id),
      window.moodmark.tags.getForSave(record.id),
      window.moodmark.boards.getForSave(record.id),
    ]).then(([cols, tagRows, spaceRows]) => {
      if (cancelled) return;
      setMemberships(cols);
      setTags(tagRows);
      setSpaceMemberships(Array.isArray(spaceRows) ? spaceRows : []);
    });
    return () => { cancelled = true; };
  }, [record.id]);

  // "More like this" — pull the top-N visually similar saves from
  // the existing embeddings table. Anchored to the focused save's
  // id so it refetches when the user navigates to a different save
  // (j/k or by clicking another similar thumb). Skipped entirely
  // when AI isn't configured — embeddings won't be there.
  const [similar, setSimilar] = useState([]);
  useEffect(() => {
    if (!aiConfigured || proLocked) {
      setSimilar([]);
      return undefined;
    }
    let cancelled = false;
    window.moodmark.ai.similarSaves(record.id, 5).then((rows) => {
      if (!cancelled) setSimilar(rows || []);
    }).catch(() => {
      if (!cancelled) setSimilar([]);
    });
    return () => { cancelled = true; };
  }, [record.id, aiConfigured, proLocked]);

  async function refreshTags() {
    const rows = await window.moodmark.tags.getForSave(record.id);
    setTags(rows);
  }

  async function handleAutoTag() {
    if (autoTagging) return;
    if (proLocked) { requestUpgrade('ai'); return; }
    if (!aiConfigured) {
      onOpenSettings?.();
      return;
    }
    setAutoTagging(true);
    setAutoTagError('');
    try {
      const result = await window.moodmark.ai.autoTag(record.id);
      if (result?.ok) {
        refreshTags();
        onTagsChanged?.();
      } else {
        setAutoTagError(result?.detail || 'Could not generate tags');
        // Auto-clear error after a few seconds
        setTimeout(() => setAutoTagError(''), 3500);
      }
    } catch (err) {
      setAutoTagError(err.message || 'Could not generate tags');
      setTimeout(() => setAutoTagError(''), 3500);
    } finally {
      setAutoTagging(false);
    }
  }

  async function handleGeneratePrompt() {
    if (promptGenerating) return;
    if (proLocked) { requestUpgrade('ai'); return; }
    if (!aiConfigured) {
      onOpenSettings?.();
      return;
    }
    setPromptGenerating(true);
    setPromptError('');
    try {
      const result = await window.moodmark.ai.generatePrompt(record.id);
      if (!result?.ok) {
        setPromptError(result?.detail || 'Could not generate prompt');
        setTimeout(() => setPromptError(''), 3500);
      }
      // Successful path: save:updated event already patches record.ai_prompt.
    } catch (err) {
      setPromptError(err.message || 'Could not generate prompt');
      setTimeout(() => setPromptError(''), 3500);
    } finally {
      setPromptGenerating(false);
    }
  }

  async function handleCopyPrompt() {
    if (!record.ai_prompt) return;
    try {
      await navigator.clipboard.writeText(record.ai_prompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1400);
    } catch (err) {
      console.error('Copy prompt failed:', err);
    }
  }

  async function addTagByName(name, { keepOpen = false } = {}) {
    const trimmed = (name || '').trim();
    if (trimmed) {
      await window.moodmark.tags.addToSave({ saveId: record.id, name: trimmed });
      setTagDraft('');
      refreshTags();
      onTagsChanged?.();
    }
    if (keepOpen) focusTagInput();
  }

  async function commitTag({ keepOpen = false } = {}) {
    // Prefer the highlighted suggestion when the popover is open. This
    // includes the near-duplicate merge row (visibleSuggestions[0]), so
    // Enter on "gradients" folds into the existing "gradient".
    if (suggestionsOpen && suggestionIndex < visibleSuggestions.length && visibleSuggestions[suggestionIndex]) {
      await addTagByName(visibleSuggestions[suggestionIndex].name, { keepOpen });
      return;
    }
    await addTagByName(tagDraft, { keepOpen });
  }

  async function removeTag(tagId) {
    await window.moodmark.tags.removeFromSave({ saveId: record.id, tagId });
    refreshTags();
    onTagsChanged?.();
  }

  function handleTagKeyDown(e) {
    if (e.key === 'ArrowDown') {
      if (totalSuggestionRows > 0 && suggestionsOpen) {
        e.preventDefault();
        setSuggestionIndex((i) => (i + 1) % totalSuggestionRows);
      }
    } else if (e.key === 'ArrowUp') {
      if (totalSuggestionRows > 0 && suggestionsOpen) {
        e.preventDefault();
        setSuggestionIndex((i) => (i - 1 + totalSuggestionRows) % totalSuggestionRows);
      }
    } else if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      // Tab also commits, so the user can keep firing tags from the popover.
      if (e.key === 'Tab' && !tagDraft.trim()) return; // let Tab move focus normally
      e.preventDefault();
      commitTag({ keepOpen: true });
    } else if (e.key === 'Escape') {
      // First Escape collapses the suggestion list, second exits adding mode.
      if (suggestionsOpen && totalSuggestionRows > 0) {
        setSuggestionsOpen(false);
      } else {
        setTagDraft('');
        setAddingTag(false);
      }
    } else if (e.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
      // Backspace on empty input removes the most recently added tag.
      removeTag(tags[tags.length - 1].id);
    }
  }

  function handleTagBlur() {
    // Commit any pending text on blur and exit adding mode.
    addTagByName(tagDraft);
    setAddingTag(false);
  }

  function handleSuggestionPick(item) {
    // Mouse pick from the popover. item.name carries either an existing tag
    // name or the typed draft (for the synthetic "Create" row).
    addTagByName(item.name, { keepOpen: true });
  }

  async function refreshMemberships() {
    const rows = await window.moodmark.collections.getForSave(record.id);
    setMemberships(rows);
    onCollectionsChanged?.();
  }

  async function removeFromCollection(collectionId) {
    await window.moodmark.collections.removeSave({ collectionId, saveId: record.id });
    refreshMemberships();
  }

  async function addToCollection(collectionId) {
    await window.moodmark.collections.addSave({ collectionId, saveId: record.id });
    refreshMemberships();
  }

  const memberIds = new Set(memberships.map((c) => c.id));
  const availableToAdd = allCollections.filter((c) => !memberIds.has(c.id));

  function openPicker(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    setPicker({ x: rect.left, y: rect.bottom + 4 });
  }

  const pickerItems = availableToAdd.length > 0
    ? [
        { type: 'header', label: 'Add to collection' },
        ...availableToAdd.map((c) => ({
          label: c.name,
          onClick: () => addToCollection(c.id),
        })),
      ]
    : [];

  const palette = useMemo(() => {
    if (!record.palette) return [];
    try {
      const parsed = JSON.parse(record.palette);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [record.palette]);

  const copyColor = async (hex) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedColor(hex);
      setTimeout(() => setCopiedColor((c) => (c === hex ? null : c)), 1200);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  // File-info popover anchored to the (i) button in the header.
  // Replaces the inline metadata <dl> that used to live at the bottom
  // of the panel — the data wasn't earning the vertical space.
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoAnchor, setInfoAnchor] = useState(null);
  const infoBtnRef = useRef(null);
  const infoPopoverRef = useRef(null);

  useLayoutEffect(() => {
    if (!infoOpen || !infoBtnRef.current) return;
    const r = infoBtnRef.current.getBoundingClientRect();
    // Anchor below the button, right-aligned to its right edge so
    // the popover hangs into the panel from the header.
    setInfoAnchor({ top: r.bottom + 6, right: window.innerWidth - r.right });
  }, [infoOpen]);

  useEffect(() => {
    if (!infoOpen) return undefined;
    function onDown(e) {
      if (
        infoPopoverRef.current && !infoPopoverRef.current.contains(e.target) &&
        infoBtnRef.current && !infoBtnRef.current.contains(e.target)
      ) setInfoOpen(false);
    }
    function onEsc(e) { if (e.key === 'Escape') setInfoOpen(false); }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [infoOpen]);

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.headerLabel}>Details</span>
        <div className={styles.headerActions}>
          <button
            ref={infoBtnRef}
            type="button"
            className={`${styles.headerIconBtn} ${infoOpen ? styles.headerIconBtnActive : ''}`}
            onClick={() => setInfoOpen((v) => !v)}
            title="File info"
            aria-label="File info"
            aria-haspopup="dialog"
            aria-expanded={infoOpen}
          >
            <InfoIcon size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button className={styles.closeBtn} onClick={onClose} title="Close">
            ×
          </button>
        </div>
      </header>

      {infoOpen && infoAnchor && ReactDOM.createPortal(
        <div
          ref={infoPopoverRef}
          className={styles.infoPopover}
          role="dialog"
          aria-label="File info"
          style={{ top: infoAnchor.top, right: infoAnchor.right }}
        >
          <dl className={styles.infoList}>
            <dt>Saved</dt>
            <dd title={formatAbsoluteDate(record.created_at)}>
              {formatRelativeDate(record.created_at)}
            </dd>
            {record.width && record.height && (
              <>
                <dt>Dimensions</dt>
                <dd>{record.width} × {record.height}</dd>
              </>
            )}
            {record.file_size ? (
              <>
                <dt>Size</dt>
                <dd>{formatBytes(record.file_size)}</dd>
              </>
            ) : null}
          </dl>
        </div>,
        document.body,
      )}

      <div
        className={styles.preview}
        onMouseMove={handleTiltMove}
        onMouseLeave={handleTiltLeave}
      >
        {src && (
          <div
            ref={previewWrapRef}
            className={[
              styles.imageWrap,
              tilting && styles.imageWrapTilting,
            ].filter(Boolean).join(' ')}
          >
            <img
              ref={imageRef}
              src={src}
              className={styles.image}
              alt={record.title || ''}
              draggable={false}
            />
            {typeLabel && <div className={styles.typeBadge}>{typeLabel}</div>}
          </div>
        )}
        {palette.length > 0 && (
          <div className={styles.palette}>
            {palette.map((color) => (
              <button
                key={color}
                type="button"
                className={styles.swatch}
                style={{ background: color }}
                onClick={() => copyColor(color)}
                title={`Copy ${color.toUpperCase()}`}
                aria-label={`Copy ${color}`}
              >
                {copiedColor === color && (
                  <span className={styles.swatchTooltip}>Copied {color.toUpperCase()}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Primary actions row — Generate variation is the single AI
          CTA that warrants always-visible weight. Auto-tag stays in
          its contextual home next to Tags. */}
      {aiConfigured && onGenerateVariant && (
        <div className={styles.actionsRow}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => onGenerateVariant(record.id)}
            title="Generate a fresh variation of this image"
          >
            <span className={styles.actionBtnIcon}><SparkleIcon /></span>
            Generate variation
          </button>
        </div>
      )}

      {/* Name — primary identity, always visible. */}
      <div className={styles.metaEditSection}>
        <label className={styles.metaField}>
          <span className={styles.metaFieldLabel}>Name</span>
          <div className={styles.metaInputRow}>
            <input
              className={styles.metaInput}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setNameDraft(record.title || '');
                  e.currentTarget.blur();
                }
              }}
              placeholder={aiIndexing ? '' : 'Untitled'}
            />
            {aiIndexing && (
              <span
                className={styles.loadingDots}
                aria-label="Generating name with AI"
                role="status"
              >
                <span /><span /><span />
              </span>
            )}
          </div>
        </label>
      </div>

      <div className={styles.collectionsSection}>
        <div className={styles.collectionsLabel}>
          <span className={styles.sectionLabelIcon}><CollectionIcon /></span>
          Collections
        </div>
        <div className={styles.collectionPills}>
          {availableToAdd.length > 0 && (
            <button
              type="button"
              className={styles.addPillBtn}
              onClick={openPicker}
            >
              + Add
            </button>
          )}
          {memberships.map((c) => (
            <span key={c.id} className={styles.collectionPill}>
              <span className={styles.collectionPillIcon}>
                <CollectionIcon />
              </span>
              <span className={styles.collectionPillName}>{c.name}</span>
              <button
                type="button"
                className={styles.collectionPillRemove}
                onClick={() => removeFromCollection(c.id)}
                title="Remove from collection"
              >
                ×
              </button>
            </span>
          ))}
          {memberships.length === 0 && availableToAdd.length === 0 && (
            <span className={styles.collectionsEmpty}>No collections yet</span>
          )}
        </div>
      </div>

      {spaceMemberships.length > 0 && (
        <div className={styles.spacesSection}>
          <div className={styles.spacesLabel}>
            <span className={styles.sectionLabelIcon}>
              <LayersIcon size={14} strokeWidth={1.7} aria-hidden="true" />
            </span>
            Spaces
          </div>
          <div className={styles.spacePills}>
            {spaceMemberships.map((b) => (
              <button
                key={b.id}
                type="button"
                className={styles.spacePill}
                onClick={() => onOpenSpace?.(b.id)}
                title={`Open “${b.name}”`}
              >
                <span className={styles.spacePillIcon}>
                  <LayersIcon size={12} strokeWidth={1.7} aria-hidden="true" />
                </span>
                <span className={styles.spacePillName}>{b.name || 'Untitled space'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.tagsSection}>
        <div className={styles.tagsLabel}>
          <span className={styles.sectionLabelIcon}><TagIcon /></span>
          Tags
        </div>
        <div className={styles.tagPills}>
          {addingTag ? (
            <span className={styles.tagInputAnchor}>
              <input
                ref={tagInputRef}
                className={styles.tagInput}
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={handleTagBlur}
                placeholder="tag"
              />
              {suggestionsOpen && (
                <TagSuggestions
                  suggestions={visibleSuggestions}
                  activeIndex={suggestionIndex}
                  showCreateRow={showCreateRow}
                  draft={tagDraft.trim()}
                  onPick={handleSuggestionPick}
                  onHoverIndex={setSuggestionIndex}
                />
              )}
            </span>
          ) : (
            <button
              type="button"
              className={styles.addPillBtn}
              onClick={startAddingTag}
            >
              + Add
            </button>
          )}
          {tags.map((t) => (
            <span key={t.id} className={styles.tagPill}>
              <span className={styles.tagHash}>#</span>
              <span className={styles.tagName}>{t.name}</span>
              <button
                type="button"
                className={styles.tagRemove}
                onClick={() => removeTag(t.id)}
                title="Remove tag"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className={[styles.autoTagBtn, autoTagging && styles.autoTagBtnLoading].filter(Boolean).join(' ')}
            onClick={handleAutoTag}
            disabled={autoTagging}
            title={aiConfigured ? 'Auto-tag with AI' : 'Configure OpenAI key to enable'}
          >
            <span className={styles.autoTagIcon}>
              {aiConfigured ? <SparkleIcon /> : <LockIcon />}
            </span>
            {autoTagging ? 'Tagging…' : 'Auto-tag'}
          </button>
        </div>
        {autoTagError && (
          <div className={styles.autoTagError}>{autoTagError}</div>
        )}
      </div>

      {/* Secondary metadata — URL, Note, Image Prompt. Hidden by
          default; one toggle expands the whole block. URL and Note
          stay accessible without competing with the primary fields
          for new users. */}
      <div className={styles.moreSection}>
        <button
          type="button"
          className={styles.moreToggle}
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
        >
          {showMore ? '− Less' : '+ More details'}
        </button>
        {showMore && (
          <div className={styles.moreBody}>
            <label className={styles.metaField}>
              <span className={styles.metaFieldLabel}>URL</span>
              <div className={styles.metaInputRow}>
                <input
                  className={styles.metaInput}
                  type="url"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onBlur={commitUrl}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      setUrlDraft(record.source_url || '');
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="https://…"
                />
                {canOpenUrl && (
                  <button
                    type="button"
                    className={styles.openLinkBtn}
                    onClick={() => window.moodmark.shell.openUrl(normalizeUrl(persistedUrl))}
                    title="Open in browser"
                  >
                    <ExternalLinkIcon />
                  </button>
                )}
              </div>
            </label>

            {(editingNotes || notesDraft) ? (
              <label className={styles.metaField}>
                <span className={styles.metaFieldLabel}>Note</span>
                <textarea
                  ref={notesRef}
                  className={styles.notesInput}
                  value={notesDraft}
                  placeholder="Add a note…"
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={commitNotes}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (e.shiftKey) {
                        e.stopPropagation();
                        return;
                      }
                      e.preventDefault();
                      e.currentTarget.blur();
                      return;
                    }
                    if (e.key === 'Escape') {
                      setNotesDraft(record.notes || '');
                      setEditingNotes(false);
                      e.currentTarget.blur();
                    }
                  }}
                  rows={1}
                />
              </label>
            ) : (
              <button
                type="button"
                className={styles.addNoteBtn}
                onClick={() => {
                  setEditingNotes(true);
                  requestAnimationFrame(() => notesRef.current?.focus());
                }}
              >
                + Add a note
              </button>
            )}

            <div className={styles.promptSection}>
              <div className={styles.promptHeader}>
                <span className={styles.sectionLabelIcon}><SparkleIcon /></span>
                <span className={styles.promptLabel}>Image Prompt</span>
                {record.ai_prompt && (
                  <div className={styles.promptHeaderActions}>
                    <button
                      type="button"
                      className={styles.promptIconBtn}
                      onClick={handleCopyPrompt}
                      title="Copy prompt"
                    >
                      {promptCopied ? '✓' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      className={styles.promptIconBtn}
                      onClick={handleGeneratePrompt}
                      disabled={promptGenerating}
                      title="Regenerate"
                    >
                      ↻
                    </button>
                  </div>
                )}
              </div>
              {record.ai_prompt ? (
                <div className={styles.promptBody}>{record.ai_prompt}</div>
              ) : (
                <button
                  type="button"
                  className={[
                    styles.autoTagBtn,
                    promptGenerating && styles.autoTagBtnLoading,
                  ].filter(Boolean).join(' ')}
                  onClick={handleGeneratePrompt}
                  disabled={promptGenerating}
                  title={aiConfigured ? 'Generate an image-generation prompt' : 'Configure OpenAI key to enable'}
                >
                  <span className={styles.autoTagIcon}>
                    {aiConfigured ? <SparkleIcon /> : <LockIcon />}
                  </span>
                  {promptGenerating ? 'Generating…' : 'Generate prompt'}
                </button>
              )}
              {promptError && (
                <div className={styles.autoTagError}>{promptError}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {tags.some((t) => t.name === 'font') && (
        <div className={styles.fontSection}>
          <div className={styles.fontSectionLabel}>
            <span>Font</span>
            <button
              type="button"
              className={styles.fontSectionRemove}
              onClick={() => {
                // Wipe the font slot from meta…
                const merged = { ...recordMeta };
                delete merged.font;
                const out = Object.keys(merged).length ? JSON.stringify(merged) : null;
                onUpdateMeta?.(record.id, { meta: out });
                // …and drop the tag so the section disappears.
                const fontTag = tags.find((t) => t.name === 'font');
                if (fontTag) removeTag(fontTag.id);
              }}
              title="Remove font section"
              aria-label="Remove font section"
            >
              ×
            </button>
          </div>
          <label className={styles.fontField}>
            <span className={styles.fontFieldLabel}>Name</span>
            <input
              type="text"
              className={styles.fontInput}
              value={fontNameDraft}
              onChange={(e) => setFontNameDraft(e.target.value)}
              onBlur={() => {
                if ((fontNameDraft || '') !== (fontMeta.name || '')) {
                  commitFontMeta({ name: fontNameDraft.trim() || undefined });
                }
              }}
              placeholder="e.g. Söhne Buch"
            />
          </label>
          <label className={styles.fontField}>
            <span className={styles.fontFieldLabel}>Designer / Foundry</span>
            <input
              type="text"
              className={styles.fontInput}
              value={fontDesignerDraft}
              onChange={(e) => setFontDesignerDraft(e.target.value)}
              onBlur={() => {
                if ((fontDesignerDraft || '') !== (fontMeta.designer || '')) {
                  commitFontMeta({ designer: fontDesignerDraft.trim() || undefined });
                }
              }}
              placeholder="e.g. Klim Type Foundry"
            />
          </label>
          <label className={styles.fontField}>
            <span className={styles.fontFieldLabel}>Buy URL</span>
            <div className={styles.fontUrlRow}>
              <input
                type="text"
                className={styles.fontInput}
                value={fontBuyUrlDraft}
                onChange={(e) => setFontBuyUrlDraft(e.target.value)}
                onBlur={() => {
                  if ((fontBuyUrlDraft || '') !== (fontMeta.buy_url || '')) {
                    commitFontMeta({ buy_url: fontBuyUrlDraft.trim() || undefined });
                  }
                }}
                placeholder="https://…"
              />
              {looksLikeUrl(fontBuyUrlDraft.trim()) && (
                <button
                  type="button"
                  className={styles.fontOpenBtn}
                  onClick={() => window.moodmark.shell.openUrl(fontBuyUrlDraft.trim())}
                  title="Open buy URL"
                >
                  Open ↗
                </button>
              )}
            </div>
          </label>
        </div>
      )}

      {similar.length > 0 && (
        <div className={styles.similarSection}>
          <div className={styles.similarLabel}>
            <span className={styles.sectionLabelIcon}><SparkleIcon /></span>
            <span>More like this</span>
          </div>
          <div className={styles.similarGrid}>
            {similar.map((s) => (
              <button
                key={s.id}
                type="button"
                className={styles.similarTile}
                onClick={() => onOpenSave?.(s.id)}
                title={s.title || ''}
              >
                <img
                  src={resolveAsset(s, 'thumb')}
                  alt=""
                  draggable={false}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {picker && (
        <ContextMenu
          x={picker.x}
          y={picker.y}
          items={pickerItems}
          onClose={() => setPicker(null)}
        />
      )}
    </aside>
  );
}
