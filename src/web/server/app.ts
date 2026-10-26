import { Hono } from 'hono';
import { pingDatabase, type DatabaseHandle } from '../../core/db/index.js';
import type { DiscordStatusSource } from '../../core/discord.js';
import { loadSession, requireAdmin, type AuthEnv } from './auth/middleware.js';
import { authRoutes, type AuthConfig } from './auth/routes.js';

export interface AppDeps {
  db: DatabaseHandle;
  discord: DiscordStatusSource;
  auth: AuthConfig;
}

/**
 * Build the HTTP app. Every collaborator is injected so tests can drive it with
 * `app.request()` against `:memory:` SQLite, a fake Discord state and stubbed
 * OIDC (see `testing.ts`).
 *
 * Every `/api/*` route registered after `requireAdmin` needs a session and can
 * read `c.var.admin`; `/api/me` is the one exception.
 */
export function createApp({ db, discord, auth }: AppDeps) {
  const app = new Hono<AuthEnv>()
    .get('/healthz', (c) => {
      const dbOk = pingDatabase(db);
      // Discord state is reported but never fails the check.
      return c.json({ db: dbOk ? 'ok' : 'error', discord: discord.state() } as const, dbOk ? 200 : 503);
    })
    .route('/auth', authRoutes(db.db, auth))
    .use('/api/*', loadSession(db.db, auth))
    .get('/api/me', (c) => c.json({ admin: c.var.admin }))
    .use('/api/*', requireAdmin);

  return app;
}

export type App = ReturnType<typeof createApp>;
