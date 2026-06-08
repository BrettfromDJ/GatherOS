import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import styles from './Dropdown.module.css';

// Reusable dropdown control. Trigger is a small pill that shows the
// current selection; clicking opens a portaled popover with the
// option list. Surface treatment matches the canonical
// "control surface" recipe (--surface-1 + --border-strong +
// --radius-lg + --shadow-control) so every dropdown across the app
// feels like the same affordance.
//
//   <Dropdown
//     value={mode}
//     options={[{ value: 'recent', label: 'Most recent' }, ...]}
//     onChange={setMode}
//     ariaLabel="Sort by"
//   />
export default function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  align = 'right',
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  const current = options.find((o) => o.value === value);
  const currentLabel = current?.label ?? '';
  const CurrentIcon = current?.Icon;

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    if (align === 'left') {
      setAnchor({ top: r.bottom + 6, left: r.left, minWidth: r.width });
    } else {
      setAnchor({
        top: r.bottom + 6,
        right: window.innerWidth - r.right,
        minWidth: r.width,
      });
    }
  }, [open, align]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (
        popRef.current && !popRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) setOpen(false);
    }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false); }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function pick(v) {
    setOpen(false);
    if (v !== value) onChange?.(v);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={[styles.trigger, open && styles.triggerOpen, className]
          .filter(Boolean).join(' ')}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {CurrentIcon && (
          <CurrentIcon
            size={15}
            strokeWidth={1.8}
            className={styles.triggerIcon}
            aria-hidden="true"
          />
        )}
        <span className={styles.triggerLabel}>{currentLabel}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={styles.triggerChevron}
          aria-hidden="true"
        />
      </button>
      {open && anchor && createPortal(
        <div
          ref={popRef}
          role="listbox"
          className={styles.menu}
          style={{
            top: `${anchor.top}px`,
            ...(align === 'left'
              ? { left: `${anchor.left}px` }
              : { right: `${anchor.right}px` }),
            minWidth: `${anchor.minWidth}px`,
          }}
        >
          {options.map((opt) => {
            const OptIcon = opt.Icon;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={`${styles.option} ${opt.value === value ? styles.optionActive : ''}`}
                onClick={() => pick(opt.value)}
              >
                {OptIcon && (
                  <OptIcon
                    size={15}
                    strokeWidth={1.8}
                    className={styles.optionIcon}
                    aria-hidden="true"
                  />
                )}
                <span className={styles.optionLabel}>{opt.label}</span>
                {opt.value === value && (
                  <span className={styles.optionCheck} aria-hidden="true">
                    <Check size={12} strokeWidth={2} />
                  </span>
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
