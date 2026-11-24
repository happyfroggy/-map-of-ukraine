import { randomBytes, randomInt } from 'node:crypto';
import type {
  AdminSnapshot,
  AnswerResult,
  PlayerProgress,
  PlayerState,
  PublicPlayer,
  PublicQuestion,
  Region,
  RegionStatus,
  ResultRow,
  SessionInfo,
  SessionStatus,
} from '../../../shared/types.ts';
import type { Database, Queryable } from '../db/database.ts';
import { GameError } from './errors.ts';
import { QuestionRepo, displayAnswer, parseJsonArray } from './questions.ts';
import {
  DRONES_PER_REGION,
  QUESTIONS_PER_REGION,
  dronesLeft,
  isAnswerCorrect,
  optionOrder,
  rankResults,
  regionStatus,
} from './rules.ts';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const ROOM_CODE_LENGTH = 6;

export interface SessionRow {
  id: number;
  room_code: string;
  status: SessionStatus;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

export interface PlayerRow {
  id: number;
  session_id: number;
  first_name: string;
  last_name: string;
  token: string;
  joined_at: number;
  finished_at: number | null;
}

/** One row per player × region. correct_count = drones shot down, wrong_count = mistakes. */
interface AttemptRow {
  id: number;
  player_id: number;
  region_id: string;
  correct_count: number;
  wrong_count: number;
  status: RegionStatus;
  current_question_id: number | null;
  opened_at: number;
  resolved_at: number | null;
}

const toPublicPlayer = (p: PlayerRow): PublicPlayer => ({ id: p.id, firstName: p.first_name, lastName: p.last_name });
const nameKey = (s: string) => s.trim().toLocaleLowerCase('uk-UA');
const forUpdate = (lock: boolean) => (lock ? ' FOR UPDATE' : '');

/**
 * Authoritative game logic; the database is the single source of truth.
 * State changes run in transactions and lock the rows they modify (FOR UPDATE),
 * so concurrent requests (double clicks, simultaneous finishes) stay consistent.
 * Helpers take a `q` so they can run inside a caller's transaction.
 */
export class GameService {
  db: Database;
  questions: QuestionRepo;

  constructor(db: Database) {
    this.db = db;
    this.questions = new QuestionRepo(db);
  }

  // ---------- regions ----------

  regions(q: Queryable = this.db): Promise<Region[]> {
    return q.all<Region>('SELECT id, name FROM regions ORDER BY sort_order');
  }

