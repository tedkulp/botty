import { EventEmitter } from 'node:events';
import type { Message } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDatabase, runMigrations, type DatabaseHandle } from '../db/index.js';
import { createLogger } from '../logger.js';
import { createActivityStore, type ActivityStore } from './activity-store.js';
import { createConfigStore, type ConfigStore } from './config-store.js';
import { defineModule, type ModuleContext } from './define.js';
import { createModuleRuntime, type ChannelResolver } from './runtime.js';

const admin = { sub: 'sub-1', name: 'Ada' };
const DAY = 24 * 60 * 60 * 1000;

let handle: DatabaseHandle;
let now: Date;
let store: ActivityStore;
beforeEach(() => {
  handle = openDatabase(':memory:');
  runMigrations(handle);
  now = new Date('2026-10-01T12:00:00Z');
  store = createActivityStore(handle.db, { now: () => now });
});
afterEach(() => handle.close());

describe('activity store', () => {
  it('returns a written entry with its actor and timestamp', () => {
    store.write({
      moduleId: 'm',
      guildId: 'g1',
      channelId: 'c1',
      level: 'info',
      message: 'saved 1 link',
      link: 'https://discord.com/channels/g1/c1/1',
      actor: admin,
    });

    expect(store.listActivity({ moduleId: 'm' })).toEqual([
      {
        id: expect.any(Number),
        moduleId: 'm',
        guildId: 'g1',
        channelId: 'c1',
        level: 'info',
        message: 'saved 1 link',
        link: 'https://discord.com/channels/g1/c1/1',
        actor: admin,
        createdAt: now,
      },
    ]);
  });

  it('filters by guild and channel, newest first, and only for the asked Module', () => {
    store.write({ moduleId: 'm', guildId: 'g1', channelId: 'c1', level: 'info', message: 'one' });
    store.write({ moduleId: 'm', guildId: 'g1', channelId: 'c2', level: 'info', message: 'two' });
    store.write({ moduleId: 'm', guildId: 'g2', channelId: 'c3', level: 'info', message: 'three' });
    store.write({ moduleId: 'm', level: 'info', message: 'global' });
    store.write({ moduleId: 'other', guildId: 'g1', channelId: 'c1', level: 'info', message: 'not mine' });

    const messages = (q: Parameters<ActivityStore['listActivity']>[0]) =>
      store.listActivity(q).map((e) => e.message);
    expect(messages({ moduleId: 'm' })).toEqual(['global', 'three', 'two', 'one']);
    expect(messages({ moduleId: 'm', guildId: 'g1' })).toEqual(['two', 'one']);
    expect(messages({ moduleId: 'm', channelId: 'c1' })).toEqual(['one']);
    expect(messages({ moduleId: 'm', guildId: 'g2', channelId: 'c1' })).toEqual([]);
  });

  it('pages with limit and before', () => {
    for (let i = 1; i <= 5; i++) store.write({ moduleId: 'm', level: 'info', message: `#${i}` });

    const first = store.listActivity({ moduleId: 'm', limit: 2 });
    const second = store.listActivity({ moduleId: 'm', limit: 2, before: first.at(-1)!.id });
    const third = store.listActivity({ moduleId: 'm', limit: 2, before: second.at(-1)!.id });

    expect(first.map((e) => e.message)).toEqual(['#5', '#4']);
    expect(second.map((e) => e.message)).toEqual(['#3', '#2']);
    expect(third.map((e) => e.message)).toEqual(['#1']);
  });
});

describe('activity pruning on insert', () => {
  const all = (moduleId: string) => {
    const out = [];
    let page = store.listActivity({ moduleId, limit: 200 });
    while (page.length) {
      out.push(...page);
      page = store.listActivity({ moduleId, limit: 200, before: page.at(-1)!.id });
    }
    return out.map((e) => e.message);
  };

  it('removes entries older than 30 days, for every Module', () => {
    store.write({ moduleId: 'm', level: 'info', message: 'old' });
    store.write({ moduleId: 'other', level: 'info', message: 'old other' });
    now = new Date(now.getTime() + 30 * DAY - 1);
    store.write({ moduleId: 'm', level: 'info', message: 'within 30 days' });
    expect(all('m')).toEqual(['within 30 days', 'old']);

    now = new Date(now.getTime() + 2);
    store.write({ moduleId: 'm', level: 'info', message: 'new' });

    expect(all('m')).toEqual(['new', 'within 30 days']);
    expect(all('other')).toEqual([]);
  });

  it('the 1001st entry evicts the oldest, and only for that Module', () => {
    store.write({ moduleId: 'other', level: 'info', message: 'other 1' });
    for (let i = 1; i <= 1000; i++) store.write({ moduleId: 'm', level: 'info', message: `#${i}` });
    expect(all('m')).toHaveLength(1000);

    store.write({ moduleId: 'm', level: 'info', message: '#1001' });

    const kept = all('m');
    expect(kept).toHaveLength(1000);
    expect(kept[0]).toBe('#1001');
    expect(kept.at(-1)).toBe('#2');
    expect(all('other')).toEqual(['other 1']);
  });
});

