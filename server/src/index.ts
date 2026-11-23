import { createAppServer } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { prepareDatabase } from './db/seed.ts';

const config = loadConfig();
const db = await openDatabase({ url: config.databaseUrl, dir: config.databasePath });
console.log(`[db] ${config.databaseUrl ? 'PostgreSQL (DATABASE_URL)' : `embedded PGlite at ${config.databasePath}`}`);

const { seeded, upgraded } = await prepareDatabase(db);
if (seeded) console.log(`[db] Empty question bank — seeded ${seeded} starter questions`);
if (upgraded) console.log(`[db] Added ${upgraded} new starter questions`);

const { server, io } = createAppServer({ db, config });

server.listen(config.port, () => {
  console.log(`[server] listening on :${config.port}  (QR links → ${config.publicUrl})`);
});

function shutdown() {
  console.log('[server] shutting down…');
  io.close();
  server.close(() => {
    void db.close().finally(() => process.exit(0));
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
