import { randomBytes } from 'node:crypto';

export interface AppConfig {
  port: number;
  adminPassword: string;
  tokenSecret: string;
  adminTokenTtlMs: number;
  /** postgres:// URL (production). When empty, an embedded PGlite database is used. */
  databaseUrl: string | undefined;
  /** Directory of the embedded PGlite database (local development). */
  databasePath: string;
  clientOrigins: string[];
  publicUrl: string;
  /** Behind a reverse proxy (Render etc.) — needed for correct client IPs. */
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProd = env.NODE_ENV === 'production' || env.RENDER === 'true';

  let adminPassword = env.ADMIN_PASSWORD;
  if (!adminPassword) {
    if (isProd) throw new Error('ADMIN_PASSWORD must be set in production');
    adminPassword = 'admin';
    console.warn('[config] ADMIN_PASSWORD not set — using "admin" (development only)');
  }

  // Render provides RENDER_EXTERNAL_URL automatically.
  const publicUrl = (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:5173')
    .trim()
    .replace(/\/+$/, '');
  const clientOrigins = (env.CLIENT_ORIGIN ?? `http://localhost:5173,${publicUrl}`)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    port: Number(env.PORT ?? 3000),
    adminPassword,
    tokenSecret: env.TOKEN_SECRET || randomBytes(32).toString('hex'),
    adminTokenTtlMs: 12 * 60 * 60 * 1000,
    databaseUrl: env.DATABASE_URL || undefined,
    databasePath: env.DATABASE_PATH ?? 'data/pglite',
    clientOrigins,
    publicUrl,
    trustProxy: env.TRUST_PROXY === '1' || env.RENDER === 'true',
  };
}
