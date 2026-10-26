import type { ChannelResolver } from './runtime.js';

interface CachedChannel {
  guildId?: string | null;
  parentId?: string | null;
  isThread(): boolean;
}

/** The slice of a discord.js Client the resolver reads. */
export interface ChannelCacheSource {
  channels: { cache: { get(id: string): CachedChannel | undefined } };
}

/** Resolve channels from the discord.js cache: threads and forum posts map to their parent. */
export function discordChannelResolver(client: ChannelCacheSource): ChannelResolver {
  return {
    resolve(channelId) {
      const channel = client.channels.cache.get(channelId);
      const guildId = channel?.guildId ?? null;
      if (channel?.isThread() && channel.parentId) return { channelId: channel.parentId, guildId };
      return { channelId, guildId };
    },
  };
}
