import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestContext, type TestContext } from '../../core/modules/testing.js';
import { modules } from '../index.js';
import { FakeKarakeepClient } from './fake-karakeep.js';
import { KarakeepError } from './karakeep.js';
import { channelConfigSchema, createLinkCollector, globalConfigSchema } from './module.js';

const CONFIGURED = { karakeepUrl: 'https://karakeep.example', apiKey: 'secret-key' };

type LinkCollector = ReturnType<typeof createLinkCollector>;

let t: TestContext<LinkCollector> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(
  opts: {
    globalConfig?: z.input<typeof globalConfigSchema>;
    channelConfig?: z.input<typeof channelConfigSchema>;
  } = {},
) {
  const karakeep = new FakeKarakeepClient();
  const delays: number[] = [];
  const module = createLinkCollector({
    client: () => karakeep,
    sleep: async (ms) => void delays.push(ms),
  });
  t = await createTestContext({
    module,
    globalConfig: opts.globalConfig ?? CONFIGURED,
    ...(opts.channelConfig ? { channelConfig: opts.channelConfig } : {}),
  });
  return { t, karakeep, delays };
}

/** Activity entries the Module wrote for messages (they carry the jump-link). */
const messageEntries = (ctx: TestContext<LinkCollector>) => ctx.activity.filter((e) => e.link !== undefined);

describe('link collector config schema', () => {
  it('parses defaults and converts both schemas to JSON Schema', () => {
    expect(globalConfigSchema.parse({})).toEqual({
      defaultTags: [],
      ignoredDomains: ['discord.com', 'cdn.discordapp.com', 'tenor.com', 'giphy.com'],
    });
    expect(channelConfigSchema.parse({})).toEqual({ tags: [] });
    expect(() => z.toJSONSchema(globalConfigSchema)).not.toThrow();
    expect(() => z.toJSONSchema(channelConfigSchema)).not.toThrow();
  });

  it('is registered with the documented contract', () => {
    const registered = modules.find((m) => m.id === 'link-collector');
    expect(registered).toBeDefined();
    expect(registered!.channelDefault).toBe(false);
    expect([...registered!.permissions].sort()).toEqual(['AddReactions', 'ReadMessageHistory', 'ViewChannel']);
  });
});

describe('link collector on messageCreate', () => {
  it('creates a new URL with the provenance note, tags and list, then reacts ✅', async () => {
    const { t, karakeep } = await setup({
      globalConfig: { ...CONFIGURED, defaultTags: ['discord'], defaultListId: 'list-global' },
      channelConfig: { tags: ['reading', 'discord'], listId: 'list-chan' },
    });

    const msg = await t.sendMessage({
      content: 'look https://example.com/a?utm_source=x',
      author: { username: 'ada', displayName: 'Ada L' },
    });

    expect(karakeep.bookmarks.get('https://example.com/a')).toEqual({
      id: 'bm_1',
      url: 'https://example.com/a',
      note: `Shared by Ada L in #general (Test Guild): ${msg.url}`,
      tags: ['discord', 'reading'],
    });
    expect(karakeep.lists.get('list-chan')).toEqual(new Set(['bm_1']));
    expect(karakeep.lists.has('list-global')).toBe(false);
    expect(msg.reactions).toEqual(['✅']);
    expect(t.status()).toEqual({ level: 'ok' });
    expect(messageEntries(t)).toEqual([
      expect.objectContaining({ level: 'info', channelId: t.channelId, link: msg.url }),
    ]);
    const entry = messageEntries(t)[0]!;
    expect(entry.message).toContain('Ada L');
    expect(entry.message).toContain('bm_1');
    expect(entry.message).not.toContain('look');
  });

  it('adds tags and list to an existing bookmark without creating it, then reacts ✅', async () => {
    const { t, karakeep } = await setup({
      globalConfig: { ...CONFIGURED, defaultTags: ['discord'], defaultListId: 'list-global' },
    });
    await karakeep.createBookmark('https://example.com/dup', 'older note');
    karakeep.calls.length = 0;

    const msg = await t.sendMessage({ content: 'https://example.com/dup' });

    expect(karakeep.calls.map((c) => c.method)).toEqual(['checkUrl', 'attachTags', 'addToList']);
    expect(karakeep.bookmarks.get('https://example.com/dup')).toMatchObject({ note: 'older note', tags: ['discord'] });
    expect(karakeep.lists.get('list-global')).toEqual(new Set(['bm_1']));
    expect(msg.reactions).toEqual(['✅']);
  });

  it('ignores bot and webhook messages', async () => {
    const { t, karakeep } = await setup();

    const fromBot = await t.sendMessage({ content: 'https://example.com', author: { bot: true } });
    const fromWebhook = await t.sendMessage({ content: 'https://example.com', webhook: true });

    expect(karakeep.calls).toEqual([]);
    expect(fromBot.reactions).toEqual([]);
    expect(fromWebhook.reactions).toEqual([]);
    expect(messageEntries(t)).toEqual([]);
  });

  it('sets status error "not configured" and does not react when Karakeep is not configured', async () => {
    const { t, karakeep } = await setup({ globalConfig: { karakeepUrl: 'https://karakeep.example' } });

    const msg = await t.sendMessage({ content: 'https://example.com' });

    expect(t.status()).toEqual({ level: 'error', message: 'not configured' });
    expect(msg.reactions).toEqual([]);
    expect(karakeep.calls).toEqual([]);
  });

  it('does not react when the message has no saveable URL', async () => {
    const { t, karakeep } = await setup();

    const msg = await t.sendMessage({ content: 'gif https://tenor.com/view/x and no links' });

    expect(msg.reactions).toEqual([]);
    expect(karakeep.calls).toEqual([]);
    expect(messageEntries(t)).toEqual([]);
  });

  it('falls back to the Global defaultListId when the Channel config has no listId', async () => {
    const { t, karakeep } = await setup({
      globalConfig: { ...CONFIGURED, defaultListId: 'list-global' },
      channelConfig: { tags: ['chan'] },
    });

    await t.sendMessage({ content: 'https://example.com/x' });

    expect(karakeep.lists.get('list-global')).toEqual(new Set(['bm_1']));
    expect(karakeep.bookmarks.get('https://example.com/x')?.tags).toEqual(['chan']);
  });

  it('saves URLs from forwarded messages', async () => {
    const { t, karakeep } = await setup();

    await t.sendMessage({ content: '', snapshots: ['fwd https://example.com/fwd'] });

    expect(karakeep.bookmarks.has('https://example.com/fwd')).toBe(true);
  });
});

