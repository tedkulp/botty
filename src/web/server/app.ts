import { Hono } from 'hono';
import { pingDatabase, type DatabaseHandle } from '../../core/db/index.js';
import type { DiscordStatusSource } from '../../core/discord.js';
import type { GuildCache } from '../../core/guild-cache.js';
import { createConfigStore, invitePermissions, type ModuleRuntime } from '../../core/modules/index.js';
import { channelsRoutes } from './api/channels.js';
import { guildsRoutes } from './api/guilds.js';
import { modulesRoutes } from './api/modules.js';
import { orphansRoutes } from './api/orphans.js';
import { loadSession, requireAdmin, type AuthEnv } from './auth/middleware.js';
import { authRoutes, type AuthConfig } from './auth/routes.js';
import { spaRoutes } from './spa.js';

export interface AppDeps {
  db: DatabaseHandle;
  discord: DiscordStatusSource;
  auth: AuthConfig;
  /** The Module runtime. Dashboard writes go through it so Activity entries get written. */
  modules: ModuleRuntime;
  /** Guilds and channels the bot can see (the discord.js cache in production, a fake in tests). */
  guilds: GuildCache;
  /** Directory holding the built SPA (`index.html` + assets). Omit to serve no SPA (tests, `npm run dev`). */
  clientDir?: string;
}

/**
 * Build the HTTP app. Every collaborator is injected so tests can drive it with
 * `app.request()` against `:memory:` SQLite, a fake Discord state and stubbed
 * OIDC (see `testing.ts`).
 *
 * Every `/api/*` route registered after `requireAdmin` needs a session and can
 * read `c.var.admin`; `/api/me` is the one exception. New dashboard routes go
 * into this chain (it is what the client's RPC types are built from).
 */
export function createApp({ db, discord, auth, modules, guilds, clientDir }: AppDeps) {
  // The store is stateless (no cache), so the API gets its own for reads.
  const store = createConfigStore(db.db);
  const permissions = invitePermissions(modules.modules).toString();
  /** The bot's invite link (permissions = union of every Module's), once the application id is known. */
  const inviteUrl = () => {
    const appId = guilds.applicationId();
    if (!appId) return null;
    return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(appId)}&scope=bot&permissions=${permissions}`;
  };
  const app = new Hono<AuthEnv>()
    .get('/healthz', (c) => {
      const dbOk = pingDatabase(db);
      // Discord state is reported but never fails the check.
      return c.json({ db: dbOk ? 'ok' : 'error', discord: discord.state() } as const, dbOk ? 200 : 503);
    })
    .route('/auth', authRoutes(db.db, auth))
    .use('/api/*', loadSession(db.db, auth))
    .get('/api/me', (c) => c.json({ admin: c.var.admin }))
    .use('/api/*', requireAdmin)
    .get('/api/status', (c) => c.json({ discord: discord.state(), inviteUrl: inviteUrl() }))
    .route('/api/modules', modulesRoutes({ runtime: modules, store }))
    .route('/api/guilds', guildsRoutes({ runtime: modules, store, discord, guilds }))
    .route('/api/channels', channelsRoutes({ runtime: modules, store, discord, guilds }))
    .route('/api/orphans', orphansRoutes({ runtime: modules, store, discord, guilds }));

  // Unknown /api paths stay JSON 404s; everything else may fall through to the SPA.
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
  if (clientDir) app.route('/', spaRoutes(clientDir));

  return app;
}

export type App = ReturnType<typeof createApp>;
