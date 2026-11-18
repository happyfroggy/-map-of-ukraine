// Usage: npm run seed            — seed questions only if the table is empty
//        npm run seed -- --reset — delete all questions and re-seed
import { loadConfig } from '../config.ts';
import { openDatabase } from './database.ts';
import { countQuestions, seedQuestions, seedRegions } from './seed.ts';

const reset = process.argv.includes('--reset');
const config = loadConfig();
const db = await openDatabase({ url: config.databaseUrl, dir: config.databasePath });

await seedRegions(db);
if (reset || (await countQuestions(db)) === 0) {
  console.log(`Seeded ${await seedQuestions(db, { reset })} questions`);
} else {
  console.log(`Questions already present (${await countQuestions(db)}). Use --reset to re-seed.`);
}
await db.close();
