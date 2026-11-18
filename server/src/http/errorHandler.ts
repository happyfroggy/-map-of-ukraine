import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { GameError } from '../domain/errors.ts';
import { formatZodError } from '../validation.ts';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: formatZodError(err) });
  } else if (err instanceof GameError) {
    res.status(err.status).json({ error: err.message });
  } else if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Некоректний JSON' });
  } else {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  }
};
