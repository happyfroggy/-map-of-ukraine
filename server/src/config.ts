import { randomBytes } from 'node:crypto';

export interface AppConfig {
  port: number;
  adminPassword: string;
  tokenSecret: string;
  adminTokenTtlMs: number;
  databasePath: string;
  clientOrigins: string[];
  publicUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProd = env.NODE_ENV === 'production';

  let adminPassword = env.ADMIN_PASSWORD;
  if (!adminPassword) {
    if (isProd) throw new Error('ADMIN_PASSWORD must be set in production');
    adminPassword = 'admin';
    console.warn('[config] ADMIN_PASSWORD not set — using "admin" (development only)');
  }

  const clientOrigins = (env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    port: Number(env.PORT ?? 3000),
    adminPassword,
    tokenSecret: env.TOKEN_SECRET || randomBytes(32).toString('hex'),
    adminTokenTtlMs: 12 * 60 * 60 * 1000,
    databasePath: env.DATABASE_PATH ?? 'data/game.db',
    clientOrigins,
    publicUrl: (env.PUBLIC_URL ?? clientOrigins[0] ?? 'http://localhost:5173').replace(/\/+$/, ''),
  };
}
