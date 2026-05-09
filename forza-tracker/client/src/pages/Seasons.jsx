import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const PRESETS = {
  'Crew default (10/6/3/1)': [10, 6, 3, 1],
  'F1-style top 4 (25/18/15/12)': [25, 18, 15, 12],
  'Tight (5/3/2/1)': [5, 3, 2, 1],
  'Winner take all (3/0/0/0)': [3, 0, 0, 0],
};

export default function Seasons() {
  const [seasons, setSeasons] = useState([]);
  const [draft, setDraft] = useState(null);

  const refresh = () => api.seasons().then(setSeasons);
  useEffect(() => { refresh(); }, []);

  const startCreate = () => setDraft({
    name: '',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: '',
    point_system: [10, 6, 3, 1],
    fastest_lap_bonus: 1,
    status: 'active',
  });

  const startEdit = (s) => setDraft({ ...s, end_date: s.end_date || '' });

  const save = async () => {
    const body = {
      name: draft.name,
      start_date: draft.start_date,
      end_date: draft.end_date || null,
      point_system: draft.point_system,
      fastest_lap_bonus: Number(draft.fastest_lap_bonus),
      status: draft.status,
    };
    if (draft.id) await api.updateSeason(draft.id, body);
    else await api.createSeason(body);
    setDraft(null);
    refresh();
  };

  return (
    <>
      <div className="row spread">
        <div>
          <h1>Seasons</h1>
          <p className="subtitle">Define point systems and date ranges. Points recompute when you change the system.</p>
        </div>
        <button onClick={startCreate}>+ New season</button>
      </div>

      {draft && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{draft.id ? 'Edit season' : 'New season'}</h2>
          <div className="grid two">
            <div className="field">
              <label>Name</label>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Status</label>
              <select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div className="field">
              <label>Start date</label>
              <input type="date" value={draft.start_date} onChange={e => setDraft({ ...draft, start_date: e.target.value })} />
            </div>
            <div className="field">
              <label>End date (optional)</label>
              <input type="date" value={draft.end_date} onChange={e => setDraft({ ...draft, end_date: e.target.value })} />
            </div>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>Points by position (comma-separated)</label>
            <input
              value={draft.point_system.join(', ')}
              onChange={e => setDraft({
                ...draft,
                point_system: e.target.value.split(',').map(x => Number(x.trim())).filter(n => !Number.isNaN(n)),
              })}
            />
            <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(PRESETS).map(([name, ps]) => (
                <button key={name} className="secondary" type="button" onClick={() => setDraft({ ...draft, point_system: ps })}>{name}</button>
              ))}
            </div>
          </div>

          <div className="field" style={{ marginTop: 12, maxWidth: 220 }}>
            <label>Fastest-lap bonus</label>
            <input type="number" min="0" value={draft.fastest_lap_bonus} onChange={e => setDraft({ ...draft, fastest_lap_bonus: e.target.value })} />
          </div>

          <div className="row" style={{ marginTop: 16, gap: 8, justifyContent: 'flex-end' }}>
            <button className="secondary" onClick={() => setDraft(null)}>Cancel</button>
            <button onClick={save}>Save</button>
          </div>
        </div>
      )}

      <div className="panel">
        {seasons.length === 0 ? <div className="empty">No seasons yet.</div> : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Start</th>
                <th>End</th>
                <th>Points</th>
                <th>FL bonus</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {seasons.map(s => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td>{s.start_date}</td>
                  <td>{s.end_date || '—'}</td>
                  <td>{s.point_system.join(' / ')}</td>
                  <td className="num">+{s.fastest_lap_bonus}</td>
                  <td><span className="badge">{s.status}</span></td>
                  <td><button className="ghost" onClick={() => startEdit(s)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
