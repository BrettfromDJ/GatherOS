import { useCallback, useEffect, useRef, useState } from 'react';
import { playPop } from '../lib/sounds.js';

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
      const backendView = view.type === 'unsorted' || view.type === 'trash'
        ? view.type
        : 'all';
      const data = await window.moodmark.saves.getAll({
        search: debouncedSearch,
        sort: 'newest',
        view: backendView,
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

  // Track the IDs of just-arrived saves so the grid can briefly
  // highlight them. Each ID is auto-cleared after the shimmer's
  // animation duration so subsequent renders don't re-trigger it.
  const FRESH_MS = 1500;
  const [freshIds, setFreshIds] = useState(() => new Set());

  // Refresh when main process fires save:created (any capture method).
  // The event carries the new record; we pull its id, reload the list,
  // and mark it fresh for FRESH_MS so the card shimmer fires once.
  useEffect(() =>
    window.moodmark.on('save:created', (record) => {
      load();
      playPop();
      const id = record?.id;
      if (!id) return;
      setFreshIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setTimeout(() => {
        setFreshIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, FRESH_MS);
    }),
  [load]);

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

  const restoreSave = useCallback(async (id) => {
    await window.moodmark.saves.restore(id);
    setSaves((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const permanentDeleteSave = useCallback(async (id) => {
    await window.moodmark.saves.permanentDelete(id);
    setSaves((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const emptyTrash = useCallback(async () => {
    await window.moodmark.saves.emptyTrash();
    setSaves([]);
  }, []);

  // Optimistic local removal without firing any IPC. Used by the
  // deferred Delete-Forever / Empty-Trash flow: we hide the items
  // immediately so the UI feels snappy, while the actual permanent
  // delete is held in a 5-second undo window.
  const hideSavesLocal = useCallback((ids) => {
    if (!ids?.length) return;
    const idSet = new Set(ids);
    setSaves((prev) => prev.filter((s) => !idSet.has(s.id)));
  }, []);

  // Edit title / source_url. DB columns are snake_case, JS API is camelCase,
  // so apply both shapes locally for an optimistic update.
  const updateSaveMeta = useCallback(async (id, patch) => {
    await window.moodmark.saves.update({ id, ...patch });
    setSaves((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s };
        if ('title' in patch) next.title = patch.title;
        if ('sourceUrl' in patch) next.source_url = patch.sourceUrl;
        if ('meta' in patch) next.meta = patch.meta; // JSON string
        if ('notes' in patch) next.notes = patch.notes;
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
    restoreSave,
    permanentDeleteSave,
    emptyTrash,
    hideSavesLocal,
    updateSaveMeta,
    freshIds,
  };
}
