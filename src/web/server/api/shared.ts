import type { DiscordStatusSource } from '../../../core/discord.js';
import type { CachedChannel, GuildCache } from '../../../core/guild-cache.js';
import type { Actor, AnyModule, ChannelRef, ConfigStore, ModuleRuntime } from '../../../core/modules/index.js';

/** What the Discord-backed routes (guilds, channels, unavailable channels) need. */
export interface DiscordApiDeps {
  /** Writes (switches, config) go through the runtime so the core writes Activity entries. */
  runtime: ModuleRuntime;
  /** Reads only. */
  store: ConfigStore;
  discord: DiscordStatusSource;
  guilds: GuildCache;
}

/** Whether the guild cache can be trusted: Discord is connected. */
export function discordReady(discord: DiscordStatusSource): boolean {
  return discord.state() === 'ready';
}

/** The registered Module with this id, or undefined (for a 404). */
export function findModule(runtime: ModuleRuntime, id: string | undefined): AnyModule | undefined {
  return runtime.modules.find((m) => m.id === id);
}

/** JSON shape of who last edited a stored config row, and when. */
export function lastEditedJson(row: { updatedBy: Actor | null; updatedAt: Date | null }) {
  return { updatedBy: row.updatedBy, updatedAt: row.updatedAt?.toISOString() ?? null };
}

/** The store/runtime reference for a cached channel. */
export function channelRef(channel: CachedChannel): ChannelRef {
  return { channelId: channel.id, guildId: channel.guildId };
}
