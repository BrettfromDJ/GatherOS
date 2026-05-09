export function computePoints({ position, dnf, fastestLap, pointSystem, fastestLapBonus }) {
  if (dnf) return 0;
  const base = pointSystem[position - 1] ?? 0;
  return base + (fastestLap ? fastestLapBonus : 0);
}

export function applyResults(db, raceId) {
  const race = db.prepare('SELECT season_id FROM races WHERE id = ?').get(raceId);
  if (!race) return;
  const season = db.prepare('SELECT point_system, fastest_lap_bonus FROM seasons WHERE id = ?').get(race.season_id);
  const pointSystem = JSON.parse(season.point_system);
  const fastestLapBonus = season.fastest_lap_bonus;

  const results = db.prepare(
    'SELECT id, user_id, position, dnf, fastest_lap_ms FROM race_results WHERE race_id = ? ORDER BY position ASC'
  ).all(raceId);

  let fastestUserId = null;
  let fastestMs = Infinity;
  for (const r of results) {
    if (!r.dnf && r.fastest_lap_ms != null && r.fastest_lap_ms < fastestMs) {
      fastestMs = r.fastest_lap_ms;
      fastestUserId = r.user_id;
    }
  }

  const update = db.prepare('UPDATE race_results SET points = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const r of results) {
      const points = computePoints({
        position: r.position,
        dnf: !!r.dnf,
        fastestLap: r.user_id === fastestUserId,
        pointSystem,
        fastestLapBonus,
      });
      update.run(points, r.id);
    }
  });
  tx();
}
