import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import styles from './ContextMenu.module.css';

function ChevronRightIcon() {
  return (
    <svg width="6" height="10" viewBox="0 0 6 10" aria-hidden="true">
      <path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const submenuRef = useRef(null);
  // Index of the submenu item whose children are currently inline-
  // expanded. Used by the "Add to Bucket" picker to surface nested
  // child buckets only when the user hovers their parent.
  const [hoveredSubIdx, setHoveredSubIdx] = useState(null);
  // Reset whenever the active submenu changes — opening a different
  // submenu shouldn't carry a stale expanded child block over.
  useEffect(() => {
    setHoveredSubIdx(null);
  }, [openSubmenu?.idx]);
  const [pos, setPos] = useState({ x, y, ready: false });
  // The currently-open submenu, including its anchor coords (in
  // viewport space — we portal it to body so backdrop-filter isn't
  // suppressed by the parent menu's stacking context).
  const [openSubmenu, setOpenSubmenu] = useState(null); // { idx, x, y } | null

  useEffect(() => {
    function onMouseDown(e) {
      const insideMenu = ref.current && ref.current.contains(e.target);
      const insideSubmenu = submenuRef.current && submenuRef.current.contains(e.target);
      if (!insideMenu && !insideSubmenu) onClose();
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
  // When flipping, leave a small gap above the cursor so the bottom item
  // doesn't sit directly over the row that opened the menu — clicks
  // there can land on the underlying button instead of our item.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    const flipGap = 6;
    let nx = x;
    let ny = y;
    if (nx + rect.width > window.innerWidth - margin) {
      nx = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (ny + rect.height > window.innerHeight - margin) {
      ny = Math.max(margin, y - rect.height - flipGap);
    }
    setPos({ x: nx, y: ny, ready: true });
  }, [x, y, items]);

  // Clamp the submenu inside the viewport once it's mounted. If it
  // would overflow off the right edge, flip to the left of the parent
  // item; if it would overflow the bottom, slide upward.
  useLayoutEffect(() => {
    if (!openSubmenu || !submenuRef.current) return;
    const rect = submenuRef.current.getBoundingClientRect();
    const margin = 8;
    let { x: sx, y: sy } = openSubmenu;
    let changed = false;
    if (sx + rect.width > window.innerWidth - margin) {
      // Flip to the left of the parent item.
      sx = Math.max(margin, openSubmenu.parentLeft - rect.width - 4);
      changed = true;
    }
    if (sy + rect.height > window.innerHeight - margin) {
      sy = Math.max(margin, window.innerHeight - rect.height - margin);
      changed = true;
    }
    if (changed) setOpenSubmenu((s) => (s ? { ...s, x: sx, y: sy } : s));
    // openSubmenu.idx in deps only — re-run on submenu change, not on
    // every position update (would loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSubmenu?.idx]);

  function openSubmenuFor(idx, target) {
    const r = target.getBoundingClientRect();
    setOpenSubmenu({
      idx,
      x: r.right + 4,
      y: r.top - 4,
      parentLeft: r.left,
    });
  }

  const hasIcons = items.some((it) => it && it.icon);
  const activeSub = openSubmenu ? items[openSubmenu.idx] : null;
  const subHasIcons = activeSub?.submenu?.some((s) => s && s.icon);

  return (
    <>
      {ReactDOM.createPortal(
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
            const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0;
            const isOpen = hasSubmenu && openSubmenu?.idx === i;
            return (
              <div
                key={i}
                className={styles.itemContainer}
                onMouseEnter={(e) => {
                  if (hasSubmenu) openSubmenuFor(i, e.currentTarget);
                  else setOpenSubmenu(null);
                }}
              >
                <button
                  className={[
                    styles.item,
                    item.danger && styles.danger,
                    isOpen && styles.itemActive,
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    if (hasSubmenu) return; // submenu items handle their own clicks
                    item.onClick();
                    onClose();
                  }}
                >
                  {hasIcons && (
                    <span className={styles.itemIcon}>{item.icon || null}</span>
                  )}
                  <span className={styles.itemLabel}>{item.label}</span>
                  {hasSubmenu && (
                    <span className={styles.itemChevron}><ChevronRightIcon /></span>
                  )}
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}

      {activeSub && ReactDOM.createPortal(
        <div
          ref={submenuRef}
          className={[styles.submenu, subHasIcons && styles.menuWithIcons].filter(Boolean).join(' ')}
          style={{
            position: 'fixed',
            top: openSubmenu.y,
            left: openSubmenu.x,
          }}
        >
          {activeSub.submenu.flatMap((sub, j) => {
            if (sub.type === 'separator') {
              return [<div key={j} className={styles.separator} />];
            }
            if (sub.type === 'header') {
              return [<div key={j} className={styles.header}>{sub.label}</div>];
            }
            const hasChildren = Array.isArray(sub.children) && sub.children.length > 0;
            const expanded = hasChildren && hoveredSubIdx === j;
            const rendered = [
              <button
                key={j}
                className={[styles.item, sub.danger && styles.danger]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => setHoveredSubIdx(j)}
                onClick={() => { sub.onClick(); onClose(); }}
              >
                {subHasIcons && (
                  <span className={styles.itemIcon}>{sub.icon || null}</span>
                )}
                <span className={styles.itemLabel}>{sub.label}</span>
              </button>,
            ];
            if (expanded) {
              for (let k = 0; k < sub.children.length; k++) {
                const child = sub.children[k];
                rendered.push(
                  <button
                    key={`${j}-${k}`}
                    className={[styles.item, styles.itemIndent].join(' ')}
                    onClick={() => { child.onClick(); onClose(); }}
                  >
                    {subHasIcons && (
                      <span className={styles.itemIcon}>{child.icon || null}</span>
                    )}
                    <span className={styles.itemLabel}>{child.label}</span>
                  </button>,
                );
              }
            }
            return rendered;
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
