import { Hono } from 'hono';
import { pingDatabase, type DatabaseHandle } from '../../core/db/index.js';
import type { DiscordStatusSource } from '../../core/discord.js';

export interface AppDeps {
  db: DatabaseHandle;
  discord: DiscordStatusSource;
}

/**
 * Build the HTTP app. Every collaborator is injected so tests can drive it with
 * `app.request()` against `:memory:` SQLite and a fake Discord state.
 */
export function createApp({ db, discord }: AppDeps) {
  const app = new Hono().get('/healthz', (c) => {
    const dbOk = pingDatabase(db);
    // Discord state is reported but never fails the check.
    return c.json({ db: dbOk ? 'ok' : 'error', discord: discord.state() } as const, dbOk ? 200 : 503);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
