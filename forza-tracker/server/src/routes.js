import { db } from './db.js';
import { applyResults } from './scoring.js';

const SHARED_PASSCODE = process.env.FORZA_PASSCODE || 'horizon';
const SESSION_COOKIE = 'forza_session';

function requireAuth(req, reply) {
  const userId = req.cookies?.[SESSION_COOKIE];
  if (!userId) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
  if (!user) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

export default async function routes(app) {
  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/auth/login', async (req, reply) => {
    const { userId, passcode } = req.body || {};
    if (passcode !== SHARED_PASSCODE) {
      return reply.code(403).send({ error: 'bad passcode' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
    if (!user) return reply.code(404).send({ error: 'user not found' });
    reply.setCookie(SESSION_COOKIE, String(user.id), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 90,
    });
    return { user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = requireAuth(req, reply);
    if (!user) return;
    return { user };
  });

  app.get('/api/users', async () => {
    return db.prepare('SELECT id, display_name, gamertag, color FROM users ORDER BY id').all();
  });

  app.post('/api/users', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const { display_name, gamertag, color } = req.body || {};
    if (!display_name || !gamertag) return reply.code(400).send({ error: 'missing fields' });
    const info = db.prepare(
      'INSERT INTO users (display_name, gamertag, color) VALUES (?, ?, ?)'
    ).run(display_name, gamertag, color || '#5b8def');
    return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  });

  app.patch('/api/users/:id', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const { display_name, gamertag, color } = req.body || {};
    db.prepare(
      `UPDATE users SET
        display_name = COALESCE(?, display_name),
        gamertag = COALESCE(?, gamertag),
        color = COALESCE(?, color)
       WHERE id = ?`
    ).run(display_name, gamertag, color, Number(req.params.id));
    return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  });

  app.get('/api/seasons', async () => {
    const rows = db.prepare('SELECT * FROM seasons ORDER BY start_date DESC').all();
    return rows.map(s => ({ ...s, point_system: JSON.parse(s.point_system) }));
  });

  app.post('/api/seasons', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const { name, start_date, end_date, point_system, fastest_lap_bonus } = req.body || {};
    if (!name || !start_date || !Array.isArray(point_system)) {
      return reply.code(400).send({ error: 'missing fields' });
    }
    const info = db.prepare(
      `INSERT INTO seasons (name, start_date, end_date, point_system, fastest_lap_bonus)
       VALUES (?, ?, ?, ?, ?)`
    ).run(name, start_date, end_date || null, JSON.stringify(point_system), fastest_lap_bonus ?? 1);
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(info.lastInsertRowid);
    return { ...season, point_system: JSON.parse(season.point_system) };
  });

  app.patch('/api/seasons/:id', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const { name, start_date, end_date, point_system, fastest_lap_bonus, status } = req.body || {};
    db.prepare(
      `UPDATE seasons SET
        name = COALESCE(?, name),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        point_system = COALESCE(?, point_system),
        fastest_lap_bonus = COALESCE(?, fastest_lap_bonus),
        status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      name,
      start_date,
      end_date,
      point_system ? JSON.stringify(point_system) : null,
      fastest_lap_bonus,
      status,
      Number(req.params.id)
    );
    if (point_system) {
      const races = db.prepare('SELECT id FROM races WHERE season_id = ?').all(Number(req.params.id));
      for (const r of races) applyResults(db, r.id);
    }
    const s = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
    return { ...s, point_system: JSON.parse(s.point_system) };
  });

  app.get('/api/seasons/:id/standings', async (req) => {
    const seasonId = Number(req.params.id);
    return db.prepare(`
      SELECT
        u.id AS user_id,
        u.display_name,
        u.gamertag,
        u.color,
        COUNT(rr.id) AS races,
        COALESCE(SUM(rr.points), 0) AS points,
        COALESCE(SUM(CASE WHEN rr.position = 1 AND rr.dnf = 0 THEN 1 ELSE 0 END), 0) AS wins,
        COALESCE(SUM(CASE WHEN rr.position <= 2 AND rr.dnf = 0 THEN 1 ELSE 0 END), 0) AS podiums,
        COALESCE(SUM(rr.dnf), 0) AS dnfs
      FROM users u
      LEFT JOIN race_results rr ON rr.user_id = u.id
      LEFT JOIN races r ON r.id = rr.race_id AND r.season_id = ?
      GROUP BY u.id
      ORDER BY points DESC, wins DESC, podiums DESC, races ASC
    `).all(seasonId);
  });

  app.get('/api/tracks', async () => {
    return db.prepare('SELECT * FROM tracks ORDER BY name').all();
  });

  app.post('/api/tracks', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const { name, discipline, region } = req.body || {};
    if (!name || !discipline) return reply.code(400).send({ error: 'missing fields' });
    try {
      const info = db.prepare(
        'INSERT INTO tracks (name, discipline, region) VALUES (?, ?, ?)'
      ).run(name, discipline, region || null);
      return db.prepare('SELECT * FROM tracks WHERE id = ?').get(info.lastInsertRowid);
    } catch (e) {
      return reply.code(409).send({ error: 'track exists' });
    }
  });

  app.get('/api/races', async (req) => {
    const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
    const sql = `
      SELECT r.*, t.name AS track_name, t.discipline AS track_discipline
      FROM races r
      LEFT JOIN tracks t ON t.id = r.track_id
      ${seasonId ? 'WHERE r.season_id = ?' : ''}
      ORDER BY r.raced_at DESC
      LIMIT ?
    `;
    const rows = seasonId
      ? db.prepare(sql).all(seasonId, limit)
      : db.prepare(sql).all(limit);
    const results = db.prepare(`
      SELECT rr.*, u.display_name, u.gamertag, u.color
      FROM race_results rr
      JOIN users u ON u.id = rr.user_id
      WHERE rr.race_id = ?
      ORDER BY rr.position ASC
    `);
    return rows.map(r => ({ ...r, results: results.all(r.id) }));
  });

  app.post('/api/races', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    const {
      season_id,
      track_id,
      track_name_override,
      car_class,
      raced_at,
      notes,
      results,
    } = req.body || {};
    if (!season_id || !Array.isArray(results) || results.length === 0) {
      return reply.code(400).send({ error: 'missing fields' });
    }

    // Crew-race guardrail: only log races where every driver in the roster
    // raced. No solo runs, no 3-of-4 sessions. Absent drivers must be marked
    // DNF if you really want to log; the canonical case is all 4 racing.
    const roster = db.prepare('SELECT id FROM users ORDER BY id').all().map(u => u.id);
    const submitted = results.map(r => r.user_id).sort((a, b) => a - b);
    const expected = [...roster].sort((a, b) => a - b);
    const sameSet = submitted.length === expected.length && submitted.every((id, i) => id === expected[i]);
    if (!sameSet) {
      return reply.code(400).send({
        error: 'crew_race_required',
        message: 'A race must include every driver in the roster. Solo or partial-crew runs are not tracked.',
      });
    }
    const finishingPositions = results.filter(r => !r.dnf).map(r => r.position).sort((a, b) => a - b);
    const expectedPositions = finishingPositions.map((_, i) => i + 1);
    if (finishingPositions.length === 0 || finishingPositions.join(',') !== expectedPositions.join(',')) {
      return reply.code(400).send({
        error: 'bad_positions',
        message: 'Finishing positions must be 1..N with no gaps. DNFs are separate.',
      });
    }

    const insertRace = db.prepare(`
      INSERT INTO races (season_id, track_id, track_name_override, car_class, raced_at, notes, source, created_by)
      VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?, 'manual', ?)
    `);
    const insertResult = db.prepare(`
      INSERT INTO race_results (race_id, user_id, position, fastest_lap_ms, dnf, points)
      VALUES (?, ?, ?, ?, ?, 0)
    `);
    const tx = db.transaction(() => {
      const info = insertRace.run(
        season_id,
        track_id || null,
        track_name_override || null,
        car_class || null,
        raced_at || null,
        notes || null,
        me.id
      );
      const raceId = info.lastInsertRowid;
      for (const r of results) {
        insertResult.run(raceId, r.user_id, r.position, r.fastest_lap_ms ?? null, r.dnf ? 1 : 0);
      }
      return raceId;
    });
    const raceId = tx();
    applyResults(db, raceId);
    return { id: raceId };
  });

  app.delete('/api/races/:id', async (req, reply) => {
    const me = requireAuth(req, reply);
    if (!me) return;
    db.prepare('DELETE FROM races WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  });

  app.get('/api/stats/records', async () => {
    return db.prepare(`
      SELECT
        COALESCE(t.name, r.track_name_override) AS track,
        t.discipline AS discipline,
        u.display_name,
        u.color,
        MIN(rr.fastest_lap_ms) AS best_ms
      FROM race_results rr
      JOIN races r ON r.id = rr.race_id
      JOIN users u ON u.id = rr.user_id
      LEFT JOIN tracks t ON t.id = r.track_id
      WHERE rr.fastest_lap_ms IS NOT NULL
      GROUP BY track, discipline
      ORDER BY track ASC
    `).all();
  });
}
