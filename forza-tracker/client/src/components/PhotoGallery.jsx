import React, { useState, useRef } from 'react';
import { api } from '../lib/api.js';

export default function PhotoGallery({ raceId, photos, canEdit, onChange }) {
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState('');
  const fileRef = useRef(null);

  const upload = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const newPhotos = await api.uploadPhotos(raceId, [...files], caption || null);
      setCaption('');
      if (fileRef.current) fileRef.current.value = '';
      onChange?.([...(photos || []), ...newPhotos]);
    } catch (e) {
      alert(`Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (photo) => {
    if (!confirm('Delete this photo?')) return;
    await api.deletePhoto(photo.id);
    onChange?.(photos.filter(p => p.id !== photo.id));
    setLightboxIdx(null);
  };

  return (
    <div style={{ marginTop: 12 }}>
      {photos && photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: canEdit ? 10 : 0 }}>
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setLightboxIdx(i)}
              style={{
                padding: 0, border: '1px solid var(--border)', borderRadius: 8,
                overflow: 'hidden', background: 'transparent', cursor: 'zoom-in',
              }}
            >
              <img
                src={`/uploads/${p.filename}`}
                alt={p.caption || 'race photo'}
                style={{ display: 'block', width: 120, height: 80, objectFit: 'cover' }}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={e => upload(e.target.files)}
            disabled={uploading}
            style={{ flex: '1 1 220px', minWidth: 0 }}
          />
          <input
            placeholder="Caption (optional)"
            value={caption}
            onChange={e => setCaption(e.target.value)}
            disabled={uploading}
            style={{ flex: '1 1 200px', minWidth: 0 }}
          />
          {uploading && <span style={{ color: 'var(--muted)', fontSize: 12 }}>Uploading…</span>}
        </div>
      )}

      {lightboxIdx != null && photos[lightboxIdx] && (
        <div
          onClick={() => setLightboxIdx(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '95vw', maxHeight: '95vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
          >
            <img
              src={`/uploads/${photos[lightboxIdx].filename}`}
              alt={photos[lightboxIdx].caption || 'race photo'}
              style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }}
            />
            {photos[lightboxIdx].caption && (
              <div style={{ color: 'var(--text)', textAlign: 'center', maxWidth: 600 }}>
                {photos[lightboxIdx].caption}
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button className="secondary" onClick={() => setLightboxIdx(i => Math.max(0, i - 1))} disabled={lightboxIdx === 0}>← Prev</button>
              <button className="secondary" onClick={() => setLightboxIdx(i => Math.min(photos.length - 1, i + 1))} disabled={lightboxIdx === photos.length - 1}>Next →</button>
              <button className="secondary" onClick={() => setLightboxIdx(null)}>Close</button>
              {canEdit && <button className="danger" onClick={() => remove(photos[lightboxIdx])}>Delete</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
