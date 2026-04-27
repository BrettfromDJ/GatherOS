import React, { useEffect, useMemo, useState } from 'react';
import styles from './DetailPanel.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import ContextMenu from './ContextMenu.jsx';
import TagSuggestions from './TagSuggestions.jsx';
import { CollectionIcon } from './Sidebar.jsx';

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
  onColorFilter,
}) {
  const src = fileUrl(record.file_path);
  const typeLabel = fileTypeLabel(record.file_path);
  const [copiedColor, setCopiedColor] = useState(null);
  const [autoTagging, setAutoTagging] = useState(false);
  const [autoTagError, setAutoTagError] = useState('');
  const [promptGenerating, setPromptGenerating] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

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

  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const tagInputRef = React.useRef(null);

  const suggestions = useMemo(() => {
    const draft = tagDraft.trim().toLowerCase();
    if (!draft) return [];
    const usedIds = new Set(tags.map((t) => t.id));
    return allTags
      .filter((t) => !usedIds.has(t.id) && t.name.toLowerCase().startsWith(draft))
      .sort((a, b) => (b.save_count || 0) - (a.save_count || 0) || a.name.localeCompare(b.name))
      .slice(0, SUGGESTION_LIMIT);
  }, [tagDraft, tags, allTags]);

  // "Create '<draft>'" row when the draft doesn't exactly match any
  // existing tag (used or unused). Keeps free-typing a clear path.
  const showCreateRow = useMemo(() => {
    const draft = tagDraft.trim().toLowerCase();
    if (!draft) return false;
    const exists = allTags.some((t) => t.name.toLowerCase() === draft);
    return !exists;
  }, [tagDraft, allTags]);

  const totalSuggestionRows = suggestions.length + (showCreateRow ? 1 : 0);

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
    ]).then(([cols, tagRows]) => {
      if (cancelled) return;
      setMemberships(cols);
      setTags(tagRows);
    });
    return () => { cancelled = true; };
  }, [record.id]);

  async function refreshTags() {
    const rows = await window.moodmark.tags.getForSave(record.id);
    setTags(rows);
  }

  async function handleAutoTag() {
    if (autoTagging) return;
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
    // Prefer the highlighted suggestion when the popover is open.
    if (suggestionsOpen && suggestionIndex < suggestions.length && suggestions[suggestionIndex]) {
      await addTagByName(suggestions[suggestionIndex].name, { keepOpen });
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
        { type: 'header', label: 'Add to Bucket' },
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

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.headerLabel}>Details</span>
        <button className={styles.closeBtn} onClick={onClose} title="Close">
          ×
        </button>
      </header>

      <div className={styles.preview}>
        {src && (
          <div className={styles.imageWrap}>
            <img
              src={src}
              className={styles.image}
              alt={record.title || ''}
              draggable={false}
            />
            {typeLabel && <div className={styles.typeBadge}>{typeLabel}</div>}
          </div>
        )}
      </div>

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
      </div>

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

      {palette.length > 0 && (
        <div className={styles.palette}>
          {palette.map((color) => (
            <button
              key={color}
              type="button"
              className={styles.swatch}
              style={{ background: color }}
              onClick={(e) => {
                // Option/Alt-click copies the hex; plain click filters
                // the grid by visually-similar palettes.
                if (e.altKey) copyColor(color);
                else onColorFilter?.(color);
              }}
              title={`Filter by ${color.toUpperCase()} · ⌥-click to copy hex`}
              aria-label={`Filter by ${color}, option-click to copy hex`}
            >
              {copiedColor === color && (
                <span className={styles.swatchTooltip}>Copied {color.toUpperCase()}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className={styles.collectionsSection}>
        <div className={styles.collectionsLabel}>
          <span className={styles.sectionLabelIcon}><CollectionIcon /></span>
          Buckets
        </div>
        <div className={styles.collectionPills}>
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
                title="Remove from bucket"
              >
                ×
              </button>
            </span>
          ))}
          {availableToAdd.length > 0 && (
            <button
              type="button"
              className={styles.addPillBtn}
              onClick={openPicker}
            >
              + Add
            </button>
          )}
          {memberships.length === 0 && availableToAdd.length === 0 && (
            <span className={styles.collectionsEmpty}>No buckets yet</span>
          )}
        </div>
      </div>

      <div className={styles.tagsSection}>
        <div className={styles.tagsLabel}>
          <span className={styles.sectionLabelIcon}><TagIcon /></span>
          Tags
        </div>
        <div className={styles.tagPills}>
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
                  suggestions={suggestions}
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

      <dl className={styles.meta}>
        <dt>Saved</dt>
        <dd>{formatDate(record.created_at)}</dd>
        {record.width && record.height && (
          <>
            <dt>Dimensions</dt>
            <dd>
              {record.width} × {record.height}
            </dd>
          </>
        )}
        {record.file_size ? (
          <>
            <dt>Size</dt>
            <dd>{formatBytes(record.file_size)}</dd>
          </>
        ) : null}
      </dl>

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
