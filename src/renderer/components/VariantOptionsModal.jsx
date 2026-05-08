import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Sparkles, X, Check, ChevronDown } from 'lucide-react';
import styles from './VariantOptionsModal.module.css';
import { fileUrl } from '../lib/fileUrl.js';

// Default prompt is short and editable — gives the user a sensible
// starting point that they can extend ("…and add neon highlights" /
// "…as watercolor"). The source image carries most of the visual
// information through /v1/images/edits, so the prompt is mostly
// intent.
const DEFAULT_PROMPT =
  'Create a fresh variation of this image. Keep the composition and palette.';

// Aspect picker mirrors ChatGPT's image-generation menu: a single
// dropdown with named ratios + a small proportional preview tile.
// gpt-image-1 only natively supports 1024x1024 / 1536x1024 /
// 1024x1536 / 'auto', so the non-native aspects (3:4, 9:16, 4:3,
// 16:9) generate at the closest native size and the main process
// crops the result to the requested ratio before saving.
const ASPECTS = [
  { id: 'auto',       label: 'Auto',       ratio: null,   tile: { w: 16, h: 12 } },
  { id: '1:1',        label: 'Square',     ratio: '1:1',  tile: { w: 14, h: 14 } },
  { id: '3:4',        label: 'Portrait',   ratio: '3:4',  tile: { w: 12, h: 16 } },
  { id: '9:16',       label: 'Story',      ratio: '9:16', tile: { w: 9,  h: 16 } },
  { id: '4:3',        label: 'Landscape',  ratio: '4:3',  tile: { w: 16, h: 12 } },
  { id: '16:9',       label: 'Widescreen', ratio: '16:9', tile: { w: 16, h: 9  } },
];

function findAspect(id) {
  return ASPECTS.find((a) => a.id === id) || ASPECTS[0];
}

export default function VariantOptionsModal({ open, record, onCancel, onConfirm }) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [aspectId, setAspectId] = useState('auto');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const promptRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Reset draft state every time the modal opens for a new save so
  // the user always starts from the default prompt + Auto aspect.
  // Avoids surprise "I edited this for a different image" carry-over.
  useEffect(() => {
    if (open) {
      setPrompt(DEFAULT_PROMPT);
      setAspectId('auto');
      setMenuOpen(false);
      requestAnimationFrame(() => {
        const el = promptRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      });
    }
  }, [open]);

  // Esc closes the menu first, then the modal. Cmd/Ctrl-Enter submits.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (menuOpen) setMenuOpen(false);
        else onCancel?.();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        confirm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prompt, aspectId, menuOpen]);

  // Close the aspect menu on outside click.
  useEffect(() => {
    if (!menuOpen) return undefined;
    function onClick(e) {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        setMenuOpen(false);
      }
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  // Portal the menu to document.body so it escapes the modal's
  // overflow:auto clipping. Re-measure the trigger on open and on
  // any scroll inside the modal so the menu stays anchored.
  useEffect(() => {
    if (!menuOpen) return undefined;
    function update() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMenuRect({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [menuOpen]);

  function confirm() {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onConfirm?.({ prompt: trimmed, aspect: aspectId });
  }

  if (!open || !record) return null;

  const current = findAspect(aspectId);

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
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Aspect ratio</span>
          <div className={styles.aspectWrap}>
            <button
              ref={triggerRef}
              type="button"
              className={styles.aspectTrigger}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
            >
              <span
                className={styles.aspectTile}
                style={{ width: current.tile.w, height: current.tile.h }}
                aria-hidden="true"
              />
              <span className={styles.aspectTriggerLabel}>{current.label}</span>
              {current.ratio && (
                <span className={styles.aspectTriggerMeta}>{current.ratio}</span>
              )}
              <span className={styles.aspectChevron} aria-hidden="true">
                <ChevronDown size={14} strokeWidth={1.8} />
              </span>
            </button>

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

      {menuOpen && menuRect && (
        <div
          ref={menuRef}
          className={styles.aspectMenu}
          role="listbox"
          style={{
            top: menuRect.top,
            left: menuRect.left,
            width: menuRect.width,
          }}
        >
          <div className={styles.aspectMenuHeader}>Choose image aspect ratio</div>
          {ASPECTS.map((opt) => {
            const active = opt.id === aspectId;
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={active}
                className={styles.aspectMenuItem}
                onClick={() => {
                  setAspectId(opt.id);
                  setMenuOpen(false);
                }}
              >
                <span
                  className={styles.aspectTile}
                  style={{ width: opt.tile.w, height: opt.tile.h }}
                  aria-hidden="true"
                />
                <span className={styles.aspectMenuLabel}>{opt.label}</span>
                {opt.ratio && (
                  <span className={styles.aspectMenuMeta}>{opt.ratio}</span>
                )}
                <span className={styles.aspectMenuCheck} aria-hidden="true">
                  {active && <Check size={14} strokeWidth={2} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>,
    document.body,
  );
}
