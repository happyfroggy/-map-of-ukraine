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
import type { Database } from '../db/database.ts';
import { GameError } from './errors.ts';
import { QuestionRepo, displayAnswer, parseJsonArray } from './questions.ts';
import { QUESTIONS_PER_REGION, isAnswerCorrect, rankResults, resolveRegionStatus } from './rules.ts';

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

interface AttemptRow {
  id: number;
  player_id: number;
  region_id: string;
  question_ids: string;
  correct_count: number;
  wrong_count: number;
  status: RegionStatus;
  opened_at: number;
  resolved_at: number | null;
}

const toPublicPlayer = (p: PlayerRow): PublicPlayer => ({ id: p.id, firstName: p.first_name, lastName: p.last_name });
const nameKey = (s: string) => s.trim().toLocaleLowerCase('uk-UA');

/**
 * Authoritative game logic. The database is the single source of truth, and
 * node:sqlite is synchronous, so each method runs atomically on the event loop.
 */
export class GameService {
  db: Database;
  questions: QuestionRepo;

  constructor(db: Database) {
    this.db = db;
    this.questions = new QuestionRepo(db);
  }

  // ---------- regions ----------

  regions(): Region[] {
    return this.db.all<Region>('SELECT id, name FROM regions ORDER BY sort_order');
  }

  regionCount(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM regions')!.n;
  }

  // ---------- sessions ----------

  createSession(now = Date.now()): SessionRow {
    for (let i = 0; i < 20; i++) {
      const code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
      if (this.findSessionByCode(code)) continue;
      const { lastId } = this.db.run('INSERT INTO game_sessions (room_code, created_at) VALUES (?, ?)', code, now);
      return this.getSessionById(lastId);
    }
    throw new Error('Could not generate a unique room code');
  }

  findSessionByCode(code: string): SessionRow | undefined {
    return this.db.get<SessionRow>('SELECT * FROM game_sessions WHERE room_code = ?', code.trim().toUpperCase());
  }

  getSessionByCode(code: string): SessionRow {
    const s = this.findSessionByCode(code);
    if (!s) throw new GameError('Кімнату не знайдено', 404);
    return s;
  }

  getSessionById(id: number): SessionRow {
    const s = this.db.get<SessionRow>('SELECT * FROM game_sessions WHERE id = ?', id);
    if (!s) throw new GameError('Кімнату не знайдено', 404);
    return s;
  }

  listSessions(limit = 20): (SessionInfo & { playerCount: number; createdAt: number })[] {
    return this.db
      .all<SessionRow & { player_count: number }>(
        `SELECT s.*, (SELECT COUNT(*) FROM players p WHERE p.session_id = s.id) AS player_count
         FROM game_sessions s ORDER BY s.id DESC LIMIT ?`,
        limit,
      )
      .map((s) => ({ ...this.sessionInfo(s), playerCount: s.player_count, createdAt: s.created_at }));
  }

  sessionInfo(s: SessionRow): SessionInfo {
    return { roomCode: s.room_code, status: s.status, startedAt: s.started_at, endedAt: s.ended_at };
  }

  /** Starts the game for everyone in the room; returns the updated session. */
  startSession(sessionId: number, now = Date.now()): SessionInfo {
    return this.db.tx(() => {
      const session = this.getSessionById(sessionId);
      if (session.status !== 'lobby') throw new GameError('Гру вже розпочато або завершено', 409);
      if (this.listPlayers(sessionId).length === 0) throw new GameError('У кімнаті ще немає гравців', 409);

      const lacking = this.questions.countsByRegion().filter((r) => r.count < QUESTIONS_PER_REGION);
      if (lacking.length) {
        throw new GameError(
          `Недостатньо питань (потрібно ${QUESTIONS_PER_REGION}) для регіонів: ${lacking.map((r) => r.name).join(', ')}`,
          409,
        );
      }
      this.db.run("UPDATE game_sessions SET status = 'active', started_at = ? WHERE id = ?", now, sessionId);
      return this.sessionInfo(this.getSessionById(sessionId));
    });
  }

  /** Ends the game (idempotent) and returns the final ranking. */
  endSession(sessionId: number, now = Date.now()): ResultRow[] {
    return this.db.tx(() => {
      const session = this.getSessionById(sessionId);
      if (session.status === 'lobby') throw new GameError('Гру ще не розпочато', 409);
      if (session.status === 'active') {
        this.db.run("UPDATE game_sessions SET status = 'finished', ended_at = ? WHERE id = ?", now, sessionId);
      }
      return this.results(sessionId);
    });
  }

  // ---------- players ----------

