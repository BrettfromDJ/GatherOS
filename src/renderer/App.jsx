import React, { useState, useCallback } from 'react';

export default function App() {
  const [dragging, setDragging] = useState(false);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const hasImage = [...e.dataTransfer.items].some(
      (i) => i.kind === 'file' && i.type.startsWith('image/'),
    );
    if (hasImage) setDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
  }, []);

  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);

    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    for (const file of files) {
      try {
        await window.moodmark.saves.dropFile(file.path);
      } catch (err) {
        console.error('Drop failed:', err);
      }
    }
  }, []);

  return (
    <div
      className={`app-shell${dragging ? ' drag-over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="drag-region" />

      <main className="app-placeholder">
        <h1>Moodmark</h1>
        <p>Drop images here · Press ⌘⇧S to screenshot</p>
      </main>

      {dragging && (
        <div className="drop-overlay">
          <span className="drop-message">Drop to save</span>
        </div>
      )}
    </div>
  );
}
