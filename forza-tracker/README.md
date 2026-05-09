# Forza Tracker

A private racing tracker for a 4-person crew playing Forza Horizon 6. Manual race entry now; designed so a Data Out telemetry ingestor can drop in later without touching the schema or UI shell.

## What it does today

- Single-shared web app, 4 logins protected by a shared crew passcode
- Dashboard: season standings, recent races, fastest-lap leaders, headline stats
- Manual race entry: drag-rank finishing order, optional fastest lap times, DNF
- Seasons: configurable point system (defaults `[10, 6, 3, 1]` plus `+1` for fastest lap), preset packs included
- Records book: crew-best lap per track per discipline
- Roster admin: change names, gamertags, colors

## Stack

- Server: Node + Fastify + better-sqlite3 (single SQLite file)
- Client: React + Vite + react-router
- Data: file at `server/db/forza.sqlite` (gitignored)

## Setup

```sh
cd forza-tracker
npm install                 # installs both workspaces
npm run seed --workspace server   # creates 4 placeholder drivers + Season 1 + sample tracks
```

In two terminals:

```sh
npm run dev:server     # http://localhost:4317
npm run dev:client     # http://localhost:5173 (Vite proxies /api to the server)
```

For "production" (running on a home server / one of your machines):

```sh
npm run build          # builds the client into client/dist
FORZA_PASSCODE=somethingyoulike npm run start
```

The server will serve the built client from `client/dist` if it exists, so the whole thing is one process on one port.

## Configuration

| Env var | Default | Notes |
|---|---|---|
| `PORT` | `4317` | HTTP port |
| `HOST` | `0.0.0.0` | bind address |
| `FORZA_PASSCODE` | `horizon` | shared passcode all four of you type at login |
| `FORZA_COOKIE_SECRET` | dev secret | set this to a real random string for "real" deployment |

## On the Forza Horizon 6 API question

There is **no official public API** for Forza Horizon 6 (or any prior Forza). The Developer Direct FAQ doesn't mention one. What does exist:

1. **Data Out UDP telemetry** — every Forza since FM7 ships a built-in feature that fires UDP packets at 60 Hz to a configured IP/port. Speed, RPM, position, lap/race times, ~80 fields. Each player toggles it on in HUD settings and points it at this server. This is the realistic path to automated capture for FH6 once the format is confirmed.
2. **XAPI (xapi.us)** — unofficial Xbox Live API. Useful for presence ("now playing FH6") and achievements. Doesn't give race-level data.
3. **Screenshot OCR** of post-race result screens — works as a manual-but-low-effort middle path.

## Crew-only rule

Only races where **all four drivers raced together** get tracked. Solo runs, 2-player rolls, 3-of-4 nights — none of it. The server enforces this on every race write: every roster driver must have a `race_results` row, and finishing positions must be `1..N` with no gaps. A driver who was in the lobby but crashed out gets marked DNF; a driver who wasn't online means you don't log the race at all.

## How Data Out will plug in (deferred)

The schema is already shaped for it: `races.source` defaults to `'manual'` and will become `'data_out'` for ingested races. To add the listener:

1. Add a UDP socket process (Node's `dgram`) that binds to the port each player has configured in-game (default 5685).
2. Map incoming packets to a per-player session (driver identified by sender IP, configured in roster).
3. Detect race start/end from the `IsRaceOn` flag, derive finishing order and per-driver best lap from accumulated packets.
4. **Apply the crew-only gate**: only persist a race if the dashboard's "crew session" toggle is on AND telemetry packets from all four drivers overlapped during that race window. This is the automated equivalent of the manual rule above — no random solo runs sneak in.
5. Insert a `races` row with `source='data_out'` and call the same `applyResults()` to compute points.

The "crew session" toggle is a future Dashboard control: tap it at the start of a session, tap it again when you're done. Telemetry arriving outside that window is dropped.

References:
- FH5 packet format: <https://github.com/raweceek-temeletry/forza-horizon-5-UDP>
- Multi-game telemetry recorder: <https://github.com/austinbaccus/forza-telemetry>
- Go reference parser: <https://pkg.go.dev/github.com/csutorasa/go-forza-telemetry>

## Future ideas (parking lot)

- ELO per discipline (road / dirt / cross-country / drift)
- Weekly bingo / bounty board
- Photo gallery from CoLab/EventLab events with crew voting
- Discord webhook on every saved race (auto-generated trash talk)
- Convoy session detection via XAPI presence
