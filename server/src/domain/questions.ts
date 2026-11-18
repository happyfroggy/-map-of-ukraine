import type { AdminQuestion, QuestionInput, QuestionType } from '../../../shared/types.ts';
import type { Database, Queryable } from '../db/database.ts';
import { GameError } from './errors.ts';

export interface QuestionRow {
  id: number;
  region_id: string;
  type: QuestionType;
  prompt: string;
  options: string | null;
  correct_index: number | null;
  accepted_answers: string | null;
  created_at: number;
  updated_at: number;
}

export const parseJsonArray = (s: string | null): string[] | null => (s === null ? null : (JSON.parse(s) as string[]));

export function toAdminQuestion(row: QuestionRow): AdminQuestion {
  return {
    id: row.id,
    regionId: row.region_id,
    type: row.type,
    prompt: row.prompt,
    options: parseJsonArray(row.options),
    correctIndex: row.correct_index,
    acceptedAnswers: parseJsonArray(row.accepted_answers),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The correct answer in a human-readable form. */
export function displayAnswer(row: QuestionRow): string {
  if (row.type === 'choice') return parseJsonArray(row.options)?.[row.correct_index ?? -1] ?? '';
  return parseJsonArray(row.accepted_answers)?.[0] ?? '';
}

export interface RegionQuestionCount {
  regionId: string;
  name: string;
  count: number;
}

export class QuestionRepo {
  db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  getRow(id: number, q: Queryable = this.db): Promise<QuestionRow | undefined> {
    return q.get<QuestionRow>('SELECT * FROM questions WHERE id = $1', id);
  }

  async list(regionId?: string): Promise<AdminQuestion[]> {
    const rows = regionId
      ? await this.db.all<QuestionRow>('SELECT * FROM questions WHERE region_id = $1 ORDER BY id', regionId)
      : await this.db.all<QuestionRow>(
          'SELECT q.* FROM questions q JOIN regions r ON r.id = q.region_id ORDER BY r.sort_order, q.id',
        );
    return rows.map(toAdminQuestion);
  }

  async get(id: number): Promise<AdminQuestion> {
    const row = await this.getRow(id);
    if (!row) throw new GameError('Питання не знайдено', 404);
    return toAdminQuestion(row);
  }

  countsByRegion(q: Queryable = this.db): Promise<RegionQuestionCount[]> {
    return q.all<RegionQuestionCount>(
      `SELECT r.id AS "regionId", r.name AS name, COUNT(q.id)::int AS count
       FROM regions r LEFT JOIN questions q ON q.region_id = r.id
       GROUP BY r.id ORDER BY r.sort_order`,
    );
  }

  async create(input: QuestionInput, now = Date.now()): Promise<AdminQuestion> {
    await this.assertRegion(input.regionId);
    const v = columnValues(input);
    const row = await this.db.get<QuestionRow>(
      `INSERT INTO questions (region_id, type, prompt, options, correct_index, accepted_answers, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
      input.regionId, input.type, input.prompt, v.options, v.correctIndex, v.acceptedAnswers, now,
    );
    return toAdminQuestion(row!);
  }

  async update(id: number, input: QuestionInput, now = Date.now()): Promise<AdminQuestion> {
    await this.assertRegion(input.regionId);
    const v = columnValues(input);
    const row = await this.db.get<QuestionRow>(
      `UPDATE questions SET region_id = $1, type = $2, prompt = $3, options = $4, correct_index = $5,
         accepted_answers = $6, updated_at = $7 WHERE id = $8 RETURNING *`,
      input.regionId, input.type, input.prompt, v.options, v.correctIndex, v.acceptedAnswers, now, id,
    );
    if (!row) throw new GameError('Питання не знайдено', 404);
    return toAdminQuestion(row);
  }

  async delete(id: number): Promise<void> {
    if (!(await this.db.run('DELETE FROM questions WHERE id = $1', id))) throw new GameError('Питання не знайдено', 404);
  }

  private async assertRegion(regionId: string): Promise<void> {
    if (!(await this.db.get('SELECT 1 FROM regions WHERE id = $1', regionId))) throw new GameError('Невідомий регіон', 400);
  }
}

function columnValues(input: QuestionInput) {
  return input.type === 'choice'
    ? { options: JSON.stringify(input.options), correctIndex: input.correctIndex ?? null, acceptedAnswers: null }
    : { options: null, correctIndex: null, acceptedAnswers: JSON.stringify(input.acceptedAnswers) };
}
