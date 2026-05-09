import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatDate, formatLap } from '../lib/format.js';

export default function Dashboard() {
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);
  const [standings, setStandings] = useState([]);
  const [races, setRaces] = useState([]);
  const [records, setRecords] = useState([]);

  useEffect(() => {
    api.seasons().then(s => {
      setSeasons(s);
      const active = s.find(x => x.status === 'active') || s[0];
      if (active) setSeasonId(active.id);
    });
  }, []);

  useEffect(() => {
    if (!seasonId) return;
    api.standings(seasonId).then(setStandings);
    api.races({ season_id: seasonId, limit: 5 }).then(setRaces);
    api.records().then(setRecords);
  }, [seasonId]);

  const season = useMemo(() => seasons.find(s => s.id === seasonId), [seasons, seasonId]);
  const totalRaces = standings.reduce((acc, s) => Math.max(acc, s.races || 0), 0);
  const leader = standings[0];

  return (
    <>
      <div className="row spread" style={{ marginBottom: 8 }}>
        <div>
          <h1>Dashboard</h1>
          <p className="subtitle">{season ? season.name : 'No season yet'}</p>
        </div>
        <div className="row">
          <select value={seasonId || ''} onChange={e => setSeasonId(Number(e.target.value))}>
            {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Link to="/log"><button>Log a race</button></Link>
        </div>
      </div>

      <div className="grid four" style={{ marginBottom: 18 }}>
        <Stat label="Races this season" value={totalRaces} />
        <Stat label="Current leader" value={leader?.display_name || '—'} sub={leader ? `${leader.points} pts` : ''} />
        <Stat label="Most wins" value={topBy(standings, 'wins')?.display_name || '—'} sub={topBy(standings, 'wins')?.wins ? `${topBy(standings, 'wins').wins} wins` : ''} />
        <Stat label="Records held" value={records.length} sub="across all tracks" />
      </div>

      <div className="panel">
        <div className="row spread" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Standings</h2>
          <span className="badge"><span className="dot" style={{ background: 'var(--accent)' }} />Points: {(season?.point_system || []).join(' / ')}{' '}+{season?.fastest_lap_bonus || 0} FL</span>
        </div>
        {standings.length === 0 ? <div className="empty">No standings yet.</div> : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Driver</th>
                <th className="num">Races</th>
                <th className="num">Wins</th>
                <th className="num">Podiums</th>
                <th className="num">DNFs</th>
                <th className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s, i) => (
                <tr key={s.user_id}>
                  <td><span className={`pos p${i + 1}`}>{i + 1}</span></td>
                  <td>
                    <span className="driver"><span className="dot" style={{ background: s.color }} />{s.display_name}</span>
                  </td>
                  <td className="num">{s.races}</td>
                  <td className="num">{s.wins}</td>
                  <td className="num">{s.podiums}</td>
                  <td className="num">{s.dnfs}</td>
                  <td className="num"><strong>{s.points}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="row spread" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Recent races</h2>
          <Link to="/races" style={{ fontSize: 13 }}>See all →</Link>
        </div>
        {races.length === 0 ? <div className="empty">No races logged yet. <Link to="/log">Log your first one.</Link></div> : (
          <div style={{ display: 'grid', gap: 14 }}>
            {races.map(r => <RaceCard key={r.id} race={r} />)}
          </div>
        )}
      </div>
    </>
  );
}

function topBy(rows, key) {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => (b[key] || 0) - (a[key] || 0))[0];
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function RaceCard({ race }) {
  const fastestMs = race.results.reduce((acc, r) => (r.fastest_lap_ms != null && (acc == null || r.fastest_lap_ms < acc) ? r.fastest_lap_ms : acc), null);
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div className="row spread" style={{ marginBottom: 8 }}>
        <div>
          <strong>{race.track_name || race.track_name_override || 'Unknown track'}</strong>
          {race.track_discipline && <span className={`tag ${race.track_discipline}`} style={{ marginLeft: 8 }}>{race.track_discipline}</span>}
          {race.car_class && <span className="tag" style={{ marginLeft: 6 }}>{race.car_class}</span>}
        </div>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{formatDate(race.raced_at)}</span>
      </div>
      <div className="results-list">
        {race.results.map(r => (
          <div key={r.id} className={`result-row ${r.fastest_lap_ms === fastestMs && fastestMs ? 'fastest' : ''}`}>
            <span className={`pos ${r.dnf ? 'dnf' : `p${r.position}`}`}>{r.dnf ? 'DNF' : r.position}</span>
            <span className="driver"><span className="dot" style={{ background: r.color }} />{r.display_name}</span>
            <span className="lap">{formatLap(r.fastest_lap_ms)}</span>
            <span style={{ fontWeight: 600 }}>{r.points} pt</span>
          </div>
        ))}
      </div>
    </div>
  );
}
