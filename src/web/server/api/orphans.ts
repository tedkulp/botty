import { Hono } from 'hono';
import type { AuthEnv } from '../auth/middleware.js';
import { discordReady, lastEditedJson, type DiscordApiDeps } from './shared.js';

/**
 * `/api/orphans`: stored channel rows whose channel or guild is no longer in the
 * cache. They are only listed while Discord is ready (otherwise the cache can't
 * tell a vanished channel from a disconnected one) and only deleted on request.
 */
export function orphansRoutes({ runtime, store, discord, guilds }: DiscordApiDeps) {
  const ready = () => discordReady(discord);

  function orphans() {
    return runtime.modules.flatMap((module) =>
      store
        .listChannelRows(module.id)
        .filter((row) => {
          const channel = guilds.channel(row.channelId);
          return !channel || !guilds.guild(channel.guildId);
        })
        .map((row) => ({
          moduleId: module.id,
          moduleName: module.name,
          channelId: row.channelId,
          guildId: row.guildId,
          /** The guild's name when the guild is still there (only the channel vanished). */
          guildName: row.guildId ? (guilds.guild(row.guildId)?.name ?? null) : null,
          enabled: row.enabled,
          ...lastEditedJson(row),
        })),
    );
  }

  return new Hono<AuthEnv>()
    .get('/', (c) => {
      if (!ready()) return c.json({ available: false as const });
      return c.json({ available: true as const, orphans: orphans() });
    })
    .delete('/:moduleId/:channelId', (c) => {
      if (!ready()) return c.json({ error: 'Discord is unavailable' }, 503);
      const { moduleId, channelId } = c.req.param();
      const orphan = orphans().find((o) => o.moduleId === moduleId && o.channelId === channelId);
      if (!orphan) return c.json({ error: 'no such unavailable channel' }, 404);
      store.deleteChannelRow(moduleId, channelId);
      return c.json({ deleted: true as const }, 200);
    });
}
