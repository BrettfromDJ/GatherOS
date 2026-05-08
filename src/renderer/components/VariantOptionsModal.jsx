import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Sparkles, X } from 'lucide-react';
import styles from './VariantOptionsModal.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Default prompt is short and editable — gives the user a sensible
// starting point ("keep the bones") that they can extend ("…and add
// neon highlights" / "…as watercolor"). The source image carries
// most of the visual information through /v1/images/edits, so the
// prompt is mostly intent.
const DEFAULT_PROMPT =
  'Create a fresh variation of this image. Keep the composition and palette.';

const SIZES = [
  { value: '1024x1024', label: 'Square', aspect: '1:1', tile: { w: 36, h: 36 } },
  { value: '1536x1024', label: 'Wide',   aspect: '3:2', tile: { w: 48, h: 32 } },
  { value: '1024x1536', label: 'Tall',   aspect: '2:3', tile: { w: 32, h: 48 } },
];

export default function VariantOptionsModal({ open, record, onCancel, onConfirm }) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [size, setSize] = useState('1024x1024');
  const promptRef = useRef(null);

  // Reset draft state every time the modal opens for a new save so
  // the user always starts from the default prompt + square. Avoids
  // surprise "I edited this for a different image" carry-over.
  useEffect(() => {
    if (open) {
      setPrompt(DEFAULT_PROMPT);
      setSize('1024x1024');
      // Focus + select-all so a quick edit (overwrite the default
      // entirely) is one keystroke away.
      requestAnimationFrame(() => {
        const el = promptRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      });
    }
  }, [open]);

  // Esc closes; Cmd/Ctrl-Enter submits. Mounted at the document
  // level so the textarea doesn't have to re-implement either.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        confirm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prompt, size]);

  function confirm() {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onConfirm?.({ prompt: trimmed, size });
  }

  if (!open || !record) return null;

  return ReactDOM.createPortal(
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Generate variation">
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onCancel}
          aria-label="Close"
        >
          <X size={16} strokeWidth={1.6} />
        </button>

        <div className={styles.header}>
          <span className={styles.headerIcon}>
            <Sparkles size={14} strokeWidth={1.6} />
          </span>
          <span className={styles.headerLabel}>Generate variation</span>
        </div>

        <div className={styles.preview}>
          <img
            className={styles.previewImg}
            src={fileUrl(record.thumb_path || record.file_path)}
            alt=""
            draggable={false}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="variant-prompt" className={styles.fieldLabel}>
            Prompt
          </label>
          <textarea
            id="variant-prompt"
            ref={promptRef}
            className={styles.promptInput}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Describe the variation you want…"
          />
          <div className={styles.fieldHint}>
            ⌘+Enter to generate · Esc to cancel
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Aspect</span>
          <div className={styles.aspectRow} role="radiogroup" aria-label="Aspect ratio">
            {SIZES.map((opt) => {
              const active = size === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`${styles.aspectBtn} ${active ? styles.aspectBtnActive : ''}`}
                  onClick={() => setSize(opt.value)}
                >
                  <span
                    className={styles.aspectTile}
                    style={{ width: opt.tile.w, height: opt.tile.h }}
                    aria-hidden="true"
                  />
                  <span className={styles.aspectLabel}>{opt.label}</span>
                  <span className={styles.aspectMeta}>{opt.aspect}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={confirm}
            disabled={!prompt.trim()}
          >
            Generate
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
