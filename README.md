# Map of Ukraine — multiplayer quiz

Real-time educational quiz: players conquer 25 regions of Ukraine (24 oblasts + ARC) by answering questions.

## Structure

```
map-of-ukraine/
├── shared/types.ts          # types shared by server & client (REST DTOs + typed Socket.io events)
├── server/                  # Node.js + Express 5 + Socket.io + SQLite (node:sqlite)
│   ├── src/
│   │   ├── index.ts         # entry: open DB, seed, listen
│   │   ├── app.ts           # builds Express app + Socket.io server (used by tests too)
│   │   ├── config.ts        # env config
│   │   ├── validation.ts    # zod schemas (Ukrainian error messages)
│   │   ├── db/              # schema, seed data (75 questions), seed CLI
│   │   ├── domain/          # rules.ts (pure logic), game.ts (GameService), questions.ts (CRUD repo)
│   │   ├── http/            # auth, public & admin routes, error handler
│   │   └── socket/          # real-time event handlers
│   └── test/                # node:test — rules, game service, end-to-end sockets
└── client/                  # React 19 + TS + Vite + Tailwind 4
    ├── scripts/build-geometry.mjs  # GeoJSON → pre-projected polygons for the map
    └── src/
        ├── map/             # UkraineMap (Canvas, Path2D hit-testing), generated geometry.ts
        ├── components/      # QuestionModal, Podium/Leaderboard, UI bits
        ├── pages/           # Home, Join, Play (lobby → map → results), Admin*
        └── lib/             # REST client, typed socket requests, storage, formatting
```

## Running

Requires Node ≥ 22.18 (runs TypeScript natively; no build step for the server).

```bash
npm install
cp server/.env.example server/.env   # set ADMIN_PASSWORD, PUBLIC_URL
npm run dev:server                    # API + sockets on http://localhost:3000
npm run dev:client                    # UI on http://localhost:5173 (proxies /api and /socket.io)
npm test
```

- Players: open `/`, enter the room code, or scan the QR code.
- Admin: `/admin` → «Гра» (create room, QR, start / force end, live progress) and «Питання» (CRUD).
- For phones to open the QR link, set `PUBLIC_URL` to your machine's LAN address (e.g. `http://192.168.1.20:5173`) — Vite listens on all interfaces.

**Production:** `npm run build` then `npm start` — the server serves `client/dist` on the same port (set `PUBLIC_URL` to that address).

**Map data:** region boundaries from [geoBoundaries](https://www.geoboundaries.org) (© OpenStreetMap contributors, ODbL 1.0), converted with `npm run geometry -w client -- <file.geojson>`. Kyiv and Sevastopol are drawn but not playable (the game has 25 regions).

## Database schema

| Table | Purpose |
|---|---|
| `regions` | 25 fixed regions (`id` slug, Ukrainian `name`, `sort_order`) |
| `questions` | `type` = `choice` (4 `options` + `correct_index`) or `text` (`accepted_answers` JSON list) |
| `game_sessions` | room code, `status` lobby → active → finished, `started_at`, `ended_at` |
| `players` | first/last name, reconnect `token`, `finished_at` |
| `region_attempts` | one per player×region: the 3 drawn `question_ids`, correct/wrong counters, `status` in_progress/green/red |
| `answers` | audit log of every submitted answer |

Timestamps are epoch milliseconds. The DB is the source of truth; game rules are enforced server-side and correct answers are never sent to players before they answer.

## Game rules (server-enforced)

- Each region: best of 3. **2 correct → green**, **2 wrong → red**, 1:1 → tie-breaker question.
- Text answers: case-insensitive, trimmed, whitespace/punctuation-tolerant, all apostrophe variants (`' ’ ʼ`) treated as equal; multiple accepted answers allowed.
- Time = from admin "Start" to the player's last resolved region (or to force end).
- Ranking: most correct answers ↓, then shortest time ↑; exact ties share a rank.
- The game ends automatically when every player finishes, or when the admin forces the end.

## REST API

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/api/regions` | — | list of regions |
| GET | `/api/sessions/:code` | — | room status (for the join page) |
| GET | `/api/sessions/:code/results` | — | final ranking |
| POST | `/api/admin/login` | — | `{ password }` → `{ token }` |
| GET/POST | `/api/admin/questions` | Bearer | list (`?regionId=`) / create |
| GET/PUT/DELETE | `/api/admin/questions/:id` | Bearer | read / update / delete |
| GET | `/api/admin/questions/counts` | Bearer | number of questions per region |
| GET/POST | `/api/admin/sessions` | Bearer | recent rooms / create room → `{ session, joinUrl, qrCode }` |

## Socket.io events

Every client → server event takes an ack callback: `{ ok: true, data } | { ok: false, error }`.
Admin sockets connect with `auth: { adminToken }`.

| Client → server | Response |
|---|---|
| `player:join { roomCode, firstName, lastName }` | `{ token, state }` — store `token` in localStorage |
| `player:resume { token }` | `PlayerState` (after reload / reconnect) |
| `region:open { regionId }` | current `PublicQuestion` |
| `region:answer { regionId, questionId, answer }` | `AnswerResult` (correctness, correct answer, region status, next question) |
| `admin:watch { roomCode }` | `AdminSnapshot` |
| `admin:start { roomCode }` | `SessionInfo` |
| `admin:end { roomCode }` | final `ResultRow[]` |

| Server → client | Sent to |
|---|---|
| `lobby:players` | players + admin of the room |
| `game:started` | players + admin |
| `admin:progress` | admin (live scoreboard) |
| `game:ended` | players + admin |