  async regionCount(q: Queryable = this.db): Promise<number> {
    return (await q.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM regions'))!.n;
  }

  // ---------- sessions ----------

  async createSession(now = Date.now()): Promise<SessionRow> {
    for (let i = 0; i < 20; i++) {
      const code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
      const row = await this.db.get<SessionRow>(
        'INSERT INTO game_sessions (room_code, created_at) VALUES ($1, $2) ON CONFLICT (room_code) DO NOTHING RETURNING *',
        code, now,
      );
      if (row) return row;
    }
    throw new Error('Could not generate a unique room code');
  }

  findSessionByCode(code: string, q: Queryable = this.db, lock = false): Promise<SessionRow | undefined> {
    return q.get<SessionRow>(`SELECT * FROM game_sessions WHERE room_code = $1${forUpdate(lock)}`, code.trim().toUpperCase());
  }

  async getSessionByCode(code: string, q: Queryable = this.db, lock = false): Promise<SessionRow> {
    const s = await this.findSessionByCode(code, q, lock);
    if (!s) throw new GameError('Кімнату не знайдено', 404);
    return s;
  }

  async getSessionById(id: number, q: Queryable = this.db, lock = false): Promise<SessionRow> {
    const s = await q.get<SessionRow>(`SELECT * FROM game_sessions WHERE id = $1${forUpdate(lock)}`, id);
    if (!s) throw new GameError('Кімнату не знайдено', 404);
    return s;
  }

  async listSessions(limit = 20): Promise<(SessionInfo & { playerCount: number; createdAt: number })[]> {
    const rows = await this.db.all<SessionRow & { player_count: number }>(
      `SELECT s.*, (SELECT COUNT(*)::int FROM players p WHERE p.session_id = s.id) AS player_count
       FROM game_sessions s ORDER BY s.id DESC LIMIT $1`,
      limit,
    );
    return rows.map((s) => ({ ...this.sessionInfo(s), playerCount: s.player_count, createdAt: s.created_at }));
  }

  sessionInfo(s: SessionRow): SessionInfo {
    return { roomCode: s.room_code, status: s.status, startedAt: s.started_at, endedAt: s.ended_at };
  }

  /** Starts the game for everyone in the room; returns the updated session. */
  startSession(sessionId: number, now = Date.now()): Promise<SessionInfo> {
    return this.db.tx(async (q) => {
      const session = await this.getSessionById(sessionId, q, true);
      if (session.status !== 'lobby') throw new GameError('Гру вже розпочато або завершено', 409);
      if ((await this.listPlayers(sessionId, q)).length === 0) throw new GameError('У кімнаті ще немає гравців', 409);

      const lacking = (await this.questions.countsByRegion(q)).filter((r) => r.count < QUESTIONS_PER_REGION);
      if (lacking.length) {
        throw new GameError(
          `Недостатньо питань (потрібно ${QUESTIONS_PER_REGION} — по одному на дрон) для регіонів: ${lacking.map((r) => r.name).join(', ')}`,
          409,
        );
      }
      const row = await q.get<SessionRow>(
        "UPDATE game_sessions SET status = 'active', started_at = $1 WHERE id = $2 RETURNING *",
        now, sessionId,
      );
      return this.sessionInfo(row!);
    });
  }

  /**
   * Ends the game (idempotent) and returns the final ranking.
   * `ended` is true only for the call that actually finished it.
   */
  endSession(sessionId: number, now = Date.now()): Promise<{ results: ResultRow[]; ended: boolean }> {
    return this.db.tx(async (q) => {
      const session = await this.getSessionById(sessionId, q, true);
      if (session.status === 'lobby') throw new GameError('Гру ще не розпочато', 409);
      const ended = session.status === 'active';
      if (ended) await q.run("UPDATE game_sessions SET status = 'finished', ended_at = $1 WHERE id = $2", now, sessionId);
      return { results: await this.results(sessionId, now, q), ended };
    });
  }

  // ---------- players ----------

  /**
   * Adds a player to a room in the lobby. Re-joining with the same name returns
   * the existing player (e.g. after losing the token by clearing the browser).
   */
  joinPlayer(roomCode: string, firstName: string, lastName: string, now = Date.now()): Promise<PlayerRow> {
    return this.db.tx(async (q) => {
      // Locking the session serializes joins with each other and with "start".
      const session = await this.getSessionByCode(roomCode, q, true);
      if (session.status !== 'lobby') throw new GameError('Гра вже розпочалася — приєднатися неможливо', 409);

      const existing = (await q.all<PlayerRow>('SELECT * FROM players WHERE session_id = $1', session.id)).find(
        (p) => nameKey(p.first_name) === nameKey(firstName) && nameKey(p.last_name) === nameKey(lastName),
      );
      if (existing) return existing;

      const row = await q.get<PlayerRow>(
        'INSERT INTO players (session_id, first_name, last_name, token, joined_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        session.id, firstName.trim(), lastName.trim(), randomBytes(24).toString('base64url'), now,
      );
      return row!;
    });
  }

  async getPlayerById(id: number, q: Queryable = this.db): Promise<PlayerRow> {
    const p = await q.get<PlayerRow>('SELECT * FROM players WHERE id = $1', id);
    if (!p) throw new GameError('Гравця не знайдено', 404);
    return p;
  }

  async getPlayerByToken(token: string): Promise<PlayerRow> {
    const p = await this.db.get<PlayerRow>('SELECT * FROM players WHERE token = $1', token);
    if (!p) throw new GameError('Сесію гравця не знайдено — приєднайтеся знову', 404);
    return p;
  }

  async listPlayers(sessionId: number, q: Queryable = this.db): Promise<PublicPlayer[]> {
    const rows = await q.all<PlayerRow>('SELECT * FROM players WHERE session_id = $1 ORDER BY joined_at, id', sessionId);
    return rows.map(toPublicPlayer);
  }

  // ---------- gameplay: drones ----------

  /** Opens a region and returns the question of its next drone (resuming the one already shown). */
  openRegion(playerId: number, regionId: string, now = Date.now()): Promise<PublicQuestion> {
    return this.db.tx(async (q) => {
      const player = await this.getPlayerById(playerId, q);
      await this.assertActive(player.session_id, q);
      if (!(await q.get('SELECT 1 FROM regions WHERE id = $1', regionId))) throw new GameError('Невідомий регіон');

      await q.run(
        `INSERT INTO region_attempts (player_id, region_id, question_ids, opened_at) VALUES ($1, $2, '[]', $3)
         ON CONFLICT (player_id, region_id) DO NOTHING`,
        playerId, regionId, now,
      );
      let attempt = (await this.getAttempt(playerId, regionId, q, true))!;
      if (attempt.status === 'green') throw new GameError('У цьому регіоні вже збито всі дрони', 409);

      if (attempt.current_question_id === null || !(await this.questions.getRow(attempt.current_question_id, q))) {
        attempt = await this.assignNextQuestion(attempt, null, q);
      }
      return this.publicQuestion(attempt, q);
    });
  }

  /** Answers the current drone's question: correct shoots it down, wrong keeps it with a different question. */
  answer(playerId: number, regionId: string, questionId: number, given: number | string, now = Date.now()): Promise<AnswerResult> {
    return this.db.tx(async (q) => {
      const player = await this.getPlayerById(playerId, q);
      await this.assertActive(player.session_id, q);

      const attempt = await this.getAttempt(playerId, regionId, q, true);
      if (!attempt) throw new GameError('Спершу відкрийте регіон');
      // Guards against double submits / stale clients answering an old question.
      if (attempt.status === 'green' || attempt.current_question_id !== questionId) {
        throw new GameError('Це питання вже неактуальне', 409);
      }

      const question = await this.questions.getRow(questionId, q);
      if (!question) throw new GameError('Питання не знайдено (можливо, його видалено)', 409);

      // Choice answers arrive as the displayed (per-player shuffled) position.
      let answer = given;
      if (question.type === 'choice') {
        if (typeof given !== 'number') throw new GameError('Оберіть один із варіантів');
        answer = (await this.choiceOrder(attempt, questionId, q))[given] ?? -1;
      }
      const correct = isAnswerCorrect(
        { type: question.type, correctIndex: question.correct_index, acceptedAnswers: parseJsonArray(question.accepted_answers) },
        answer,
      );
      await q.run(
        'INSERT INTO answers (attempt_id, question_id, given_answer, is_correct, answered_at) VALUES ($1, $2, $3, $4, $5)',
        attempt.id, questionId, String(answer), correct, now,
      );

      const shot = attempt.correct_count + (correct ? 1 : 0);
      const status = regionStatus(shot);
      let updated = (await q.get<AttemptRow>(
        `UPDATE region_attempts
         SET correct_count = $1, wrong_count = wrong_count + $2, status = $3, resolved_at = $4,
             current_question_id = NULL
         WHERE id = $5 RETURNING *`,
        shot, correct ? 0 : 1, status, status === 'green' ? now : null, attempt.id,
      ))!;

      let nextQuestion: PublicQuestion | null = null;
      if (status !== 'green') {
        updated = await this.assignNextQuestion(updated, questionId, q);
        nextQuestion = await this.publicQuestion(updated, q);
      }

      // A player finishes once every region is cleared of drones.
      let playerFinished = false;
      if (status === 'green') {
        const cleared = (await q.get<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM region_attempts WHERE player_id = $1 AND status = 'green'",
          playerId,
        ))!.n;
        if (cleared >= (await this.regionCount(q))) {
          await q.run('UPDATE players SET finished_at = $1 WHERE id = $2', now, playerId);
          playerFinished = true;
        }
      }

      return {
        correct,
        correctAnswer: displayAnswer(question),
        dronesLeft: dronesLeft(shot),
        regionCleared: status === 'green',
        nextQuestion,
        playerFinished,
      };
    });
  }

