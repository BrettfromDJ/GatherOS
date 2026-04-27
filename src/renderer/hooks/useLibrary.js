import { useCallback, useEffect, useRef, useState } from 'react';

const SEARCH_DEBOUNCE_MS = 180;

export function useLibrary() {
  const [saves, setSaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ type: 'all' });
  const [search, setSearch] = useState('');
  // Debounced shadow of `search`. Typing updates `search` immediately so
  // the input stays responsive, but the IPC only fires off this value
  // after the user pauses — avoids spawning N parallel searches that
  // race each other and flicker through 3-4 result sets.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [colorFilter, setColorFilter] = useState(null);

  // Monotonic counter that's bumped on every new load(). When a request
  // resolves we check it's still the latest before committing — late
  // arrivals from prior queries are dropped on the floor.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const myId = ++requestIdRef.current;
    setLoading(true);
    try {
      const data = await window.moodmark.saves.getAll({
        search: debouncedSearch,
        sort: 'newest',
        collectionId: view.type === 'collection' ? view.id : undefined,
        colorHex: colorFilter || undefined,
      });
      if (requestIdRef.current !== myId) return; // stale, ignore
      setSaves(data);
    } finally {
      if (requestIdRef.current === myId) setLoading(false);
    }
  }, [debouncedSearch, view, colorFilter]);

  useEffect(() => { load(); }, [load]);

  // Refresh when main process fires save:created (any capture method).
  useEffect(() => window.moodmark.on('save:created', load), [load]);

  // save:updated fires when the background AI pipeline writes a new title
  // (or any future field) onto an existing record. Patch in place rather
  // than reloading the whole list.
  useEffect(() =>
    window.moodmark.on('save:updated', (record) => {
      if (!record?.id) return;
      setSaves((prev) => prev.map((s) => (s.id === record.id ? { ...s, ...record } : s)));
    }),
  []);

  const deleteSave = useCallback(async (id) => {
    await window.moodmark.saves.delete(id);
    setSaves((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Edit title / source_url. DB columns are snake_case, JS API is camelCase,
  // so apply both shapes locally for an optimistic update.
  const updateSaveMeta = useCallback(async (id, meta) => {
    await window.moodmark.saves.update({ id, ...meta });
    setSaves((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s };
        if ('title' in meta) next.title = meta.title;
        if ('sourceUrl' in meta) next.source_url = meta.sourceUrl;
        return next;
      }),
    );
  }, []);

  return {
    saves,
    loading,
    view,
    setView,
    search,
    setSearch,
    colorFilter,
    setColorFilter,
    reload: load,
    deleteSave,
    updateSaveMeta,
  };
}
