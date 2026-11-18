import { createAppServer } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { countQuestions, seedQuestions, seedRegions } from './db/seed.ts';

const config = loadConfig();
const db = openDatabase(config.databasePath);

seedRegions(db);
if (countQuestions(db) === 0) {
  console.log(`[db] Empty question bank — seeded ${seedQuestions(db)} starter questions`);
}

const { server, io } = createAppServer({ db, config });

server.listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port}  (QR links → ${config.publicUrl})`);
});

function shutdown() {
  console.log('[server] shutting down…');
  io.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