  /**
   * Picks the question for the next drone: never one already answered correctly,
   * preferring questions this player hasn't seen, then the least-asked ones,
   * and avoiding the question just answered wrong when there is any alternative.
   */
  private async assignNextQuestion(attempt: AttemptRow, justAsked: number | null, q: Queryable): Promise<AttemptRow> {
    const pick = (excludeJustAsked: boolean) =>
      q.get<{ id: number }>(
        `SELECT qq.id FROM questions qq
         WHERE qq.region_id = $1
           AND qq.id NOT IN (SELECT question_id FROM answers WHERE attempt_id = $2 AND is_correct AND question_id IS NOT NULL)
           AND (NOT $4::boolean OR qq.id <> $3::int)
         ORDER BY (SELECT COUNT(*) FROM answers a WHERE a.attempt_id = $2 AND a.question_id = qq.id), RANDOM()
         LIMIT 1`,
        attempt.region_id, attempt.id, justAsked, excludeJustAsked,
      );
    const next = (justAsked !== null ? await pick(true) : undefined) ?? (await pick(false));
    if (!next) throw new GameError('Для цього регіону недостатньо питань', 409);
    return (await q.get<AttemptRow>(
      'UPDATE region_attempts SET current_question_id = $1 WHERE id = $2 RETURNING *',
      next.id, attempt.id,
    ))!;
  }

  async allPlayersFinished(sessionId: number): Promise<boolean> {
    const r = (await this.db.get<{ total: number; unfinished: number }>(
      `SELECT COUNT(*)::int AS total, (COUNT(*) FILTER (WHERE finished_at IS NULL))::int AS unfinished
       FROM players WHERE session_id = $1`,
      sessionId,
    ))!;
    return r.total > 0 && r.unfinished === 0;
  }

