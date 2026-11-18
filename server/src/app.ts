import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../../shared/types.ts';
import type { AppConfig } from './config.ts';
import type { Database } from './db/database.ts';
import { GameService } from './domain/game.ts';
import { adminRouter } from './http/adminRoutes.ts';
import { createAuth } from './http/auth.ts';
import { errorHandler } from './http/errorHandler.ts';
import { publicRouter } from './http/publicRoutes.ts';
import { attachSocketHandlers } from './socket/index.ts';

export function createAppServer({ db, config }: { db: Database; config: AppConfig }) {
  const game = new GameService(db);
  const auth = createAuth({
    adminPassword: config.adminPassword,
    tokenSecret: config.tokenSecret,
    tokenTtlMs: config.adminTokenTtlMs,
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.clientOrigins }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', publicRouter(game));
  app.use('/api/admin', adminRouter({ game, questions: game.questions, auth, publicUrl: config.publicUrl }));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // In production, serve the built React client from the same origin.
  const clientDist = resolve(import.meta.dirname, '../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (_req, res) => res.sendFile(join(clientDist, 'index.html')));
  }

  app.use(errorHandler);

  const server = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(server, {
    cors: { origin: config.clientOrigins },
  });
  attachSocketHandlers(io, game, auth);

  return { app, server, io, game };
}
