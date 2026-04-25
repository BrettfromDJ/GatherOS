import React, { useEffect, useMemo, useState } from 'react';
import styles from './DetailPanel.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import ContextMenu from './ContextMenu.jsx';
import { CollectionIcon } from './Sidebar.jsx';

function StarIcon({ filled }) {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 14 14"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="7,1.5 8.7,5.3 12.8,5.7 9.7,8.4 10.6,12.5 7,10.4 3.4,12.5 4.3,8.4 1.2,5.7 5.3,5.3" />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg
      className={styles.icon}
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

function ExportIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 1.5v7.5" />
      <path d="M4 4.5L7 1.5 10 4.5" />
      <path d="M2.5 9v2.5a0.5 0.5 0 0 0 0.5 0.5h8a0.5 0.5 0 0 0 0.5 -0.5V9" />
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

function TrashIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 3.5h10" />
      <path d="M5 3.5V2.25a0.75 0.75 0 0 1 0.75 -0.75h2.5a0.75 0.75 0 0 1 0.75 0.75V3.5" />
      <path d="M3.25 3.5v8.25a0.75 0.75 0 0 0 0.75 0.75h6a0.75 0.75 0 0 0 0.75 -0.75V3.5" />
      <path d="M5.75 6v4M8.25 6v4" />
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

function defaultExportName(record) {
  const ext = (record.file_path.split('.').pop() || 'png').toLowerCase();
  if (record.title) return `${record.title}.${ext}`;
  return `moodmark-${record.id.slice(0, 8)}.${ext}`;
}

function fileTypeLabel(filePath) {
  if (!filePath) return null;
  const ext = (filePath.split('.').pop() || '').toUpperCase();
  if (!ext) return null;
  return ext === 'JPG' ? 'JPEG' : ext;
}

export default function DetailPanel({
  record,
  allCollections = [],
  onClose,
  onToggleFavorite,
  onDelete,
  onOpenInPreview,
  onCollectionsChanged,
}) {
  const src = fileUrl(record.file_path);
  const favorited = !!record.favorited;
  const typeLabel = fileTypeLabel(record.file_path);
  const [copiedColor, setCopiedColor] = useState(null);

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

  const handleExport = () => {
    window.moodmark.image.export(record.file_path, defaultExportName(record));
  };

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
        {record.title && (
          <>
            <dt>Title</dt>
            <dd>{record.title}</dd>
          </>
        )}
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

      <div className={styles.actions}>
        <button
          className={`${styles.actionBtn} ${favorited ? styles.active : ''}`}
          onClick={() => onToggleFavorite(record.id, !favorited)}
        >
          <StarIcon filled={favorited} />
          <span>{favorited ? 'Favorited' : 'Favorite'}</span>
        </button>
        <button
          className={styles.actionBtn}
          onClick={() => onOpenInPreview(record.file_path)}
        >
          <PreviewIcon />
          <span>Open in Preview</span>
        </button>
        <button className={styles.actionBtn} onClick={handleExport}>
          <ExportIcon />
          <span>Export…</span>
        </button>
        <button
          className={`${styles.actionBtn} ${styles.danger}`}
          onClick={() => onDelete(record.id)}
        >
          <TrashIcon />
          <span>Delete</span>
        </button>
      </div>

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
