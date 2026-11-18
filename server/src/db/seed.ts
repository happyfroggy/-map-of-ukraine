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
export function seedRegions(db: Database): void {
  db.tx(() => {
    REGIONS.forEach((r, i) => {
      db.run(
        `INSERT INTO regions (id, name, sort_order) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order`,
        r.id, r.name, i,
      );
    });
  });
}

export function countQuestions(db: Database): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM questions')!.n;
}

/** Inserts the starter question bank. With reset, existing questions are deleted first. */
export function seedQuestions(db: Database, { reset = false } = {}): number {
  const now = Date.now();
  let inserted = 0;
  db.tx(() => {
    if (reset) db.run('DELETE FROM questions');
    for (const region of REGIONS) {
      for (const q of region.questions) {
        if (q.type === 'choice') {
          const options = shuffle(q.options);
          db.run(
            `INSERT INTO questions (region_id, type, prompt, options, correct_index, created_at, updated_at)
             VALUES (?, 'choice', ?, ?, ?, ?, ?)`,
            region.id, q.prompt, JSON.stringify(options), options.indexOf(q.options[0]), now, now,
          );
        } else {
          db.run(
            `INSERT INTO questions (region_id, type, prompt, accepted_answers, created_at, updated_at)
             VALUES (?, 'text', ?, ?, ?, ?)`,
            region.id, q.prompt, JSON.stringify(q.answers), now, now,
          );
        }
        inserted++;
      }
    }
  });
  return inserted;
}