  /**
   * Adds a player to a room in the lobby. Re-joining with the same name returns
   * the existing player (e.g. after losing the token by clearing the browser).
   */
  joinPlayer(roomCode: string, firstName: string, lastName: string, now = Date.now()): PlayerRow {
    return this.db.tx(() => {
      const session = this.getSessionByCode(roomCode);
      if (session.status !== 'lobby') throw new GameError('Гра вже розпочалася — приєднатися неможливо', 409);

      const existing = this.db
        .all<PlayerRow>('SELECT * FROM players WHERE session_id = ?', session.id)
        .find((p) => nameKey(p.first_name) === nameKey(firstName) && nameKey(p.last_name) === nameKey(lastName));
      if (existing) return existing;

      const token = randomBytes(24).toString('base64url');
      const { lastId } = this.db.run(
        'INSERT INTO players (session_id, first_name, last_name, token, joined_at) VALUES (?, ?, ?, ?, ?)',
        session.id, firstName.trim(), lastName.trim(), token, now,
      );
      return this.getPlayerById(lastId);
    });
  }

  getPlayerById(id: number): PlayerRow {
    const p = this.db.get<PlayerRow>('SELECT * FROM players WHERE id = ?', id);
    if (!p) throw new GameError('Гравця не знайдено', 404);
    return p;
  }

  getPlayerByToken(token: string): PlayerRow {
    const p = this.db.get<PlayerRow>('SELECT * FROM players WHERE token = ?', token);
    if (!p) throw new GameError('Сесію гравця не знайдено — приєднайтеся знову', 404);
    return p;
  }

  listPlayers(sessionId: number): PublicPlayer[] {
    return this.db
      .all<PlayerRow>('SELECT * FROM players WHERE session_id = ? ORDER BY joined_at, id', sessionId)
      .map(toPublicPlayer);
  }

  // ---------- gameplay ----------

  /** Opens a region for a player (or resumes it) and returns the current question. */
  openRegion(playerId: number, regionId: string, now = Date.now()): PublicQuestion {
    return this.db.tx(() => {
      const player = this.getPlayerById(playerId);
      this.assertActive(player.session_id);
      if (!this.db.get('SELECT 1 FROM regions WHERE id = ?', regionId)) throw new GameError('Невідомий регіон');

      const attempt = this.getAttempt(playerId, regionId);
      if (attempt) {
        if (attempt.status !== 'in_progress') throw new GameError('Цей регіон уже завершено', 409);
        const index = attempt.correct_count + attempt.wrong_count;
        return this.publicQuestion(this.attemptQuestionIds(attempt)[index], index);
      }

      // Draw this player's questions for the region (random if the pool is larger than 3).
      const ids = this.db
        .all<{ id: number }>('SELECT id FROM questions WHERE region_id = ? ORDER BY RANDOM() LIMIT ?', regionId, QUESTIONS_PER_REGION)
        .map((r) => r.id);
      if (ids.length < QUESTIONS_PER_REGION) throw new GameError('Для цього регіону недостатньо питань', 409);

      this.db.run(
        'INSERT INTO region_attempts (player_id, region_id, question_ids, opened_at) VALUES (?, ?, ?, ?)',
        playerId, regionId, JSON.stringify(ids), now,
      );
      return this.publicQuestion(ids[0], 0);
    });
  }

