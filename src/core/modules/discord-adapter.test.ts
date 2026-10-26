import { describe, expect, it } from 'vitest';
import { discordChannelResolver } from './discord-adapter.js';

function cache(entries: Record<string, { guildId: string; thread?: string | null }>) {
  return {
    channels: {
      cache: {
        get(id: string) {
          const e = entries[id];
          if (!e) return undefined;
          return { id, guildId: e.guildId, parentId: e.thread ?? null, isThread: () => e.thread !== undefined };
        },
      },
    },
  };
}

describe('discordChannelResolver', () => {
  const resolver = discordChannelResolver(
    cache({ c1: { guildId: 'g1' }, t1: { guildId: 'g1', thread: 'c1' }, post: { guildId: 'g1', thread: 'forum' } }),
  );

  it('resolves a channel to itself with its guild', () => {
    expect(resolver.resolve('c1')).toEqual({ channelId: 'c1', guildId: 'g1' });
  });

  it('resolves threads and forum posts to their parent', () => {
    expect(resolver.resolve('t1')).toEqual({ channelId: 'c1', guildId: 'g1' });
    expect(resolver.resolve('post')).toEqual({ channelId: 'forum', guildId: 'g1' });
  });

  it('resolves an uncached channel to itself with no guild', () => {
    expect(resolver.resolve('gone')).toEqual({ channelId: 'gone', guildId: null });
  });
});
