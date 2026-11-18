import type { PublicQuestion } from '../../shared/types.ts';
import { openDatabase } from '../src/db/database.ts';
import { seedQuestions, seedRegions } from '../src/db/seed.ts';
import { parseJsonArray, type QuestionRepo } from '../src/domain/questions.ts';

/** In-memory Postgres (PGlite) with the seed data. */
export async function freshDb() {
  const db = await openDatabase({ dir: ':memory:' });
  await seedRegions(db);
  await seedQuestions(db);
  return db;
}

/** Test-only cheat: the right (or a wrong) answer for a question. */
export async function answerFor(repo: QuestionRepo, q: PublicQuestion, correct: boolean): Promise<number | string> {
  const row = (await repo.getRow(q.id))!;
  if (row.type === 'choice') return correct ? row.correct_index! : (row.correct_index! + 1) % 4;
  return correct ? parseJsonArray(row.accepted_answers)![0]! : 'definitely wrong';
}
