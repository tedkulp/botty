import { Hono } from 'hono';
import { validator } from 'hono/validator';
import type { GuildCache } from '../../../core/guild-cache.js';
import type { ActivityEntry, ActivityStore, ModuleRuntime } from '../../../core/modules/index.js';
import type { AuthEnv } from '../auth/middleware.js';
import { findModule } from './shared.js';

export interface ActivityApiDeps {
  runtime: ModuleRuntime;
  activity: ActivityStore;
  /** Resolves server and channel names; ids the cache does not know get `name: null`. */
  guilds: GuildCache;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** A positive integer query value, `undefined` when absent, `null` when malformed. */
function positiveInt(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 ? n : null;
}

/** Query of the feed route; every field optional. */
export interface ActivityQuery {
  guildId?: string;
  channelId?: string;
  limit?: string;
  /** The `nextBefore` of the previous page. */
  before?: string;
}

const parseQuery = validator('query', (value, c) => {
  const one = (key: keyof ActivityQuery) => {
    const v = value[key];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const limit = positiveInt(one('limit'));
  const before = positiveInt(one('before'));
  if (limit === null || before === null) return c.json({ error: 'limit and before must be positive integers' }, 400);
  const guildId = one('guildId');
  const channelId = one('channelId');
  return {
    ...(guildId ? { guildId } : {}),
    ...(channelId ? { channelId } : {}),
    ...(limit ? { limit } : {}),
    ...(before ? { before } : {}),
  } as { guildId?: string; channelId?: string; limit?: number; before?: number };
});

/** `/api/modules/:id/activity`: a Module's Activity feed, newest first. */
export function activityRoutes({ runtime, activity, guilds }: ActivityApiDeps) {
  function toJson(e: ActivityEntry) {
    return {
      id: e.id,
      level: e.level,
      message: e.message,
      link: e.link,
      actor: e.actor,
      guild: e.guildId === null ? null : { id: e.guildId, name: guilds.guild(e.guildId)?.name ?? null },
      channel: e.channelId === null ? null : { id: e.channelId, name: guilds.channel(e.channelId)?.name ?? null },
      createdAt: e.createdAt.toISOString(),
    };
  }

  return new Hono<AuthEnv>().get('/:id/activity', parseQuery, (c) => {
    const moduleId = c.req.param('id');
    if (!findModule(runtime, moduleId)) return c.json({ error: 'unknown Module' }, 404);
    const { guildId, channelId, limit, before } = c.req.valid('query');
    const query = {
      moduleId,
      ...(guildId ? { guildId } : {}),
      ...(channelId ? { channelId } : {}),
    };
    const pageSize = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const entries = activity.listActivity({ ...query, limit: pageSize, ...(before ? { before } : {}) });
    const last = entries.at(-1);
    // Only offer "load more" when there is something older.
    const more = entries.length === pageSize && last && activity.listActivity({ ...query, limit: 1, before: last.id }).length > 0;
    return c.json({ entries: entries.map(toJson), nextBefore: more ? last.id : null }, 200);
  });
}
