import { useCallback, useEffect, useState } from 'react';

function filterFor(view) {
  if (view.type === 'favorites') return 'favorites';
  if (view.type === 'recent') return 'recent';
  return 'all';
}

export function useLibrary() {
  const [saves, setSaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ type: 'all' });
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.moodmark.saves.getAll({
        search,
        filter: filterFor(view),
        sort: 'newest',
        collectionId: view.type === 'collection' ? view.id : undefined,
      });
      setSaves(data);
    } finally {
      setLoading(false);
    }
  }, [search, view]);

  useEffect(() => { load(); }, [load]);

  // Refresh when main process fires save:created (any capture method).
  useEffect(() => window.moodmark.on('save:created', load), [load]);

  const toggleFavorite = useCallback(async (id, favorited) => {
    await window.moodmark.saves.update({ id, favorited });
    // Optimistic local update so the star flips instantly.
    setSaves((prev) =>
      prev.map((s) => (s.id === id ? { ...s, favorited: favorited ? 1 : 0 } : s)),
    );
    if (view.type === 'favorites') load();
  }, [load, view.type]);

  const deleteSave = useCallback(async (id) => {
    await window.moodmark.saves.delete(id);
    setSaves((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return {
    saves,
    loading,
    view,
    setView,
    search,
    setSearch,
    reload: load,
    toggleFavorite,
    deleteSave,
  };
}