describe('core-written Activity entries', () => {
  /** c1 and c2 in g1; t1 is a thread under c1. */
  const channels: ChannelResolver = {
    resolve: (id) => (id === 't1' ? { channelId: 'c1', guildId: 'g1' } : { channelId: id, guildId: 'g1' }),
  };
  const schema = { global: z.object({ n: z.number().default(1) }), channel: z.object({ tag: z.string().default('') }) };

  let events: EventEmitter;
  let config: ConfigStore;
  let ctx: ModuleContext;
  let handlerError: Error | null;
  let setupError: Error | null;
  const mod = defineModule({
    id: 'm',
    name: 'm',
    channelDefault: true,
    permissions: [],
    configSchema: schema,
    setup(c) {
      if (setupError) throw setupError;
      ctx = c as unknown as ModuleContext;
      c.on('messageCreate', () => {
        if (handlerError) throw handlerError;
      });
    },
  });

  beforeEach(() => {
    events = new EventEmitter();
    config = createConfigStore(handle.db);
    handlerError = null;
    setupError = null;
  });

  async function started() {
    const rt = createModuleRuntime({
      modules: [mod],
      store: config,
      events,
      channels,
      logger: createLogger('silent'),
      activity: store,
    });
    await rt.start();
    return rt;
  }
  const entries = () => store.listActivity({ moduleId: 'm' });

  it('a global switch writes one entry with the actor', async () => {
    const rt = await started();
    await rt.setModuleGlobalEnabled('m', true, admin);
    expect(entries()).toEqual([
      expect.objectContaining({ level: 'info', actor: admin, guildId: null, channelId: null }),
    ]);
  });

  it('a channel switch writes one entry with the actor and channel', async () => {
    const rt = await started();
    rt.setModuleChannelEnabled('m', { channelId: 'c1', guildId: 'g1' }, false, admin);
    expect(entries()).toEqual([expect.objectContaining({ actor: admin, guildId: 'g1', channelId: 'c1' })]);
  });

  it('a Global config edit writes one entry with the actor', async () => {
    const rt = await started();
    rt.updateGlobalConfig('m', { n: 2 }, admin);
    expect(entries()).toEqual([expect.objectContaining({ actor: admin, channelId: null })]);
  });

  it('a Channel config edit writes one entry with the actor', async () => {
    const rt = await started();
    rt.updateChannelConfig('m', { channelId: 'c2', guildId: 'g1' }, { tag: 'x' }, admin);
    expect(entries()).toEqual([expect.objectContaining({ actor: admin, guildId: 'g1', channelId: 'c2' })]);
  });

  it('a caught setup error writes one error entry', async () => {
    config.setGlobalEnabled('m', true, admin);
    setupError = new Error('no token');
    await started();
    expect(entries()).toEqual([
      expect.objectContaining({ level: 'error', message: expect.stringMatching(/no token/), actor: null }),
    ]);
  });

  it('a caught handler error in a thread writes one error entry against the parent channel', async () => {
    config.setGlobalEnabled('m', true, admin);
    const rt = await started();
    handlerError = new Error('kaboom');
    events.emit('messageCreate', { channelId: 't1', guildId: 'g1' } as unknown as Message);
    await rt.settled();
    expect(entries()).toEqual([
      expect.objectContaining({
        level: 'error',
        guildId: 'g1',
        channelId: 'c1',
        message: expect.stringMatching(/kaboom/),
      }),
    ]);
  });

  it('status transitions into degraded or error write one entry each; repeats of a level do not', async () => {
    config.setGlobalEnabled('m', true, admin);
    await started();
    ctx.setStatus('degraded', 'list missing');
    ctx.setStatus('degraded', 'list missing');
    ctx.setStatus('degraded', 'still missing');
    ctx.setStatus('error', 'auth');
    ctx.setStatus('error', 'auth again');
    ctx.setStatus('ok');
    ctx.setStatus('degraded', 'again');
    expect(entries().map((e) => e.level)).toEqual(['warn', 'error', 'warn']);
  });

  it('ctx.activity fills in the guild and resolves a thread to its parent channel', async () => {
    config.setGlobalEnabled('m', true, admin);
    await started();
    ctx.activity({ channelId: 't1', level: 'info', message: 'saved 1 link', link: 'https://discord.com/x' });
    expect(entries()).toEqual([
      expect.objectContaining({
        guildId: 'g1',
        channelId: 'c1',
        message: 'saved 1 link',
        link: 'https://discord.com/x',
        actor: null,
      }),
    ]);
  });
});
