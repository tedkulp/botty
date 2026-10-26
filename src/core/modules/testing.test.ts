import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModule } from './define.js';
import { createTestContext } from './testing.js';

/** A dummy Module: reacts 👀 to every human message, echoing config and snapshots into Activity. */
const echo = defineModule({
  id: 'echo',
  name: 'Echo',
  channelDefault: false,
  permissions: ['ViewChannel', 'AddReactions'],
  configSchema: {
    global: z.object({ prefix: z.string().default('>'), apiKey: z.string().meta({ secret: true }).optional() }),
    channel: z.object({ tag: z.string().default('none') }),
  },
  setup(ctx) {
    ctx.on('messageCreate', async (message) => {
      if (message.author.bot || message.webhookId) return;
      if (message.content === 'boom') throw new Error('kaboom');
      if (message.content === 'sick') return ctx.setStatus('degraded', 'feeling sick');
      const { global, channel } = ctx.config(message.channelId);
      const forwarded = [...message.messageSnapshots.values()].map((s) => s.content).join(',');
      ctx.activity({
        channelId: message.channelId,
        level: 'info',
        message: `${global.prefix} ${channel.tag} ${message.author.username} in #${message.channel.isThread() ? 'thread' : 'channel'} of ${message.guild?.name} [${forwarded}]`,
        link: message.url,
      });
      await message.react('👀');
    });
  },
});

describe('createTestContext', () => {
  it('delivers fake messages to an enabled Module and records reactions and Activity', async () => {
    const t = await createTestContext({ module: echo, globalConfig: { prefix: '#' }, channelConfig: { tag: 'news' } });

    const msg = await t.sendMessage({ content: 'hello', author: { username: 'ada' }, snapshots: ['fwd1'] });

    expect(msg.reactions).toEqual(['👀']);
    expect(t.reactions).toEqual([{ messageId: msg.id, channelId: t.channelId, emoji: '👀' }]);
    expect(t.activity).toEqual([
      expect.objectContaining({
        moduleId: 'echo',
        channelId: t.channelId,
        guildId: t.guildId,
        message: '# news ada in #channel of Test Guild [fwd1]',
        link: msg.url,
      }),
    ]);
  });

  it('skips bot and webhook messages in the Module under test', async () => {
    const t = await createTestContext({ module: echo });

    await t.sendMessage({ content: 'x', author: { bot: true } });
    await t.sendMessage({ content: 'x', webhook: true });

    expect(t.reactions).toEqual([]);
  });

  it('only delivers in channels where the Module is Enabled', async () => {
    const t = await createTestContext({ module: echo });

    await t.sendMessage({ content: 'x', channelId: 'other' });
    expect(t.reactions).toEqual([]);

    t.setChannelEnabled('other', true);
    await t.sendMessage({ content: 'x', channelId: 'other' });
    expect(t.reactions).toHaveLength(1);
  });

  it('routes thread messages through the parent channel config and enablement', async () => {
    const t = await createTestContext({ module: echo, channelConfig: { tag: 'parent' } });

    await t.sendMessage({ content: 'x', thread: true });

    expect(t.activity[0]?.message).toBe('> parent ada in #thread of Test Guild []');
  });

  it('records status changes from handlers and from caught errors', async () => {
    const t = await createTestContext({ module: echo });

    await t.sendMessage({ content: 'sick' });
    await t.sendMessage({ content: 'boom' });

    expect(t.statusChanges).toEqual([
      { level: 'degraded', message: 'feeling sick' },
      { level: 'error', message: 'kaboom' },
    ]);
    expect(t.status()).toEqual({ level: 'error', message: 'kaboom' });
  });

  it('applies config edits on the next event', async () => {
    const t = await createTestContext({ module: echo });

    t.setGlobalConfig({ prefix: '!' });
    await t.sendMessage({ content: 'x' });

    expect(t.activity.at(-1)?.message).toMatch(/^! none/);
  });

  it('rejects invalid initial config', async () => {
    await expect(createTestContext({ module: echo, globalConfig: { prefix: 5 as unknown as string } })).rejects.toThrow(/prefix/);
  });
});
