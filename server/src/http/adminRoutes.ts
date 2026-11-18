import { Router } from 'express';
import QRCode from 'qrcode';
import type { CreatedSession } from '../../../shared/types.ts';
import type { GameService } from '../domain/game.ts';
import type { QuestionRepo } from '../domain/questions.ts';
import { idParamSchema, loginSchema, questionInputSchema } from '../validation.ts';
import type { Auth } from './auth.ts';

const MAX_LOGIN_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function adminRouter(deps: { game: GameService; questions: QuestionRepo; auth: Auth; publicUrl: string }): Router {
  const { game, questions, auth, publicUrl } = deps;
  const r = Router();
  const failures = new Map<string, { count: number; resetAt: number }>();

  r.post('/login', (req, res) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    let entry = failures.get(key);
    if (entry && entry.resetAt <= now) entry = undefined;
    if (entry && entry.count >= MAX_LOGIN_FAILURES) {
      res.status(429).json({ error: 'Забагато невдалих спроб. Спробуйте пізніше.' });
      return;
    }

    const { password } = loginSchema.parse(req.body);
    if (!auth.checkPassword(password)) {
      entry ??= { count: 0, resetAt: now + LOGIN_WINDOW_MS };
      entry.count++;
      failures.set(key, entry);
      res.status(401).json({ error: 'Невірний пароль' });
      return;
    }
    failures.delete(key);
    res.json({ token: auth.issueToken() });
  });

  // Everything below requires a valid admin token.
  r.use(auth.requireAdmin);

  // ----- questions CRUD -----
  r.get('/questions', async (req, res) => {
    const regionId = typeof req.query.regionId === 'string' ? req.query.regionId : undefined;
    res.json(await questions.list(regionId));
  });

  r.get('/questions/counts', async (_req, res) => {
    res.json(await questions.countsByRegion());
  });

  r.get('/questions/:id', async (req, res) => {
    res.json(await questions.get(idParamSchema.parse(req.params.id)));
  });

  r.post('/questions', async (req, res) => {
    res.status(201).json(await questions.create(questionInputSchema.parse(req.body)));
  });

  r.put('/questions/:id', async (req, res) => {
    res.json(await questions.update(idParamSchema.parse(req.params.id), questionInputSchema.parse(req.body)));
  });

  r.delete('/questions/:id', async (req, res) => {
    await questions.delete(idParamSchema.parse(req.params.id));
    res.status(204).end();
  });

  // ----- game sessions -----
  r.get('/sessions', async (_req, res) => {
    res.json(await game.listSessions());
  });

  r.post('/sessions', async (_req, res) => {
    const session = await game.createSession();
    const joinUrl = `${publicUrl}/join/${session.room_code}`;
    const qrCode = await QRCode.toDataURL(joinUrl, { width: 512, margin: 2 });
    const body: CreatedSession = { session: game.sessionInfo(session), joinUrl, qrCode };
    res.status(201).json(body);
  });

  return r;
}
