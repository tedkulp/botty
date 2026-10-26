import { Hono } from 'hono';
import type { CachedChannel, ChannelKind } from '../../../core/guild-cache.js';
import type { ModuleRuntime } from '../../../core/modules/index.js';
import type { AuthEnv } from '../auth/middleware.js';
import { discordReady, type DiscordApiDeps } from './shared.js';

/** Discord lists voice-like channels after text-like ones within a category. */
const VOICE_LIKE = new Set<ChannelKind>(['voice', 'stage']);

function byDiscordOrder(a: CachedChannel, b: CachedChannel): number {
  const voice = Number(VOICE_LIKE.has(a.kind)) - Number(VOICE_LIKE.has(b.kind));
  if (voice !== 0) return voice;
  if (a.position !== b.position) return a.position - b.position;
  return compareIds(a.id, b.id);
}

/** Snowflakes compare numerically (older first). */
function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Discord's placeholder name for a channel it obfuscated. */
export const HIDDEN_CHANNEL_NAME = '___hidden___';

/** Whether the bot can see a channel: not obfuscated and `ViewChannel` granted. */
export function isViewable(channel: CachedChannel): boolean {
  if (channel.obfuscated || channel.name === HIDDEN_CHANNEL_NAME) return false;
  return channel.permissions?.has('ViewChannel', true) === true;
}

/** Ids of the Modules Enabled in a (non-thread) channel: on globally AND on for the channel. */
export function enabledModuleIds(runtime: ModuleRuntime) {
  return (channelId: string): string[] =>
    runtime.modules.filter((module) => runtime.isEnabledIn(module.id, channelId)).map((module) => module.id);
}

/**
 * A guild's channels as Discord shows them: uncategorised channels first, then
 * each category by position; within a group text-like before voice-like, then
 * by position. Threads sit under their parent, oldest first.
 */
export function channelTree(channels: CachedChannel[]) {
  const categories = channels.filter((c) => c.kind === 'category').sort(byDiscordOrder);
  const threads = channels.filter((c) => c.kind === 'thread').sort((a, b) => compareIds(a.id, b.id));
  const regular = channels.filter((c) => c.kind !== 'category' && c.kind !== 'thread').sort(byDiscordOrder);
  const categoryIds = new Set(categories.map((c) => c.id));

  const node = (channel: CachedChannel) => ({ channel, threads: threads.filter((t) => t.parentId === channel.id) });
  const top = regular.filter((c) => !c.parentId || !categoryIds.has(c.parentId));
  return [
    ...(top.length ? [{ category: null, channels: top.map(node) }] : []),
    ...categories.map((category) => ({
      category,
      channels: regular.filter((c) => c.parentId === category.id).map(node),
    })),
  ];
}

/** `/api/guilds`: the server rail, a guild's channel tree and its Module overview. */
export function guildsRoutes({ runtime, store, discord, guilds }: DiscordApiDeps) {
  const ready = () => discordReady(discord);

  return new Hono<AuthEnv>()
    .get('/', (c) => {
      if (!ready()) return c.json({ available: false as const });
      return c.json({ available: true as const, guilds: guilds.guilds() });
    })
    .get('/:id/channels', (c) => {
      if (!ready()) return c.json({ available: false as const }, 200);
      const guild = guilds.guild(c.req.param('id'));
      if (!guild) return c.json({ error: 'unknown guild' }, 404);
      const tree = channelTree(guilds.channels(guild.id));
      const enabledIn = enabledModuleIds(runtime);
      // Threads follow their parent, so they show the parent's Enabled Modules.
      const channelJson = (ch: CachedChannel, enabledModules: string[]) => ({
        id: ch.id,
        name: ch.name,
        kind: ch.kind,
        viewable: isViewable(ch),
        enabledModules,
      });
      return c.json(
        {
          available: true as const,
          guild,
          categories: tree.map((group) => ({
            id: group.category?.id ?? null,
            name: group.category?.name ?? null,
            viewable: group.category ? isViewable(group.category) : true,
            channels: group.channels.map(({ channel, threads }) => {
              const enabled = enabledIn(channel.id);
              return { ...channelJson(channel, enabled), threads: threads.map((th) => channelJson(th, enabled)) };
            }),
          })),
        },
        200,
      );
    })
    .get('/:id/overview', (c) => {
      if (!ready()) return c.json({ available: false as const }, 200);
      const guild = guilds.guild(c.req.param('id'));
      if (!guild) return c.json({ error: 'unknown guild' }, 404);
      const channelIds = guilds
        .channels(guild.id)
        .filter((ch) => ch.kind !== 'category' && ch.kind !== 'thread')
        .map((ch) => ch.id);
      const enabledIn = enabledModuleIds(runtime);
      const counts = new Map<string, number>();
      for (const id of channelIds) for (const m of enabledIn(id)) counts.set(m, (counts.get(m) ?? 0) + 1);
      return c.json(
        {
          available: true as const,
          guild,
          modules: runtime.modules.map((module) => ({
            id: module.id,
            name: module.name,
            enabled: store.readGlobal(module).enabled === true,
            status: runtime.status(module.id),
            enabledChannels: counts.get(module.id) ?? 0,
          })),
        },
        200,
      );
    });
}