  // ---------- read models ----------

  async progress(sessionId: number, q: Queryable = this.db): Promise<PlayerProgress[]> {
    const rows = await q.all<{ id: number; first_name: string; last_name: string; finished_at: number | null; shot: number; green: number; mistakes: number }>(
      `SELECT p.id, p.first_name, p.last_name, p.finished_at,
              COALESCE(SUM(a.correct_count), 0)::int                  AS shot,
              (COUNT(a.id) FILTER (WHERE a.status = 'green'))::int    AS green,
              COALESCE(SUM(a.wrong_count), 0)::int                    AS mistakes
       FROM players p LEFT JOIN region_attempts a ON a.player_id = p.id
       WHERE p.session_id = $1
       GROUP BY p.id ORDER BY p.joined_at, p.id`,
      sessionId,
    );
    return rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      correctAnswers: r.shot,
      greenRegions: r.green,
      mistakes: r.mistakes,
      finishedAt: r.finished_at,
    }));
  }

  async results(sessionId: number, now = Date.now(), q: Queryable = this.db): Promise<ResultRow[]> {
    const session = await this.getSessionById(sessionId, q);
    const startedAt = session.started_at ?? now;
    return rankResults(
      (await this.progress(sessionId, q)).map(({ finishedAt, ...p }) => ({
        ...p,
        timeMs: Math.max(0, (finishedAt ?? session.ended_at ?? now) - startedAt),
        finished: finishedAt !== null,
      })),
    );
  }

  async playerState(playerId: number): Promise<PlayerState> {
    const player = await this.getPlayerById(playerId);
    const session = await this.getSessionById(player.session_id);
    const drones: Record<string, number> = {};
    let mistakes = 0;
    for (const a of await this.db.all<AttemptRow>('SELECT * FROM region_attempts WHERE player_id = $1', playerId)) {
      drones[a.region_id] = a.status === 'green' ? 0 : dronesLeft(a.correct_count);
      mistakes += a.wrong_count;
    }
    return {
      player: toPublicPlayer(player),
      session: this.sessionInfo(session),
      drones,
      dronesPerRegion: DRONES_PER_REGION,
      mistakes,
      finishedAt: player.finished_at,
      results: session.status === 'finished' ? await this.results(session.id) : null,
      serverNow: Date.now(),
    };
  }

  async adminSnapshot(sessionId: number): Promise<AdminSnapshot> {
    const session = await this.getSessionById(sessionId);
    return {
      session: this.sessionInfo(session),
      players: await this.progress(sessionId),
      totalRegions: await this.regionCount(),
      dronesPerRegion: DRONES_PER_REGION,
      results: session.status === 'finished' ? await this.results(sessionId) : null,
    };
  }

  // ---------- helpers ----------

  private async assertActive(sessionId: number, q: Queryable): Promise<void> {
    const s = await this.getSessionById(sessionId, q);
    if (s.status === 'lobby') throw new GameError('Гра ще не розпочалася', 409);
    if (s.status === 'finished') throw new GameError('Гру завершено', 409);
  }

  private getAttempt(playerId: number, regionId: string, q: Queryable, lock = false): Promise<AttemptRow | undefined> {
    return q.get<AttemptRow>(
      `SELECT * FROM region_attempts WHERE player_id = $1 AND region_id = $2${forUpdate(lock)}`,
      playerId, regionId,
    );
  }

  /**
   * Per-player option order for a choice question. It changes each time the same
   * question comes back (after a mistake) but stays stable while it is on screen.
   */
  private async choiceOrder(attempt: AttemptRow, questionId: number, q: Queryable): Promise<number[]> {
    const asked = (await q.get<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM answers WHERE attempt_id = $1 AND question_id = $2',
      attempt.id, questionId,
    ))!.n;
    return optionOrder(`${attempt.id}:${questionId}:${asked}`, 4);
  }

  private async publicQuestion(attempt: AttemptRow, q: Queryable): Promise<PublicQuestion> {
    const row = attempt.current_question_id === null ? undefined : await this.questions.getRow(attempt.current_question_id, q);
    if (!row) throw new GameError('Питання не знайдено (можливо, його видалено)', 409);
    let options: string[] | null = null;
    if (row.type === 'choice') {
      const stored = parseJsonArray(row.options) ?? [];
      options = (await this.choiceOrder(attempt, row.id, q)).map((i) => stored[i]!);
    }
    return {
      id: row.id,
      regionId: row.region_id,
      type: row.type,
      prompt: row.prompt,
      options,
      dronesLeft: dronesLeft(attempt.correct_count),
      dronesTotal: DRONES_PER_REGION,
    };
  }
}
