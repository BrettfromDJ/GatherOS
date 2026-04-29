import React, { useEffect, useRef, useState } from 'react';
import styles from './TraySearch.module.css';
import { fileUrl } from '../lib/fileUrl.js';

const SEARCH_DEBOUNCE_MS = 140;
const RESULT_LIMIT = 14;

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </svg>
  );
}

export default function TraySearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const inputRef = useRef(null);
  const requestIdRef = useRef(0);

  // Debounced library search.
  useEffect(() => {
    const id = setTimeout(async () => {
      const myId = ++requestIdRef.current;
      try {
        const data = await window.traySearch.query(query);
        if (myId !== requestIdRef.current) return;
        setResults((data || []).slice(0, RESULT_LIMIT));
        setActiveIndex(0);
      } catch {
        if (myId === requestIdRef.current) setResults([]);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Focus input + reset state every time the popover (re)opens.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
    return window.traySearch.onFocus(() => {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      setFeedback(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
  }, []);

  // Briefly flash a confirmation pill ("Copied" / "Reveal'd") at the
  // top of the popover then auto-clear. Used after copy / reveal.
  function flash(text, ms = 900) {
    setFeedback(text);
    setTimeout(() => setFeedback((f) => (f === text ? null : f)), ms);
  }

  async function handleCopy(saveId) {
    const ok = await window.traySearch.copy(saveId);
    if (ok) {
      flash('Copied to clipboard');
      // Tiny delay so the user sees the flash before dismissal.
      setTimeout(() => window.traySearch.close(), 320);
    }
  }

  async function handleReveal(saveId) {
    await window.traySearch.reveal(saveId);
  }

  function handleKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      window.traySearch.close();
      return;
    }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[activeIndex];
      if (!target) return;
      // ⌘+Enter reveals in the main window; plain Enter copies the
      // image to clipboard so the user can paste it anywhere.
      if (e.metaKey) handleReveal(target.id);
      else handleCopy(target.id);
    }
  }

  function handleRowClick(save, e) {
    if (e.metaKey) handleReveal(save.id);
    else handleCopy(save.id);
  }

  function handleDragStart(e, save) {
    // Hand off to the main process which calls webContents.startDrag.
    // The browser's HTML5 drag is irrelevant here; we just need this
    // handler to fire so Electron's startDrag is invoked in time.
    window.traySearch.drag(save.id);
    e.preventDefault();
  }

  return (
    <div className={styles.popover}>
      <div className={styles.searchBar}>
        <span className={styles.searchIcon}><SearchIcon /></span>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Search your library…"
        />
        {feedback && <span className={styles.feedback}>{feedback}</span>}
      </div>

      <div className={styles.results}>
        {results.length === 0 && query && (
          <div className={styles.empty}>No matches</div>
        )}
        {results.length === 0 && !query && (
          <div className={styles.hint}>
            <div>Start typing to find a save</div>
            <div className={styles.hintSub}>
              Enter copies · ⌘+Enter opens · drag a row to drop into another app
            </div>
          </div>
        )}
        {results.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={[styles.row, i === activeIndex && styles.rowActive]
              .filter(Boolean)
              .join(' ')}
            onClick={(e) => handleRowClick(s, e)}
            onMouseEnter={() => setActiveIndex(i)}
            onDragStart={(e) => handleDragStart(e, s)}
            draggable
          >
            <img
              src={fileUrl(s.thumb_path || s.file_path)}
              alt=""
              className={styles.thumb}
              draggable={false}
            />
            <div className={styles.text}>
              <div className={styles.title}>{s.title || 'Untitled'}</div>
              {s.tags && s.tags.length > 0 && (
                <div className={styles.tags}>
                  {s.tags.slice(0, 3).map((t) => `#${typeof t === 'string' ? t : t.name}`).join('  ')}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
