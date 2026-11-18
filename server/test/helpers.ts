import type { PublicQuestion } from '../../shared/types.ts';
import { openDatabase } from '../src/db/database.ts';
import { seedQuestions, seedRegions } from '../src/db/seed.ts';
import { parseJsonArray, type QuestionRepo } from '../src/domain/questions.ts';

export function freshDb() {
  const db = openDatabase(':memory:');
  seedRegions(db);
  seedQuestions(db);
  return db;
}

/** Test-only cheat: the right (or a wrong) answer for a question. */
export function answerFor(repo: QuestionRepo, q: PublicQuestion, correct: boolean): number | string {
  const row = repo.getRow(q.id)!;
  if (row.type === 'choice') return correct ? row.correct_index! : (row.correct_index! + 1) % 4;
  return correct ? parseJsonArray(row.accepted_answers)![0]! : 'definitely wrong';
}
