import { Router } from 'express';
import type { GameService } from '../domain/game.ts';
import { GameError } from '../domain/errors.ts';
import { roomCodeSchema } from '../validation.ts';

export function publicRouter(game: GameService): Router {
  const r = Router();

  r.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  r.get('/regions', (_req, res) => {
    res.json(game.regions());
  });

  /** Used by the join page to validate a room code before showing the form. */
  r.get('/sessions/:code', (req, res) => {
    const session = game.getSessionByCode(roomCodeSchema.parse(req.params.code));
    res.json(game.sessionInfo(session));
  });

  r.get('/sessions/:code/results', (req, res) => {
    const session = game.getSessionByCode(roomCodeSchema.parse(req.params.code));
    if (session.status !== 'finished') throw new GameError('Гру ще не завершено', 409);
    res.json(game.results(session.id));
  });

  return r;
}
