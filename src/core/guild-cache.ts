import { ChannelFlags, ChannelType } from 'discord.js';
import type { PermissionCheck } from './modules/permissions.js';

// The dashboard's read-only view of the guilds and channels the bot can see.
// It is a seam: the API reads plain data from it, `discordGuildCache()` fills
// it from the discord.js cache, and tests use an in-memory fake
// (`createFakeGuildCache()` in src/web/server/testing.ts).

export interface CachedGuild {
  id: string;
  name: string;
  /** Icon image URL, or null for a guild without an icon. */
  icon: string | null;
}

export type ChannelKind =
  | 'category'
  | 'text'
  | 'announcement'
  | 'forum'
  | 'media'
  | 'voice'
  | 'stage'
  | 'thread'
  | 'other';

export interface CachedChannel {
  id: string;
  guildId: string;
  name: string;
  kind: ChannelKind;
  /** The category for a channel, the parent channel for a thread, null at the top level. */
  parentId: string | null;
  /** Discord's raw position (ties are broken by id). */
  position: number;
  /** Discord sent the channel obfuscated (the `CHANNEL_OBFUSCATED` flag). */
  obfuscated: boolean;
  /** `channel.permissionsFor(me)`; null when unknown. */
  permissions: PermissionCheck | null;
}

export interface GuildCache {
  /** The bot's application id once logged in (used for the invite URL). */
  applicationId(): string | null;
  guilds(): CachedGuild[];
  guild(id: string): CachedGuild | null;
  /** Every cached channel in a guild, threads (active ones) included, in no particular order. */
  channels(guildId: string): CachedChannel[];
  channel(id: string): CachedChannel | null;
}

const KINDS: Partial<Record<ChannelType, ChannelKind>> = {
  [ChannelType.GuildCategory]: 'category',
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildMedia]: 'media',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildStageVoice]: 'stage',
  [ChannelType.PublicThread]: 'thread',
  [ChannelType.PrivateThread]: 'thread',
  [ChannelType.AnnouncementThread]: 'thread',
};

/** The slice of a discord.js guild channel the adapter reads. */
interface DiscordChannelLike {
  id: string;
  type: ChannelType;
  name?: string | null;
  guildId?: string | null;
  parentId?: string | null;
  rawPosition?: number;
  flags?: { bitfield: number } | null;
  guild?: { members: { me: unknown } };
  permissionsFor?(member: never): PermissionCheck | null;
}

interface DiscordGuildLike {
  id: string;
  name: string;
  iconURL(options: { size: 64 }): string | null;
  channels: { cache: { values(): Iterable<unknown> } };
}

/** The slice of a discord.js Client the adapter reads. */
export interface GuildCacheClient {
  application?: { id: string } | null;
  user?: { id: string } | null;
  guilds: { cache: { get(id: string): DiscordGuildLike | undefined; values(): Iterable<DiscordGuildLike> } };
  channels: { cache: { get(id: string): unknown } };
}

function toCached(channel: DiscordChannelLike): CachedChannel | null {
  if (!channel.guildId) return null;
  const me = channel.guild?.members.me;
  return {
    id: channel.id,
    guildId: channel.guildId,
    name: channel.name ?? '',
    kind: KINDS[channel.type] ?? 'other',
    parentId: channel.parentId ?? null,
    position: channel.rawPosition ?? 0,
    obfuscated: ((channel.flags?.bitfield ?? 0) & ChannelFlags.ChannelObfuscated) !== 0,
    permissions: me && channel.permissionsFor ? channel.permissionsFor(me as never) : null,
  };
}

function guildJson(g: DiscordGuildLike): CachedGuild {
  return { id: g.id, name: g.name, icon: g.iconURL({ size: 64 }) };
}

/**
 * A GuildCache over a discord.js client's caches, filled by the `Guilds`
 * intent. `guild.channels.cache` holds threads too (active ones).
 */
export function discordGuildCache(client: GuildCacheClient): GuildCache {
  return {
    applicationId: () => client.application?.id ?? client.user?.id ?? null,
    guilds: () => [...client.guilds.cache.values()].map(guildJson),
    guild(id) {
      const g = client.guilds.cache.get(id);
      return g ? guildJson(g) : null;
    },
    channels(guildId) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return [];
      return [...guild.channels.cache.values()]
        .map((c) => toCached(c as DiscordChannelLike))
        .filter((c): c is CachedChannel => c !== null);
    },
    channel(id) {
      const channel = client.channels.cache.get(id) as DiscordChannelLike | undefined;
      return channel ? toCached(channel) : null;
    },
  };
}
