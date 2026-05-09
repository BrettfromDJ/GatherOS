import { db } from './db.js';

const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const insertUser = db.prepare(
    'INSERT INTO users (display_name, gamertag, color) VALUES (?, ?, ?)'
  );
  insertUser.run('Driver 1', 'DRIVER01', '#5b8def');
  insertUser.run('Driver 2', 'DRIVER02', '#e26d5c');
  insertUser.run('Driver 3', 'DRIVER03', '#7bc950');
  insertUser.run('Driver 4', 'DRIVER04', '#c084fc');
  console.log('seeded 4 placeholder drivers — edit them in the Roster screen');
}

const seasonCount = db.prepare('SELECT COUNT(*) AS n FROM seasons').get().n;
if (seasonCount === 0) {
  db.prepare(`
    INSERT INTO seasons (name, start_date, point_system, fastest_lap_bonus, status)
    VALUES (?, ?, ?, ?, 'active')
  `).run('Season 1 — Horizon Japan', '2026-05-19', JSON.stringify([10, 6, 3, 1]), 1);
  console.log('seeded Season 1 — Horizon Japan');
}

const trackCount = db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n;
if (trackCount === 0) {
  const t = db.prepare('INSERT INTO tracks (name, discipline, region) VALUES (?, ?, ?)');
  t.run('Mt. Fuji Hillclimb', 'road', 'Honshu');
  t.run('Tokyo Bay Sprint', 'street', 'Tokyo');
  t.run('Hakone Touge', 'road', 'Honshu');
  t.run('Hokkaido Rally Stage', 'dirt', 'Hokkaido');
  t.run('Okinawa Coast Cross-Country', 'cross-country', 'Okinawa');
  console.log('seeded 5 placeholder tracks');
}

console.log('done');
process.exit(0);
