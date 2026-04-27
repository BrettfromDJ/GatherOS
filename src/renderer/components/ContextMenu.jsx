import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import styles from './ContextMenu.module.css';

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y, ready: false });

  useEffect(() => {
    function onMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  // Clamp into the viewport; flip up if the menu would overflow the bottom.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let nx = x;
    let ny = y;
    if (nx + rect.width > window.innerWidth - margin) {
      nx = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (ny + rect.height > window.innerHeight - margin) {
      ny = Math.max(margin, y - rect.height);
    }
    setPos({ x: nx, y: ny, ready: true });
  }, [x, y, items]);

  const hasIcons = items.some((it) => it && it.icon);

  return ReactDOM.createPortal(
    <div
      ref={ref}
      className={[styles.menu, hasIcons && styles.menuWithIcons].filter(Boolean).join(' ')}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        visibility: pos.ready ? 'visible' : 'hidden',
      }}
    >
      {items.map((item, i) => {
        if (item.type === 'separator') {
          return <div key={i} className={styles.separator} />;
        }
        if (item.type === 'header') {
          return <div key={i} className={styles.header}>{item.label}</div>;
        }
        return (
          <button
            key={i}
            className={[styles.item, item.danger && styles.danger].filter(Boolean).join(' ')}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {hasIcons && (
              <span className={styles.itemIcon}>{item.icon || null}</span>
            )}
            <span className={styles.itemLabel}>{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
