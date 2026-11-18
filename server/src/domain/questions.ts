import type { AdminQuestion, QuestionInput, QuestionType } from '../../../shared/types.ts';
import type { Database } from '../db/database.ts';
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

  getRow(id: number): QuestionRow | undefined {
    return this.db.get<QuestionRow>('SELECT * FROM questions WHERE id = ?', id);
  }

  list(regionId?: string): AdminQuestion[] {
    const rows = regionId
      ? this.db.all<QuestionRow>('SELECT * FROM questions WHERE region_id = ? ORDER BY id', regionId)
      : this.db.all<QuestionRow>(
          'SELECT q.* FROM questions q JOIN regions r ON r.id = q.region_id ORDER BY r.sort_order, q.id',
        );
    return rows.map(toAdminQuestion);
  }

  get(id: number): AdminQuestion {
    const row = this.getRow(id);
    if (!row) throw new GameError('Питання не знайдено', 404);
    return toAdminQuestion(row);
  }

  countsByRegion(): RegionQuestionCount[] {
    return this.db.all<RegionQuestionCount>(
      `SELECT r.id AS regionId, r.name AS name, COUNT(q.id) AS count
       FROM regions r LEFT JOIN questions q ON q.region_id = r.id
       GROUP BY r.id ORDER BY r.sort_order`,
    );
  }

  create(input: QuestionInput, now = Date.now()): AdminQuestion {
    this.assertRegion(input.regionId);
    const v = columnValues(input);
    const { lastId } = this.db.run(
      `INSERT INTO questions (region_id, type, prompt, options, correct_index, accepted_answers, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.regionId, input.type, input.prompt, v.options, v.correctIndex, v.acceptedAnswers, now, now,
    );
    return this.get(lastId);
  }

  update(id: number, input: QuestionInput, now = Date.now()): AdminQuestion {
    this.assertRegion(input.regionId);
    const v = columnValues(input);
    const { changes } = this.db.run(
      `UPDATE questions SET region_id = ?, type = ?, prompt = ?, options = ?, correct_index = ?,
         accepted_answers = ?, updated_at = ? WHERE id = ?`,
      input.regionId, input.type, input.prompt, v.options, v.correctIndex, v.acceptedAnswers, now, id,
    );
    if (!changes) throw new GameError('Питання не знайдено', 404);
    return this.get(id);
  }

  delete(id: number): void {
    const { changes } = this.db.run('DELETE FROM questions WHERE id = ?', id);
    if (!changes) throw new GameError('Питання не знайдено', 404);
  }

  private assertRegion(regionId: string): void {
    if (!this.db.get('SELECT 1 FROM regions WHERE id = ?', regionId)) {
      throw new GameError('Невідомий регіон', 400);
    }
  }
}

function columnValues(input: QuestionInput) {
  return input.type === 'choice'
    ? { options: JSON.stringify(input.options), correctIndex: input.correctIndex ?? null, acceptedAnswers: null }
    : { options: null, correctIndex: null, acceptedAnswers: JSON.stringify(input.acceptedAnswers) };
}
