import { ChannelFlags, ChannelType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { discordGuildCache, type GuildCacheClient } from './guild-cache.js';

// The adapter only reshapes the discord.js cache; these tests feed it objects
// shaped like discord.js channels and guilds.

const me = { id: 'bot' };
const canView = { has: (p: string) => p === 'ViewChannel' };

function channel(id: string, type: ChannelType, extra: Record<string, unknown> = {}) {
  return {
    id,
    type,
    name: id,
    guildId: 'g1',
    parentId: null,
    rawPosition: 3,
    flags: { bitfield: 0 },
    guild: { members: { me } },
    permissionsFor: (member: unknown) => (member === me ? canView : null),
    ...extra,
  };
}

function client(): GuildCacheClient {
  const channels = [
    channel('cat', ChannelType.GuildCategory),
    channel('text', ChannelType.GuildText, { parentId: 'cat' }),
    channel('thread', ChannelType.PublicThread, { parentId: 'text' }),
    channel('hidden', ChannelType.GuildText, { name: '___hidden___', flags: { bitfield: ChannelFlags.ChannelObfuscated } }),
  ];
  const guild = {
    id: 'g1',
    name: 'Homelab',
    iconURL: ({ size }: { size: number }) => `https://cdn.test/g1.png?size=${size}`,
    channels: { cache: new Map(channels.map((c) => [c.id, c])) },
  };
  return {
    application: { id: 'app-9' },
    guilds: { cache: new Map([[guild.id, guild]]) },
    channels: { cache: new Map(channels.map((c) => [c.id, c])) },
  };
}

describe('discordGuildCache', () => {
  const cache = discordGuildCache(client());

  it('lists guilds with their icon URL', () => {
    expect(cache.guilds()).toEqual([{ id: 'g1', name: 'Homelab', icon: 'https://cdn.test/g1.png?size=64' }]);
    expect(cache.guild('nope')).toBeNull();
  });

  it('maps channel types, parents, positions and permissions for the bot', () => {
    const text = cache.channel('text')!;
    expect(text).toMatchObject({ id: 'text', guildId: 'g1', kind: 'text', parentId: 'cat', position: 3, obfuscated: false });
    expect(text.permissions?.has('ViewChannel')).toBe(true);
    expect(cache.channel('cat')?.kind).toBe('category');
    expect(cache.channel('thread')).toMatchObject({ kind: 'thread', parentId: 'text' });
  });

  it('reads the CHANNEL_OBFUSCATED flag', () => {
    expect(cache.channel('hidden')?.obfuscated).toBe(true);
  });

  it('lists every channel of a guild, threads included', () => {
    expect(cache.channels('g1').map((c) => c.id)).toEqual(['cat', 'text', 'thread', 'hidden']);
    expect(cache.channels('nope')).toEqual([]);
  });

  it('knows the application id once logged in', () => {
    expect(cache.applicationId()).toBe('app-9');
    expect(discordGuildCache({ ...client(), application: null, user: null }).applicationId()).toBeNull();
  });
});
