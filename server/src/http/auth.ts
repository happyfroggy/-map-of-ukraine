import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export interface AuthOptions {
  adminPassword: string;
  tokenSecret: string;
  tokenTtlMs: number;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();

/** Stateless admin auth: HMAC-signed bearer tokens with an expiry ("admin.<exp>.<sig>"). */
export function createAuth(opts: AuthOptions) {
  const sign = (payload: string) => createHmac('sha256', opts.tokenSecret).update(payload).digest('base64url');

  function checkPassword(password: string): boolean {
    return timingSafeEqual(sha256(password), sha256(opts.adminPassword));
  }

  function issueToken(now = Date.now()): string {
    const payload = `admin.${now + opts.tokenTtlMs}`;
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token: unknown, now = Date.now()): boolean {
    if (typeof token !== 'string') return false;
    const dot = token.lastIndexOf('.');
    if (dot < 0) return false;
    const payload = token.slice(0, dot);
    const sig = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(sign(payload));
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return false;
    const [role, exp] = payload.split('.');
    return role === 'admin' && Number(exp) > now;
  }

  const requireAdmin: RequestHandler = (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!verifyToken(token)) {
      res.status(401).json({ error: 'Потрібна авторизація адміністратора' });
      return;
    }
    next();
  };

  return { checkPassword, issueToken, verifyToken, requireAdmin };
}

export type Auth = ReturnType<typeof createAuth>;
