import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

// All timestamps are epoch milliseconds (INTEGER) to keep time math trivial.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS regions (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id         TEXT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('choice', 'text')),
  prompt            TEXT NOT NULL,
  options           TEXT,     -- JSON array of 4 strings (choice only)
  correct_index     INTEGER,  -- 0..3 (choice only)
  accepted_answers  TEXT,     -- JSON array of accepted strings (text only)
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  CHECK (
    (type = 'choice' AND options IS NOT NULL AND correct_index BETWEEN 0 AND 3)
    OR (type = 'text' AND accepted_answers IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_questions_region ON questions(region_id);

CREATE TABLE IF NOT EXISTS game_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code   TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'active', 'finished')),
  created_at  INTEGER NOT NULL,
  started_at  INTEGER,
  ended_at    INTEGER
);

CREATE TABLE IF NOT EXISTS players (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  token        TEXT NOT NULL UNIQUE,  -- lets a player reconnect after a page reload
  joined_at    INTEGER NOT NULL,
  finished_at  INTEGER                -- set when all regions are resolved
);
CREATE INDEX IF NOT EXISTS idx_players_session ON players(session_id);

CREATE TABLE IF NOT EXISTS region_attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  region_id      TEXT NOT NULL REFERENCES regions(id),
  question_ids   TEXT NOT NULL,       -- JSON array: the 3 questions drawn for this player
  correct_count  INTEGER NOT NULL DEFAULT 0,
  wrong_count    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'green', 'red')),
  opened_at      INTEGER NOT NULL,
  resolved_at    INTEGER,
  UNIQUE (player_id, region_id)
);

CREATE TABLE IF NOT EXISTS answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id    INTEGER NOT NULL REFERENCES region_attempts(id) ON DELETE CASCADE,
  question_id   INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  given_answer  TEXT NOT NULL,
  is_correct    INTEGER NOT NULL,
  answered_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON answers(attempt_id);
`;

export type SqlParam = string | number | bigint | null | Uint8Array;

export interface Database {
  get<T>(sql: string, ...params: SqlParam[]): T | undefined;
  all<T>(sql: string, ...params: SqlParam[]): T[];
  run(sql: string, ...params: SqlParam[]): { changes: number; lastId: number };
  /** Runs fn inside a transaction (nested calls join the outer one). */
  tx<T>(fn: () => T): T;
  close(): void;
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const cache = new Map<string, StatementSync>();
  const stmt = (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  let depth = 0;

  return {
    get: <T>(sql: string, ...params: SqlParam[]) => stmt(sql).get(...params) as T | undefined,
    all: <T>(sql: string, ...params: SqlParam[]) => stmt(sql).all(...params) as T[],
    run(sql, ...params) {
      const r = stmt(sql).run(...params);
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    tx(fn) {
      if (depth > 0) return fn();
      db.exec('BEGIN IMMEDIATE');
      depth++;
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
  };
}
