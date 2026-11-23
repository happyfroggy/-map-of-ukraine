import { randomInt } from 'node:crypto';
import type { Database, Queryable } from './database.ts';
import { REGIONS, SEED_VERSION, allSeedQuestions, type SeedQuestion } from './seedData.ts';

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

export async function countQuestions(db: Queryable): Promise<number> {
  return (await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM questions'))!.n;
}

async function insertQuestion(q: Queryable, regionId: string, question: SeedQuestion, now: number): Promise<void> {
  if (question.type === 'choice') {
    // Stored order is shuffled once; each player additionally sees a per-player order.
    const options = shuffle(question.options);
    await q.run(
      `INSERT INTO questions (region_id, type, prompt, options, correct_index, created_at, updated_at)
       VALUES ($1, 'choice', $2, $3, $4, $5, $5)`,
      regionId, question.prompt, JSON.stringify(options), options.indexOf(question.options[0]), now,
    );
  } else {
    await q.run(
      `INSERT INTO questions (region_id, type, prompt, accepted_answers, created_at, updated_at)
       VALUES ($1, 'text', $2, $3, $4, $4)`,
      regionId, question.prompt, JSON.stringify(question.answers), now,
    );
  }
}

async function getSeedVersion(q: Queryable): Promise<number | null> {
  const row = await q.get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'seed_version'");
  return row ? Number(row.value) : null;
}

async function setSeedVersion(q: Queryable, version: number): Promise<void> {
  await q.run(
    `INSERT INTO app_meta (key, value) VALUES ('seed_version', $1)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    String(version),
  );
}

/** Inserts the whole starter question bank. With reset, existing questions are deleted first. */
export async function seedQuestions(db: Database, { reset = false } = {}): Promise<number> {
  const now = Date.now();
  const all = allSeedQuestions();
  await db.tx(async (q) => {
    if (reset) await q.run('DELETE FROM questions');
    for (const { regionId, question } of all) await insertQuestion(q, regionId, question, now);
    await setSeedVersion(q, SEED_VERSION);
  });
  return all.length;
}

/**
 * Adds seed batches newer than the database has seen (once), skipping any
 * question whose text already exists in that region. Questions the admin
 * edited or deleted from earlier batches are left alone.
 */
async function upgradeSeed(db: Database): Promise<number> {
  return db.tx(async (q) => {
    const current = (await getSeedVersion(q)) ?? 1; // banks created before versioning = batch 1
    if (current >= SEED_VERSION) return 0;
    const now = Date.now();
    let inserted = 0;
    for (const { regionId, question, version } of allSeedQuestions()) {
      if (version <= current) continue;
      const exists = await q.get('SELECT 1 FROM questions WHERE region_id = $1 AND prompt = $2', regionId, question.prompt);
      if (exists) continue;
      await insertQuestion(q, regionId, question, now);
      inserted++;
    }
    await setSeedVersion(q, SEED_VERSION);
    return inserted;
  });
}

/** Regions + starter questions (full bank on an empty database, new batches otherwise). */
export async function prepareDatabase(db: Database): Promise<{ seeded: number; upgraded: number }> {
  await seedRegions(db);
  if ((await countQuestions(db)) === 0) return { seeded: await seedQuestions(db), upgraded: 0 };
  return { seeded: 0, upgraded: await upgradeSeed(db) };
}
