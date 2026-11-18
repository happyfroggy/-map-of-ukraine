// Usage: npm run seed            — seed questions only if the table is empty
//        npm run seed -- --reset — delete all questions and re-seed
import { loadConfig } from '../config.ts';
import { openDatabase } from './database.ts';
import { countQuestions, seedQuestions, seedRegions } from './seed.ts';

const reset = process.argv.includes('--reset');
const config = loadConfig();
const db = openDatabase(config.databasePath);

seedRegions(db);
if (reset || countQuestions(db) === 0) {
  const n = seedQuestions(db, { reset });
  console.log(`Seeded ${n} questions into ${config.databasePath}`);
} else {
  console.log(`Questions already present (${countQuestions(db)}). Use --reset to re-seed.`);
}
db.close();
