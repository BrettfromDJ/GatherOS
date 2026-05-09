import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatDate, formatLap } from '../lib/format.js';
import PhotoGallery from '../components/PhotoGallery.jsx';

export default function Races() {
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);
  const [races, setRaces] = useState([]);

  useEffect(() => { api.seasons().then(s => { setSeasons(s); setSeasonId(s[0]?.id || null); }); }, []);
  useEffect(() => {
    if (!seasonId) return;
    api.races({ season_id: seasonId, limit: 200 }).then(setRaces);
  }, [seasonId]);

  const remove = async (id) => {
    if (!confirm('Delete this race? Standings will recalculate.')) return;
    await api.deleteRace(id);
    setRaces(rs => rs.filter(r => r.id !== id));
  };

  return (
    <>
      <div className="row spread">
        <div>
          <h1>Race History</h1>
          <p className="subtitle">Every race ever. Filter by season.</p>
        </div>
        <div className="row">
          <select value={seasonId || ''} onChange={e => setSeasonId(Number(e.target.value))}>
            {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Link to="/log"><button>Log a race</button></Link>
        </div>
      </div>

      {races.length === 0 ? <div className="panel empty">Nothing yet.</div> : races.map(r => (
        <div key={r.id} className="panel">
          <div className="row spread" style={{ marginBottom: 10 }}>
            <div>
              <strong>{r.track_name || r.track_name_override || 'Unknown'}</strong>
              {r.track_discipline && <span className={`tag ${r.track_discipline}`} style={{ marginLeft: 8 }}>{r.track_discipline}</span>}
              {r.car_class && <span className="tag" style={{ marginLeft: 6 }}>{r.car_class}</span>}
              <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 10 }}>{formatDate(r.raced_at)}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Link to={`/log?rematch=${r.id}`}><button className="secondary">Rematch</button></Link>
              <button className="ghost" onClick={() => remove(r.id)}>Delete</button>
            </div>
          </div>
          <div className="results-list">
            {r.results.map(res => (
              <div
                key={res.id}
                className="result-row"
                style={res.team_color ? { borderLeft: `3px solid ${res.team_color}` } : undefined}
              >
                <span className={`pos ${res.dnf ? 'dnf' : `p${res.position}`}`}>{res.dnf ? 'DNF' : res.position}</span>
                <span className="driver">
                  <span className="dot" style={{ background: res.color }} />{res.display_name}
                  {res.team_name && <span className="badge" style={{ marginLeft: 8 }}><span className="dot" style={{ background: res.team_color }} />{res.team_name}</span>}
                </span>
                <span className="lap">{formatLap(res.fastest_lap_ms)}</span>
                <span style={{ fontWeight: 600 }}>{res.points} pt</span>
              </div>
            ))}
          </div>
          {r.notes && <div style={{ marginTop: 10, color: 'var(--muted)', fontSize: 13 }}>{r.notes}</div>}
          <PhotoGallery
            raceId={r.id}
            photos={r.photos || []}
            canEdit={true}
            onChange={photos => setRaces(rs => rs.map(x => x.id === r.id ? { ...x, photos } : x))}
          />
        </div>
      ))}
    </>
  );
}
