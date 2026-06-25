import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from './BulkTagPicker.module.css';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { findNearDuplicateTag } from '../lib/tagSimilarity.js';

// Compact popover for tagging the multi-selected saves in one shot.
// Renders above the selection bar at a caller-supplied anchor point
// and is portaled-equivalent (fixed-positioned). Behaviour:
//   - empty input: shows the top 8 most-used tags
//   - typed: fuzzy-matched against existing tags, sorted by match
//     score then save_count
//   - Enter applies the active row; Escape closes
//   - "Create #foo" appears when the typed value doesn't exact-match
//     an existing tag
//
// onApply(name) is called with the cleaned tag name; the parent runs
// the actual writes against every selected save.
export default function BulkTagPicker({ anchor, allTags, count, onApply, onClose }) {
  const [draft, setDraft] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on outside click. setTimeout 0 so the click that opened
  // the popover (still bubbling) doesn't immediately re-close it.
  useEffect(() => {
    function onMouseDown(e) {
      if (!e.target.closest('[data-bulk-tag-picker]')) onClose();
    }
    const t = setTimeout(() => window.addEventListener('mousedown', onMouseDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [onClose]);

  const cleanedDraft = draft.trim().toLowerCase().replace(/^#+/, '');

  const suggestions = useMemo(() => {
    if (!cleanedDraft) {
      return [...allTags]
        .sort((a, b) => (b.save_count || 0) - (a.save_count || 0) || a.name.localeCompare(b.name))
        .slice(0, 8);
    }
    return allTags
      .map((t) => ({ tag: t, match: fuzzyMatch(cleanedDraft, t.name) }))
      .filter((x) => x.match)
      .sort((a, b) => {
        if (a.match.score !== b.match.score) return a.match.score - b.match.score;
        const cd = (b.tag.save_count || 0) - (a.tag.save_count || 0);
        if (cd !== 0) return cd;
        return a.tag.name.localeCompare(b.tag.name);
      })
      .slice(0, 8)
      .map((x) => x.tag);
  }, [cleanedDraft, allTags]);

  const showCreate = !!cleanedDraft
    && !allTags.some((t) => t.name.toLowerCase() === cleanedDraft);

  // Near-duplicate guard: offer to merge into an existing tag when the
  // draft is a plural/typo/separator variant of one ("gradients" →
  // "gradient"), so bulk-tagging doesn't fragment the vocabulary.
  const nearDuplicate = useMemo(() => {
    if (!showCreate) return null;
    const suggestedIds = new Set(suggestions.map((s) => s.id));
    const dup = findNearDuplicateTag(cleanedDraft, allTags);
    if (!dup || suggestedIds.has(dup.id)) return null;
    return dup;
  }, [showCreate, cleanedDraft, allTags, suggestions]);

  const visibleSuggestions = useMemo(
    () => (nearDuplicate ? [{ ...nearDuplicate, __merge: true }, ...suggestions] : suggestions),
    [nearDuplicate, suggestions],
  );

  const totalRows = visibleSuggestions.length + (showCreate ? 1 : 0);

  function commit(name) {
    const cleaned = (name || '').trim().toLowerCase().replace(/^#+/, '');
    if (!cleaned) return;
    onApply(cleaned);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(totalRows - 1, 0)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex < visibleSuggestions.length && visibleSuggestions[activeIndex]) {
        commit(visibleSuggestions[activeIndex].name);
      } else if (showCreate) {
        commit(cleanedDraft);
      }
    }
  }

  return (
    <div
      data-bulk-tag-picker
      className={styles.popover}
      style={{ left: anchor.x, top: anchor.y }}
      role="dialog"
      aria-label="Bulk tag"
    >
      <input
        ref={inputRef}
        className={styles.input}
        placeholder={`Tag ${count} ${count === 1 ? 'save' : 'saves'}…`}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setActiveIndex(0); }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      <div className={styles.list} role="listbox">
        {visibleSuggestions.map((tag, i) => (
          <button
            key={tag.id}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            className={`${styles.item} ${tag.__merge ? styles.mergeItem : ''} ${i === activeIndex ? styles.itemActive : ''}`}
            title={tag.__merge
              ? `“${cleanedDraft}” looks like a duplicate — use the existing #${tag.name}`
              : undefined}
            onMouseDown={(e) => { e.preventDefault(); commit(tag.name); }}
            onMouseEnter={() => setActiveIndex(i)}
          >
            {tag.__merge && <span className={styles.mergeBadge}>Similar</span>}
            <span className={styles.hash}>#</span>
            <span className={styles.name}>{tag.name}</span>
            {tag.__merge
              ? <span className={styles.mergeNote}>merge “{cleanedDraft}”</span>
              : tag.save_count > 0 && (
                <span className={styles.count}>{tag.save_count}</span>
              )}
          </button>
        ))}
        {showCreate && (
          <button
            type="button"
            role="option"
            aria-selected={activeIndex === visibleSuggestions.length}
            className={`${styles.item} ${styles.createItem} ${activeIndex === visibleSuggestions.length ? styles.itemActive : ''}`}
            onMouseDown={(e) => { e.preventDefault(); commit(cleanedDraft); }}
            onMouseEnter={() => setActiveIndex(visibleSuggestions.length)}
          >
            <span className={styles.createLabel}>Create</span>
            <span className={styles.hash}>#</span>
            <span className={styles.name}>{cleanedDraft}</span>
          </button>
        )}
        {suggestions.length === 0 && !showCreate && (
          <div className={styles.empty}>Type to create a tag</div>
        )}
      </div>
    </div>
  );
}
