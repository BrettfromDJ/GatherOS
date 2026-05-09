import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatDate, formatLap } from '../lib/format.js';
import PhotoGallery from '../components/PhotoGallery.jsx';

export default function Dashboard() {
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);
  const [standings, setStandings] = useState([]);
  const [teamStandings, setTeamStandings] = useState([]);
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
    api.teamStandings(seasonId).then(setTeamStandings);
    api.races({ season_id: seasonId, limit: 5 }).then(setRaces);
    api.records().then(setRecords);
  }, [seasonId]);

  const season = useMemo(() => seasons.find(s => s.id === seasonId), [seasons, seasonId]);
  const totalRaces = standings.reduce((acc, s) => Math.max(acc, s.races || 0), 0);
  const teamLeader = teamStandings[0];
  const indivLeader = standings[0];
  const teamGap = teamStandings.length === 2 ? teamStandings[0].points - teamStandings[1].points : 0;

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

      {teamStandings.length === 0 ? (
        <div className="notice" style={{ marginBottom: 18 }}>
          No teams set up yet for this season. <Link to="/teams">Configure teams →</Link>
        </div>
      ) : (
        <TeamHeadline teams={teamStandings} gap={teamGap} />
      )}

      <div className="grid four" style={{ marginBottom: 18 }}>
        <Stat label="Races this season" value={totalRaces} />
        <Stat label="Team in front" value={teamLeader?.name || '—'} sub={teamLeader ? `${teamLeader.points} team pts` : ''} accent={teamLeader?.color} />
        <Stat label="Individual leader" value={indivLeader?.display_name || '—'} sub={indivLeader ? `${indivLeader.points} pts` : ''} accent={indivLeader?.color} />
        <Stat label="Records held" value={records.length} sub="across all tracks" />
      </div>

      {teamStandings.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Team standings</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Team</th>
                <th>Drivers</th>
                <th className="num">Race wins</th>
                <th className="num">1-2 finishes</th>
                <th className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {teamStandings.map((t, i) => (
                <tr key={t.id}>
                  <td><span className={`pos p${i + 1}`}>{i + 1}</span></td>
                  <td>
                    <span className="driver">
                      <span className="dot" style={{ background: t.color, width: 14, height: 14 }} />
                      <strong>{t.name}</strong>
                    </span>
                  </td>
                  <td>
                    {t.members.map(m => (
                      <span key={m.id} className="driver" style={{ marginRight: 10 }}>
                        <span className="dot" style={{ background: m.color }} />{m.display_name}
                      </span>
                    ))}
                  </td>
                  <td className="num">{t.race_wins}</td>
                  <td className="num">{t.one_twos}</td>
                  <td className="num"><strong style={{ fontSize: 16 }}>{t.points}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <div className="row spread" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Individual standings</h2>
          <span className="badge"><span className="dot" style={{ background: 'var(--accent)' }} />Points: {(season?.point_system || []).join(' / ')} +{season?.fastest_lap_bonus || 0} FL</span>
        </div>
        {standings.length === 0 ? <div className="empty">No standings yet.</div> : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Driver</th>
                <th>Team</th>
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
                  <td>
                    {s.team_name && (
                      <span className="badge"><span className="dot" style={{ background: s.team_color }} />{s.team_name}</span>
                    )}
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

function TeamHeadline({ teams, gap }) {
  if (teams.length < 2) {
    const t = teams[0];
    return (
      <div className="panel" style={{ borderLeft: `4px solid ${t.color}`, marginBottom: 18 }}>
        <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Team in front</div>
        <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{t.name}</div>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t.points} pts</div>
      </div>
    );
  }
  const [a, b] = teams;
  const total = Math.max(a.points + b.points, 1);
  const aPct = (a.points / total) * 100;
  return (
    <div className="panel" style={{ marginBottom: 18, padding: '20px 22px' }}>
      <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        Season scoreboard
      </div>
      <div className="row spread" style={{ marginBottom: 12, alignItems: 'baseline' }}>
        <div>
          <span className="dot" style={{ background: a.color, width: 12, height: 12, display: 'inline-block', marginRight: 8 }} />
          <strong style={{ fontSize: 20 }}>{a.name}</strong>
          <span style={{ marginLeft: 10, fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{a.points}</span>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          {gap === 0 ? 'tied' : `${a.name} leads by ${Math.abs(gap)} pt${Math.abs(gap) === 1 ? '' : 's'}`}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ marginRight: 10, fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{b.points}</span>
          <strong style={{ fontSize: 20 }}>{b.name}</strong>
          <span className="dot" style={{ background: b.color, width: 12, height: 12, display: 'inline-block', marginLeft: 8 }} />
        </div>
      </div>
      <div style={{ height: 10, borderRadius: 6, overflow: 'hidden', display: 'flex', background: 'var(--panel-2)' }}>
        <div style={{ width: `${aPct}%`, background: a.color, transition: 'width 0.3s ease' }} />
        <div style={{ width: `${100 - aPct}%`, background: b.color, transition: 'width 0.3s ease' }} />
      </div>
      <div className="row spread" style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
        <div>Race wins: {a.race_wins} · 1-2s: {a.one_twos}</div>
        <div>Race wins: {b.race_wins} · 1-2s: {b.one_twos}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div className="stat" style={accent ? { borderTop: `2px solid ${accent}` } : undefined}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function RaceCard({ race }) {
  const [photos, setPhotos] = useState(race.photos || []);
  const fastestMs = race.results.reduce((acc, r) => (r.fastest_lap_ms != null && (acc == null || r.fastest_lap_ms < acc) ? r.fastest_lap_ms : acc), null);
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div className="row spread" style={{ marginBottom: 8 }}>
        <div>
          <strong>{race.track_name || race.track_name_override || 'Unknown track'}</strong>
          {race.track_discipline && <span className={`tag ${race.track_discipline}`} style={{ marginLeft: 8 }}>{race.track_discipline}</span>}
          {race.car_class && <span className="tag" style={{ marginLeft: 6 }}>{race.car_class}</span>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>{formatDate(race.raced_at)}</span>
          <Link to={`/log?rematch=${race.id}`}><button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }}>Rematch</button></Link>
        </div>
      </div>
      <div className="results-list">
        {race.results.map(r => (
          <div
            key={r.id}
            className={`result-row ${r.fastest_lap_ms === fastestMs && fastestMs ? 'fastest' : ''}`}
            style={r.team_color ? { borderLeft: `3px solid ${r.team_color}` } : undefined}
          >
            <span className={`pos ${r.dnf ? 'dnf' : `p${r.position}`}`}>{r.dnf ? 'DNF' : r.position}</span>
            <span className="driver">
              <span className="dot" style={{ background: r.color }} />{r.display_name}
              {r.team_name && <span className="badge" style={{ marginLeft: 8 }}><span className="dot" style={{ background: r.team_color }} />{r.team_name}</span>}
            </span>
            <span className="lap">{formatLap(r.fastest_lap_ms)}</span>
            <span style={{ fontWeight: 600 }}>{r.points} pt</span>
          </div>
        ))}
      </div>
      {photos.length > 0 && (
        <PhotoGallery raceId={race.id} photos={photos} canEdit={false} onChange={setPhotos} />
      )}
    </div>
  );
}