describe('link collector failures', () => {
  it('retries a retryable error and saves when Karakeep recovers', async () => {
    const { t, karakeep, delays } = await setup();
    karakeep.failNext('checkUrl', 'retryable').failNext('checkUrl', 'retryable');

    const msg = await t.sendMessage({ content: 'https://example.com/flaky' });

    expect(delays).toHaveLength(2);
    expect(karakeep.bookmarks.has('https://example.com/flaky')).toBe(true);
    expect(msg.reactions).toEqual(['✅']);
  });

  it('gives up after 3 retries of 429 (about a minute), reacts ❌ and goes degraded', async () => {
    const { t, karakeep, delays } = await setup();
    const tooMany = new KarakeepError({ kind: 'retryable', status: 429, body: 'Too many requests', message: '429' });
    for (let i = 0; i < 4; i++) karakeep.failNext('checkUrl', tooMany);

    const msg = await t.sendMessage({ content: 'https://example.com/busy' });

    expect(karakeep.calls.filter((c) => c.method === 'checkUrl')).toHaveLength(4);
    expect(delays).toHaveLength(3);
    const total = delays.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(50_000);
    expect(total).toBeLessThanOrEqual(70_000);
    expect(msg.reactions).toEqual(['❌']);
    expect(t.status().level).toBe('degraded');
    expect(t.status().message).toContain('429');
    const [entry] = messageEntries(t);
    expect(entry).toMatchObject({ level: 'error', link: msg.url });
    expect(entry!.message).toContain('https://example.com/busy');
  });

  it('does not retry a 401, reacts ❌ and sets status error', async () => {
    const { t, karakeep, delays } = await setup();
    karakeep.failNext(
      'checkUrl',
      new KarakeepError({ kind: 'auth', status: 401, body: 'Unauthorized', message: '401' }),
    );

    const msg = await t.sendMessage({ content: 'https://example.com/a https://example.com/b' });

    expect(delays).toEqual([]);
    expect(karakeep.calls.map((c) => c.method)).toEqual(['checkUrl']);
    expect(msg.reactions).toEqual(['❌']);
    expect(t.status().level).toBe('error');
    expect(t.status().message).toContain('401');
  });

  it('counts the URL as saved when adding it to the list fails, reacts ✅ and goes degraded', async () => {
    const { t, karakeep } = await setup({ globalConfig: { ...CONFIGURED, defaultListId: 'smart-list' } });
    karakeep.failNext(
      'addToList',
      new KarakeepError({ kind: 'client', status: 400, body: 'Smart lists cannot be added to', message: '400' }),
    );

    const msg = await t.sendMessage({ content: 'https://example.com/x' });

    expect(karakeep.bookmarks.has('https://example.com/x')).toBe(true);
    expect(msg.reactions).toEqual(['✅']);
    expect(t.status().level).toBe('degraded');
    expect(t.status().message).toContain('smart-list');
    expect(t.status().message).toContain('400');
  });

  it('processes only the first 20 of 21+ URLs and adds ⚠️', async () => {
    const { t, karakeep } = await setup();
    const urls = Array.from({ length: 23 }, (_, i) => `https://example.com/${i}`);

    const msg = await t.sendMessage({ content: urls.join(' ') });

    expect(karakeep.bookmarks.size).toBe(20);
    expect(karakeep.bookmarks.has('https://example.com/20')).toBe(false);
    expect(msg.reactions).toEqual(['✅', '⚠️']);
    const [entry] = messageEntries(t);
    expect(entry!.message).toContain('3');
  });

  it('sets status back to ok after a message saves fully', async () => {
    const { t, karakeep } = await setup();
    for (let i = 0; i < 4; i++) karakeep.failNext('createBookmark', 'retryable');
    await t.sendMessage({ content: 'https://example.com/1' });
    expect(t.status().level).toBe('degraded');

    const msg = await t.sendMessage({ content: 'https://example.com/2' });

    expect(msg.reactions).toEqual(['✅']);
    expect(t.status()).toEqual({ level: 'ok' });
  });

  it('recovers from "not configured" once Karakeep is configured', async () => {
    const { t } = await setup({ globalConfig: {} });
    await t.sendMessage({ content: 'https://example.com/1' });
    expect(t.status().level).toBe('error');

    t.setGlobalConfig(CONFIGURED);
    const msg = await t.sendMessage({ content: 'https://example.com/1' });

    expect(msg.reactions).toEqual(['✅']);
    expect(t.status()).toEqual({ level: 'ok' });
  });
});
