import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'moodmark.recentSearches';
const MAX_ENTRIES = 6;

// Persists the user's recent search terms to localStorage and exposes
// a small API the toolbar consumes: an ordered list (most recent first),
// a recordSearch helper that dedupes and caps the list, and a clearAll
// for the dropdown's "Clear" affordance. Lives in renderer-only state —
// no main-process round-trip; recents are a local quality-of-life
// feature, not library data.
export function useRecentSearches() {
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
    catch {}
  }, [items]);

  const recordSearch = useCallback((term) => {
    const trimmed = String(term || '').trim();
    if (!trimmed) return;
    setItems((prev) => {
      const filtered = prev.filter((t) => t.toLowerCase() !== trimmed.toLowerCase());
      return [trimmed, ...filtered].slice(0, MAX_ENTRIES);
    });
  }, []);

  const removeOne = useCallback((term) => {
    setItems((prev) => prev.filter((t) => t !== term));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
  }, []);

  // Put a cleared list back — clearing recents is otherwise irreversible,
  // so the UI snapshots the list before clearing and offers an Undo.
  const restore = useCallback((list) => {
    if (!Array.isArray(list)) return;
    setItems(list.filter((t) => typeof t === 'string').slice(0, MAX_ENTRIES));
  }, []);

  return { items, recordSearch, removeOne, clearAll, restore };
}
