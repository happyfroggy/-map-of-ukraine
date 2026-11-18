import { randomInt } from 'node:crypto';
import type { Database } from './database.ts';
import { REGIONS } from './seedData.ts';

function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Regions are fixed reference data — upserted on every start. */
export async function seedRegions(db: Database): Promise<void> {
  await db.tx(async (q) => {
    for (const [i, r] of REGIONS.entries()) {
      await q.run(
        `INSERT INTO regions (id, name, sort_order) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order`,
        r.id, r.name, i,
      );
    }
  });
}

export async function countQuestions(db: Database): Promise<number> {
  return (await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM questions'))!.n;
}

/** Inserts the starter question bank. With reset, existing questions are deleted first. */
export async function seedQuestions(db: Database, { reset = false } = {}): Promise<number> {
  const now = Date.now();
  let inserted = 0;
  await db.tx(async (q) => {
    if (reset) await q.run('DELETE FROM questions');
    for (const region of REGIONS) {
      for (const question of region.questions) {
        if (question.type === 'choice') {
          const options = shuffle(question.options);
          await q.run(
            `INSERT INTO questions (region_id, type, prompt, options, correct_index, created_at, updated_at)
             VALUES ($1, 'choice', $2, $3, $4, $5, $5)`,
            region.id, question.prompt, JSON.stringify(options), options.indexOf(question.options[0]), now,
          );
        } else {
          await q.run(
            `INSERT INTO questions (region_id, type, prompt, accepted_answers, created_at, updated_at)
             VALUES ($1, 'text', $2, $3, $4, $4)`,
            region.id, question.prompt, JSON.stringify(question.answers), now,
          );
        }
        inserted++;
      }
    }
  });
  return inserted;
}

/** Regions + (on an empty database) the starter questions. */
export async function prepareDatabase(db: Database): Promise<number> {
  await seedRegions(db);
  return (await countQuestions(db)) === 0 ? seedQuestions(db) : 0;
}
