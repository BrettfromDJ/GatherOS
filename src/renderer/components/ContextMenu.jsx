import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import styles from './ContextMenu.module.css';

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

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

  return ReactDOM.createPortal(
    <div
      ref={ref}
      className={styles.menu}
      style={{ position: 'fixed', top: y, left: x }}
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
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