  /** Checks an answer, applies the early-stopping rule and returns the outcome. */
  answer(playerId: number, regionId: string, questionId: number, given: number | string, now = Date.now()): AnswerResult {
    return this.db.tx(() => {
      const player = this.getPlayerById(playerId);
      this.assertActive(player.session_id);

      const attempt = this.getAttempt(playerId, regionId);
      if (!attempt) throw new GameError('Спершу відкрийте регіон');
      if (attempt.status !== 'in_progress') throw new GameError('Цей регіон уже завершено', 409);

      const ids = this.attemptQuestionIds(attempt);
      const index = attempt.correct_count + attempt.wrong_count;
      // Guards against double submits / stale clients answering an old question.
      if (ids[index] !== questionId) throw new GameError('Це питання вже неактуальне', 409);

      const question = this.questions.getRow(questionId);
      if (!question) throw new GameError('Питання не знайдено (можливо, його видалено)', 409);

      const correct = isAnswerCorrect(
        {
          type: question.type,
          correctIndex: question.correct_index,
          acceptedAnswers: parseJsonArray(question.accepted_answers),
        },
        given,
      );
      this.db.run(
        'INSERT INTO answers (attempt_id, question_id, given_answer, is_correct, answered_at) VALUES (?, ?, ?, ?, ?)',
        attempt.id, questionId, String(given), correct ? 1 : 0, now,
      );

      const correctCount = attempt.correct_count + (correct ? 1 : 0);
      const wrongCount = attempt.wrong_count + (correct ? 0 : 1);
      const status = resolveRegionStatus(correctCount, wrongCount);
      this.db.run(
        'UPDATE region_attempts SET correct_count = ?, wrong_count = ?, status = ?, resolved_at = ? WHERE id = ?',
        correctCount, wrongCount, status, status === 'in_progress' ? null : now, attempt.id,
      );

      let playerFinished = false;
      if (status !== 'in_progress') {
        const resolved = this.db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM region_attempts WHERE player_id = ? AND status != 'in_progress'",
          playerId,
        )!.n;
        if (resolved >= this.regionCount()) {
          this.db.run('UPDATE players SET finished_at = ? WHERE id = ?', now, playerId);
          playerFinished = true;
        }
      }

      return {
        correct,
        correctAnswer: displayAnswer(question),
        regionStatus: status,
        nextQuestion: status === 'in_progress' ? this.publicQuestion(ids[index + 1], index + 1) : null,
        playerFinished,
      };
    });
  }

  allPlayersFinished(sessionId: number): boolean {
    const r = this.db.get<{ total: number; unfinished: number }>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(finished_at IS NULL), 0) AS unfinished
       FROM players WHERE session_id = ?`,
      sessionId,
    )!;
    return r.total > 0 && r.unfinished === 0;
  }

  // ---------- read models ----------

  progress(sessionId: number): PlayerProgress[] {
    return this.db
      .all<{ id: number; first_name: string; last_name: string; finished_at: number | null; correct: number; green: number; red: number }>(
        `SELECT p.id, p.first_name, p.last_name, p.finished_at,
                COALESCE(SUM(a.correct_count), 0)   AS correct,
                COALESCE(SUM(a.status = 'green'), 0) AS green,
                COALESCE(SUM(a.status = 'red'), 0)   AS red
         FROM players p LEFT JOIN region_attempts a ON a.player_id = p.id
         WHERE p.session_id = ?
         GROUP BY p.id ORDER BY p.joined_at, p.id`,
        sessionId,
      )
      .map((r) => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        correctAnswers: r.correct,
        greenRegions: r.green,
        redRegions: r.red,
        finishedAt: r.finished_at,
      }));
  }

  results(sessionId: number, now = Date.now()): ResultRow[] {
    const session = this.getSessionById(sessionId);
    const startedAt = session.started_at ?? now;
    return rankResults(
      this.progress(sessionId).map(({ finishedAt, ...p }) => ({
        ...p,
        timeMs: Math.max(0, (finishedAt ?? session.ended_at ?? now) - startedAt),
        finished: finishedAt !== null,
      })),
    );
  }

  playerState(playerId: number): PlayerState {
    const player = this.getPlayerById(playerId);
    const session = this.getSessionById(player.session_id);
    const regions: Record<string, RegionStatus> = {};
    for (const a of this.db.all<AttemptRow>('SELECT * FROM region_attempts WHERE player_id = ?', playerId)) {
      regions[a.region_id] = a.status;
    }
    return {
      player: toPublicPlayer(player),
      session: this.sessionInfo(session),
      regions,
      finishedAt: player.finished_at,
      results: session.status === 'finished' ? this.results(session.id) : null,
      serverNow: Date.now(),
    };
  }

  adminSnapshot(sessionId: number): AdminSnapshot {
    const session = this.getSessionById(sessionId);
    return {
      session: this.sessionInfo(session),
      players: this.progress(sessionId),
      totalRegions: this.regionCount(),
      results: session.status === 'finished' ? this.results(sessionId) : null,
    };
  }

  // ---------- helpers ----------

  private assertActive(sessionId: number): void {
    const s = this.getSessionById(sessionId);
    if (s.status === 'lobby') throw new GameError('Гра ще не розпочалася', 409);
    if (s.status === 'finished') throw new GameError('Гру завершено', 409);
  }

  private getAttempt(playerId: number, regionId: string): AttemptRow | undefined {
    return this.db.get<AttemptRow>('SELECT * FROM region_attempts WHERE player_id = ? AND region_id = ?', playerId, regionId);
  }

  private attemptQuestionIds(a: AttemptRow): number[] {
    return JSON.parse(a.question_ids) as number[];
  }

  private publicQuestion(id: number | undefined, index: number): PublicQuestion {
    const row = id === undefined ? undefined : this.questions.getRow(id);
    if (!row) throw new GameError('Питання не знайдено (можливо, його видалено)', 409);
    return {
      id: row.id,
      regionId: row.region_id,
      type: row.type,
      prompt: row.prompt,
      options: row.type === 'choice' ? parseJsonArray(row.options) : null,
      number: index + 1,
    };
  }
}
