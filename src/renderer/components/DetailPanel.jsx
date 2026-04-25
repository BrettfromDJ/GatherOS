import React, { useEffect, useMemo, useState } from 'react';
import styles from './DetailPanel.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import ContextMenu from './ContextMenu.jsx';
import { CollectionIcon } from './Sidebar.jsx';

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
  onClose,
  onCollectionsChanged,
  onUpdateMeta,
}) {
  const src = fileUrl(record.file_path);
  const typeLabel = fileTypeLabel(record.file_path);
  const [copiedColor, setCopiedColor] = useState(null);

  const [nameDraft, setNameDraft] = useState(record.title || '');
  const [urlDraft, setUrlDraft] = useState(record.source_url || '');

  // Reset drafts whenever the user moves to a different record.
  useEffect(() => {
    setNameDraft(record.title || '');
    setUrlDraft(record.source_url || '');
  }, [record.id, record.title, record.source_url]);

  const persistedUrl = (record.source_url || '').trim();
  const canOpenUrl = /^https?:\/\//i.test(persistedUrl);

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
  const tagInputRef = React.useRef(null);

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

  async function commitTag({ keepOpen = false } = {}) {
    const name = tagDraft.trim();
    if (name) {
      await window.moodmark.tags.addToSave({ saveId: record.id, name });
      setTagDraft('');
      refreshTags();
    }
    if (keepOpen) focusTagInput();
  }

  async function removeTag(tagId) {
    await window.moodmark.tags.removeFromSave({ saveId: record.id, tagId });
    refreshTags();
  }

  function handleTagKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      // Commit the current tag and immediately reopen for the next one.
      e.preventDefault();
      commitTag({ keepOpen: true });
    } else if (e.key === 'Escape') {
      setTagDraft('');
      setAddingTag(false);
    } else if (e.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
      // Backspace on empty input removes the most recently added tag.
      removeTag(tags[tags.length - 1].id);
    }
  }

  function handleTagBlur() {
    // Commit any pending text on blur and exit adding mode.
    commitTag();
    setAddingTag(false);
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
        { type: 'header', label: 'Add to Collection' },
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
            placeholder="Untitled"
          />
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
            <button
              type="button"
              className={styles.openLinkBtn}
              disabled={!canOpenUrl}
              onClick={() => window.moodmark.shell.openUrl(persistedUrl)}
              title={canOpenUrl ? 'Open in browser' : 'Add a URL first'}
            >
              <ExternalLinkIcon />
            </button>
          </div>
        </label>
      </div>

      {palette.length > 0 && (
        <div className={styles.palette}>
          {palette.map((color) => (
            <button
              key={color}
              type="button"
              className={styles.swatch}
              style={{ background: color }}
              onClick={() => copyColor(color)}
              aria-label={`Copy ${color}`}
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
          Collections
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
                title="Remove from collection"
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
            <span className={styles.collectionsEmpty}>No collections yet</span>
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
            <input
              ref={tagInputRef}
              className={styles.tagInput}
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={handleTagBlur}
              placeholder="tag"
            />
          ) : (
            <button
              type="button"
              className={styles.addPillBtn}
              onClick={startAddingTag}
            >
              + Add
            </button>
          )}
        </div>
      </div>

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
