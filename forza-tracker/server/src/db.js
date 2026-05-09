import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = resolve(__dirname, '..', 'db');
mkdirSync(dbDir, { recursive: true });

export const db = new Database(resolve(dbDir, 'forza.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL,
    gamertag TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#5b8def',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    point_system TEXT NOT NULL,
    fastest_lap_bonus INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    discipline TEXT NOT NULL,
    region TEXT,
    UNIQUE(name, discipline)
  );

  CREATE TABLE IF NOT EXISTS races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
    track_name_override TEXT,
    car_class TEXT,
    raced_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS race_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    fastest_lap_ms INTEGER,
    dnf INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    UNIQUE(race_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_results_user ON race_results(user_id);
  CREATE INDEX IF NOT EXISTS idx_results_race ON race_results(race_id);
  CREATE INDEX IF NOT EXISTS idx_races_season ON races(season_id);
`);
