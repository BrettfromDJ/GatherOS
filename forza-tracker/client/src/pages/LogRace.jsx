import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { parseLap } from '../lib/format.js';

const CAR_CLASSES = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X'];
const DISCIPLINES = ['road', 'street', 'dirt', 'cross-country', 'drift'];

export default function LogRace() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const rematchOf = params.get('rematch');
  const [users, setUsers] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [seasonId, setSeasonId] = useState(null);
  const [trackId, setTrackId] = useState('');
  const [trackOverride, setTrackOverride] = useState('');
  const [carClass, setCarClass] = useState('');
  const [notes, setNotes] = useState('');
  const [order, setOrder] = useState([]);
  const [creatingTrack, setCreatingTrack] = useState(false);
  const [newTrack, setNewTrack] = useState({ name: '', discipline: 'road', region: '' });
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [rematchSource, setRematchSource] = useState(null);

  useEffect(() => {
    Promise.all([api.users(), api.seasons(), api.tracks()]).then(async ([u, s, t]) => {
      setUsers(u);
      setSeasons(s);
      setTracks(t);
      const active = s.find(x => x.status === 'active') || s[0];
      if (active) setSeasonId(active.id);
      setOrder(u.map(x => ({ user_id: x.id, lap: '', dnf: false })));

      if (rematchOf) {
        try {
          const races = await api.races({ limit: 200 });
          const src = races.find(r => r.id === Number(rematchOf));
          if (src) {
            setRematchSource(src);
            setSeasonId(src.season_id);
            setTrackId(src.track_id ? String(src.track_id) : '');
            setTrackOverride(src.track_id ? '' : (src.track_name_override || ''));
            setCarClass(src.car_class || '');
          }
        } catch {}
      }
    });
  }, [rematchOf]);

  const move = (idx, dir) => {
    setOrder(o => {
      const next = [...o];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return next;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };
  const updateRow = (idx, patch) => setOrder(o => o.map((r, i) => i === idx ? { ...r, ...patch } : r));

  const submit = async () => {
    if (!seasonId) return setError('Pick a season.');
    if (!trackId && !trackOverride.trim()) return setError('Pick or enter a track.');
    setBusy(true);
    setError(null);
    try {
      const finishers = order.filter(r => !r.dnf);
      const results = [
        ...finishers.map((r, i) => ({
          user_id: r.user_id,
          position: i + 1,
          fastest_lap_ms: parseLap(r.lap),
          dnf: false,
        })),
        ...order.filter(r => r.dnf).map(r => ({
          user_id: r.user_id,
          position: finishers.length + 1,
          fastest_lap_ms: null,
          dnf: true,
        })),
      ];
      const { id: raceId } = await api.createRace({
        season_id: seasonId,
        track_id: trackId ? Number(trackId) : null,
        track_name_override: trackId ? null : trackOverride.trim(),
        car_class: carClass || null,
        notes: notes.trim() || null,
        results,
      });
      if (photos.length > 0) {
        try { await api.uploadPhotos(raceId, photos); }
        catch (e) { alert(`Race saved, but photo upload failed: ${e.message}`); }
      }
      nav('/');
    } catch (e) {
      setError(e.message || 'Failed to save.');
    } finally {
      setBusy(false);
    }
  };

  const addTrack = async () => {
    if (!newTrack.name.trim()) return;
    const t = await api.createTrack(newTrack);
    setTracks(ts => [...ts, t].sort((a, b) => a.name.localeCompare(b.name)));
    setTrackId(String(t.id));
    setCreatingTrack(false);
    setNewTrack({ name: '', discipline: 'road', region: '' });
  };

  const userById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);

  return (
    <>
      <h1>Log a Race</h1>
      <p className="subtitle">Drag-rank by clicking the up/down arrows. Lap times like <code>1:42.388</code>.</p>

      {rematchSource && (
        <div className="notice" style={{ marginBottom: 12, borderColor: 'var(--accent)' }}>
          <strong style={{ color: 'var(--text)' }}>Rematch:</strong>{' '}
          {rematchSource.track_name || rematchSource.track_name_override}
          {rematchSource.car_class && ` · ${rematchSource.car_class}`} — track and class prefilled.
        </div>
      )}

      <div className="notice" style={{ marginBottom: 16 }}>
        <strong style={{ color: 'var(--text)' }}>Crew races only.</strong> The tracker only accepts races where all four of you ran. If someone wasn't online, don't log it. If someone was in the lobby but crashed out, mark them DNF.
      </div>

      <div className="panel">
        <div className="grid two">
          <div className="field">
            <label>Season</label>
            <select value={seasonId || ''} onChange={e => setSeasonId(Number(e.target.value))}>
              {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Car class</label>
            <select value={carClass} onChange={e => setCarClass(e.target.value)}>
              <option value="">— any —</option>
              {CAR_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>Track</label>
          {creatingTrack ? (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <input placeholder="Name" value={newTrack.name} onChange={e => setNewTrack({ ...newTrack, name: e.target.value })} />
              <select value={newTrack.discipline} onChange={e => setNewTrack({ ...newTrack, discipline: e.target.value })}>
                {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input placeholder="Region (optional)" value={newTrack.region} onChange={e => setNewTrack({ ...newTrack, region: e.target.value })} />
              <button onClick={addTrack}>Add</button>
              <button className="secondary" onClick={() => setCreatingTrack(false)}>Cancel</button>
            </div>
          ) : (
            <div className="row">
              <select value={trackId} onChange={e => setTrackId(e.target.value)} style={{ flex: 1 }}>
                <option value="">— pick a track —</option>
                {tracks.map(t => <option key={t.id} value={t.id}>{t.name} ({t.discipline})</option>)}
              </select>
              <button className="secondary" onClick={() => setCreatingTrack(true)}>+ New</button>
            </div>
          )}
          {!trackId && !creatingTrack && (
            <input placeholder="…or type a one-off track name" value={trackOverride} onChange={e => setTrackOverride(e.target.value)} style={{ marginTop: 6 }} />
          )}
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Finishing order</h2>
        <div className="entry-rank">
          {order.map((row, idx) => {
            const u = userById[row.user_id];
            return (
              <div key={row.user_id} className="slot">
                <span className={`pos ${row.dnf ? 'dnf' : `p${idx + 1}`}`}>{row.dnf ? 'DNF' : idx + 1}</span>
                <span className="driver"><span className="dot" style={{ background: u?.color }} />{u?.display_name}</span>
                <input
                  placeholder="Fastest lap (1:42.388)"
                  value={row.lap}
                  onChange={e => updateRow(idx, { lap: e.target.value })}
                  disabled={row.dnf}
                />
                <label className="row" style={{ gap: 4, fontSize: 12, color: 'var(--muted)' }}>
                  <input type="checkbox" checked={row.dnf} onChange={e => updateRow(idx, { dnf: e.target.checked })} />
                  DNF
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button className="ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>↑</button>
                  <button className="ghost" onClick={() => move(idx, 1)} disabled={idx === order.length - 1}>↓</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="field">
          <label>Notes (optional)</label>
          <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything memorable. Crashes, drama, photo finishes…" />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Photos (optional) — screenshots, photo mode, the post-race results screen</label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={e => setPhotos([...e.target.files])}
          />
          {photos.length > 0 && (
            <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
              {photos.length} file{photos.length === 1 ? '' : 's'} selected ({Math.round(photos.reduce((acc, f) => acc + f.size, 0) / 1024)} KB total)
            </div>
          )}
        </div>
      </div>

      {error && <div className="panel" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>{error}</div>}

      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
        <button className="secondary" onClick={() => nav(-1)}>Cancel</button>
        <button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save race'}</button>
      </div>
    </>
  );
}
