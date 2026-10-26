import { join } from 'node:path';
import { serve, type ServerType } from '@hono/node-server';
import type { Env } from './core/env.js';
import type { Logger } from './core/logger.js';
import { openDatabase, runMigrations, type DatabaseHandle } from './core/db/index.js';
import { createDiscordConnection, type DiscordConnection } from './core/discord.js';
import { discordGuildCache } from './core/guild-cache.js';
import { createApp } from './web/server/app.js';
import { builtClientDir } from './web/server/spa.js';
import {
  createActivityStore,
  createConfigStore,
  createModuleRuntime,
  deriveIntents,
  discordChannelResolver,
  SUPPORTED_EVENTS,
  type ModuleRuntime,
} from './core/modules/index.js';
import { modules } from './modules/index.js';
import { createOidcProvider } from './web/server/auth/oidc.js';

export const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface Botty {
  db: DatabaseHandle;
  discord: DiscordConnection;
  modules: ModuleRuntime;
  server: ServerType;
  /** Close HTTP, destroy the Discord client, close SQLite. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Startup order: migrations -> HTTP -> Discord login. Throws if migrations fail.
 * Discord login runs in the background and never blocks or fails startup.
 */
export async function start(env: Env, logger: Logger): Promise<Botty> {
  const db = openDatabase(join(env.DATA_DIR, 'botty.db'));
  try {
    runMigrations(db);
  } catch (err) {
    db.close();
    throw err;
  }
  logger.info('migrations applied');

  // Intents must be fixed before login, but Modules subscribe in `setup` (which
  // may run later, when switched on), so cover every event a Module can use.
  const discord = createDiscordConnection({
    token: env.DISCORD_TOKEN,
    logger,
    intents: deriveIntents(SUPPORTED_EVENTS),
  });
  const runtime = createModuleRuntime({
    modules,
    store: createConfigStore(db.db),
    events: discord.client,
    channels: discordChannelResolver(discord.client),
    logger,
    activity: createActivityStore(db.db),
  });
  const oidc = createOidcProvider({
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
  });
  const app = createApp({
    db,
    modules: runtime,
    guilds: discordGuildCache(discord.client),
    clientDir: builtClientDir(),
    discord: discord.status,
    auth: {
      oidc,
      publicUrl: env.PUBLIC_URL,
      adminGroup: env.ADMIN_GROUP,
      sessionSecret: env.SESSION_SECRET,
    },
  });

  const server = await new Promise<ServerType>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
      logger.info({ port: info.port }, 'http listening');
      resolve(s);
    });
    s.once('error', reject);
  });

  await runtime.start();
  logger.info({ modules: modules.map((m) => m.id) }, 'modules started');
  void discord.login();

  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        if ('closeAllConnections' in server) server.closeAllConnections();
      });
      logger.info('http closed');
      await runtime.stop();
      await discord.destroy();
      logger.info('discord destroyed');
      db.close();
      logger.info('sqlite closed');
    })());

  return { db, discord, modules: runtime, server, stop };
}
