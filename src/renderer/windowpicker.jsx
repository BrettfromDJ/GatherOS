import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

function WindowPicker() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.windowPicker.list().then((items) => {
      if (cancelled) return;
      setSources(Array.isArray(items) ? items : []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') window.windowPicker.cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onPick = useCallback((id) => {
    window.windowPicker.pick(id);
  }, []);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: 'rgba(20, 20, 22, 0.92)',
      backdropFilter: 'blur(28px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(28px) saturate(1.4)',
      borderRadius: 14,
      border: '0.5px solid rgba(255, 255, 255, 0.12)',
      boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 16px 10px',
        borderBottom: '0.5px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.01 }}>
          Pick a window to capture
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)' }}>
          Esc to cancel
        </span>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 12,
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 10,
        alignContent: 'start',
      }}>
        {loading && (
          <div style={{
            gridColumn: '1 / -1',
            padding: 24,
            textAlign: 'center',
            fontSize: 12,
            color: 'rgba(255, 255, 255, 0.55)',
          }}>
            Loading windows…
          </div>
        )}
        {!loading && sources.length === 0 && (
          <div style={{
            gridColumn: '1 / -1',
            padding: 24,
            textAlign: 'center',
            fontSize: 12,
            color: 'rgba(255, 255, 255, 0.55)',
          }}>
            No windows available.
          </div>
        )}
        {sources.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: 8,
              background: 'rgba(255, 255, 255, 0.04)',
              border: '0.5px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 8,
              color: '#fff',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
              transition: 'background 100ms ease, border-color 100ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.10)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.18)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
            }}
          >
            <div style={{
              width: '100%',
              height: 110,
              background: 'rgba(0, 0, 0, 0.4)',
              borderRadius: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}>
              <img
                src={s.thumbnail}
                alt=""
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
                draggable={false}
              />
            </div>
            <span style={{
              fontSize: 12,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {s.name || 'Untitled window'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<WindowPicker />);
