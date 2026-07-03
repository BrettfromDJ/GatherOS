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

export default function ContextMenu({ x, y, items, onClose, className }) {
  const ref = useRef(null);
  const submenuRef = useRef(null);
  const childMenuRef = useRef(null);
  const [pos, setPos] = useState({ x, y, ready: false });
  // The currently-open submenu, including its anchor coords (in
  // viewport space — we portal it to body so backdrop-filter isn't
  // suppressed by the parent menu's stacking context).
  const [openSubmenu, setOpenSubmenu] = useState(null); // { idx, x, y } | null
  // Third-level flyout: the submenu row whose children are cascaded
  // out beside the submenu (a collection with child collections in
  // the "Add to collection" picker). Same anchor shape as openSubmenu.
  const [openChildMenu, setOpenChildMenu] = useState(null); // { idx, x, y } | null
  // Reset whenever the active submenu changes — opening a different
  // submenu shouldn't carry a stale child flyout over.
  useEffect(() => {
    setOpenChildMenu(null);
  }, [openSubmenu?.idx]);

  useEffect(() => {
    function onMouseDown(e) {
      const insideMenu = ref.current && ref.current.contains(e.target);
      const insideSubmenu = submenuRef.current && submenuRef.current.contains(e.target);
      const insideChildMenu = childMenuRef.current && childMenuRef.current.contains(e.target);
      if (!insideMenu && !insideSubmenu && !insideChildMenu) onClose();
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

  // Same clamp for the third-level flyout.
  useLayoutEffect(() => {
    if (!openChildMenu || !childMenuRef.current) return;
    const rect = childMenuRef.current.getBoundingClientRect();
    const margin = 8;
    let { x: cx, y: cy } = openChildMenu;
    let changed = false;
    if (cx + rect.width > window.innerWidth - margin) {
      cx = Math.max(margin, openChildMenu.parentLeft - rect.width - 4);
      changed = true;
    }
    if (cy + rect.height > window.innerHeight - margin) {
      cy = Math.max(margin, window.innerHeight - rect.height - margin);
      changed = true;
    }
    if (changed) setOpenChildMenu((s) => (s ? { ...s, x: cx, y: cy } : s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChildMenu?.idx]);

  function anchorBeside(idx, target) {
    const r = target.getBoundingClientRect();
    return {
      idx,
      x: r.right + 4,
      y: r.top - 4,
      parentLeft: r.left,
    };
  }

  const hasIcons = items.some((it) => it && it.icon);
  const activeSub = openSubmenu ? items[openSubmenu.idx] : null;
  const subHasIcons = activeSub?.submenu?.some((s) => s && s.icon);
  const activeChild = activeSub && openChildMenu
    ? activeSub.submenu?.[openChildMenu.idx]
    : null;
  const childHasIcons = activeChild?.children?.some((c) => c && c.icon);

  return (
    <>
      {ReactDOM.createPortal(
        <div
          ref={ref}
          className={[
            styles.menu,
            hasIcons && styles.menuWithIcons,
            className,
          ].filter(Boolean).join(' ')}
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
                  if (hasSubmenu) setOpenSubmenu(anchorBeside(i, e.currentTarget));
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
          className={[
            styles.submenu,
            subHasIcons && styles.menuWithIcons,
            className,
          ].filter(Boolean).join(' ')}
          style={{
            position: 'fixed',
            top: openSubmenu.y,
            left: openSubmenu.x,
          }}
        >
          {activeSub.submenu.map((sub, j) => {
            if (sub.type === 'separator') {
              return <div key={j} className={styles.separator} />;
            }
            if (sub.type === 'header') {
              return <div key={j} className={styles.header}>{sub.label}</div>;
            }
            // A submenu row with `children` cascades a third-level
            // flyout on hover (child collections under a parent in
            // the "Add to collection" picker). Clicking the row still
            // acts on the parent itself.
            const hasChildren = Array.isArray(sub.children) && sub.children.length > 0;
            const isChildOpen = hasChildren && openChildMenu?.idx === j;
            return (
              <button
                key={j}
                className={[
                  styles.item,
                  sub.danger && styles.danger,
                  isChildOpen && styles.itemActive,
                ].filter(Boolean).join(' ')}
                onMouseEnter={(e) => {
                  if (hasChildren) setOpenChildMenu(anchorBeside(j, e.currentTarget));
                  else setOpenChildMenu(null);
                }}
                onClick={() => { sub.onClick(); onClose(); }}
              >
                {subHasIcons && (
                  <span className={styles.itemIcon}>{sub.icon || null}</span>
                )}
                <span className={styles.itemLabel}>{sub.label}</span>
                {hasChildren && (
                  <span className={styles.itemChevron}><ChevronRightIcon /></span>
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}

      {activeChild?.children?.length > 0 && ReactDOM.createPortal(
        <div
          ref={childMenuRef}
          className={[
            styles.submenu,
            childHasIcons && styles.menuWithIcons,
            className,
          ].filter(Boolean).join(' ')}
          style={{
            position: 'fixed',
            top: openChildMenu.y,
            left: openChildMenu.x,
          }}
        >
          {activeChild.children.map((child, k) => (
            <button
              key={k}
              className={[styles.item, child.danger && styles.danger]
                .filter(Boolean)
                .join(' ')}
              onClick={() => { child.onClick(); onClose(); }}
            >
              {childHasIcons && (
                <span className={styles.itemIcon}>{child.icon || null}</span>
              )}
              <span className={styles.itemLabel}>{child.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
