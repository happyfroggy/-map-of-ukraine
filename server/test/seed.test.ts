import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase } from '../src/db/database.ts';
import { countQuestions, prepareDatabase } from '../src/db/seed.ts';
import { QUESTIONS_V2 } from '../src/db/seedData.ts';

describe('seed upgrades', () => {
  it('empty database gets the full bank', async () => {
    const db = await openDatabase({ dir: ':memory:' });
    assert.deepEqual(await prepareDatabase(db), { seeded: 100, upgraded: 0 });
    assert.deepEqual(await prepareDatabase(db), { seeded: 0, upgraded: 0 }, 'second start adds nothing');
  });

  it('a pre-versioning bank (75 questions) gets only the 25 new ones, once', async () => {
    const db = await openDatabase({ dir: ':memory:' });
    await prepareDatabase(db);
    // Simulate the production database before this change.
    const v2Prompts = Object.values(QUESTIONS_V2).map((q) => q.prompt);
    for (const prompt of v2Prompts) await db.run('DELETE FROM questions WHERE prompt = $1', prompt);
    await db.run('DELETE FROM app_meta');
    // …where the admin had also deleted one original question.
    const deleted = (await db.get<{ id: number; prompt: string }>('SELECT id, prompt FROM questions ORDER BY id LIMIT 1'))!;
    await db.run('DELETE FROM questions WHERE id = $1', deleted.id);
    assert.equal(await countQuestions(db), 74);

    assert.deepEqual(await prepareDatabase(db), { seeded: 0, upgraded: 25 });
    assert.equal(await countQuestions(db), 99);
    assert.equal(await db.get('SELECT 1 FROM questions WHERE prompt = $1', deleted.prompt), undefined, 'deleted question stays deleted');
    assert.deepEqual(await prepareDatabase(db), { seeded: 0, upgraded: 0 }, 'runs only once');
  });

  it('migration adds the round column to an existing region_attempts table', async () => {
    const db = await openDatabase({ dir: ':memory:' });
    const col = await db.get<{ column_default: string }>(
      "SELECT column_default FROM information_schema.columns WHERE table_name = 'region_attempts' AND column_name = 'round'",
    );
    assert.equal(col?.column_default, '1');
  });
});
