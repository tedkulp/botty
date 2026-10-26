import { EventEmitter } from 'node:events';
import type { Message } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDatabase, runMigrations, type DatabaseHandle } from '../db/index.js';
import { createLogger } from '../logger.js';
import type { ActivityEntryInput } from './activity.js';
import { createConfigStore, type ConfigStore } from './config-store.js';
import { defineModule, type AnyModule, type ModuleContext } from './define.js';
import { createModuleRuntime, type ChannelResolver, type ModuleRuntime } from './runtime.js';

const admin = { sub: 'sub-1', name: 'Ada' };
const empty = { global: z.object({}), channel: z.object({ tag: z.string().default('none') }) };

/** Channels: c1 and c2 in g1; t1 is a thread under c1. */
const channels: ChannelResolver = {
  resolve(channelId) {
    if (channelId === 't1') return { channelId: 'c1', guildId: 'g1' };
    return { channelId, guildId: 'g1' };
  },
};

function message(channelId: string): Message {
  return { channelId, guildId: 'g1', content: 'hi' } as unknown as Message;
}

function recorder(id: string, opts: { channelDefault?: boolean; throws?: boolean } = {}) {
  const seen: string[] = [];
  const cleanups: string[] = [];
  const module = defineModule({
    id,
    name: id,
    channelDefault: opts.channelDefault ?? false,
    permissions: [],
    configSchema: empty,
    setup(ctx) {
      ctx.on('messageCreate', (m) => {
        if (opts.throws) throw new Error(`${id} exploded`);
        seen.push(m.channelId);
      });
      return () => cleanups.push(id);
    },
  });
  return { module, seen, cleanups };
}

let handle: DatabaseHandle;
let store: ConfigStore;
let events: EventEmitter;
let activity: ActivityEntryInput[];
beforeEach(() => {
  handle = openDatabase(':memory:');
  runMigrations(handle);
  store = createConfigStore(handle.db);
  events = new EventEmitter();
  activity = [];
});
afterEach(() => handle.close());

function runtime(modules: AnyModule[]): ModuleRuntime {
  return createModuleRuntime({
    modules,
    store,
    events,
    channels,
    logger: createLogger('silent'),
    activity: { write: (e) => void activity.push(e) },
  });
}

async function emit(rt: ModuleRuntime, channelId: string) {
  events.emit('messageCreate', message(channelId));
  await rt.settled();
}

describe('module runtime routing', () => {
  it('delivers an event only to Modules Enabled in its channel', async () => {
    const a = recorder('a');
    const b = recorder('b');
    const off = recorder('off', { channelDefault: true });
    store.setGlobalEnabled('a', true, admin);
    store.setGlobalEnabled('b', true, admin);
    store.setChannelEnabled('a', { channelId: 'c1', guildId: 'g1' }, true, admin);
    const rt = runtime([a.module, b.module, off.module]);
    await rt.start();

    await emit(rt, 'c1');
    await emit(rt, 'c2');

    expect(a.seen).toEqual(['c1']);
    expect(b.seen).toEqual([]);
    expect(off.seen).toEqual([]);
  });

  it('routes a thread message by its parent channel', async () => {
    const a = recorder('a');
    store.setGlobalEnabled('a', true, admin);
    store.setChannelEnabled('a', { channelId: 'c1', guildId: 'g1' }, true, admin);
    const rt = runtime([a.module]);
    await rt.start();

    await emit(rt, 't1');

    expect(a.seen).toEqual(['t1']);
  });

  it('keeps delivering to other Modules when one handler throws, and marks it error', async () => {
    const bad = recorder('bad', { channelDefault: true, throws: true });
    const good = recorder('good', { channelDefault: true });
    store.setGlobalEnabled('bad', true, admin);
    store.setGlobalEnabled('good', true, admin);
    const rt = runtime([bad.module, good.module]);
    await rt.start();

    await emit(rt, 'c1');

    expect(good.seen).toEqual(['c1']);
    expect(rt.status('bad')).toEqual({ level: 'error', message: 'bad exploded' });
    expect(rt.status('good')).toEqual({ level: 'ok' });
    expect(rt.lastError('bad')).toMatchObject({ message: 'bad exploded', channelId: 'c1' });
    expect(rt.lastErrorIn('bad', 'c1')).toMatchObject({ message: 'bad exploded' });
    expect(rt.lastErrorIn('bad', 'c2')).toBeNull();
    expect(activity).toContainEqual(
      expect.objectContaining({ moduleId: 'bad', level: 'error', channelId: 'c1', guildId: 'g1' }),
    );
  });

  it('records a thread handler error as the last error in its parent channel', async () => {
    const bad = recorder('bad', { channelDefault: true, throws: true });
    store.setGlobalEnabled('bad', true, admin);
    const rt = runtime([bad.module]);
    await rt.start();

    await emit(rt, 't1');

    expect(rt.lastErrorIn('bad', 'c1')).toMatchObject({ message: 'bad exploded' });
    expect(rt.lastErrorIn('bad', 'c2')).toBeNull();
  });

  it('subscribes to the event source only while some Module listens', async () => {
    const a = recorder('a', { channelDefault: true });
    const rt = runtime([a.module]);
    await rt.start();
    expect(events.listenerCount('messageCreate')).toBe(0);

    await rt.setModuleGlobalEnabled('a', true, admin);
    expect(events.listenerCount('messageCreate')).toBe(1);

    await rt.setModuleGlobalEnabled('a', false, admin);
    expect(events.listenerCount('messageCreate')).toBe(0);
  });

  it('ignores events outside a guild', async () => {
    const a = recorder('a', { channelDefault: true });
    store.setGlobalEnabled('a', true, admin);
    const rt = runtime([a.module]);
    await rt.start();

    events.emit('messageCreate', { channelId: 'dm', guildId: null } as unknown as Message);
    await rt.settled();

    expect(a.seen).toEqual([]);
  });
});

describe('module runtime lifecycle', () => {
  it('runs setup at start only for Modules on globally', async () => {
    const on = recorder('on', { channelDefault: true });
    const off = recorder('off', { channelDefault: true });
    store.setGlobalEnabled('on', true, admin);
    const rt = runtime([on.module, off.module]);
    await rt.start();

    expect(rt.isRunning('on')).toBe(true);
    expect(rt.isRunning('off')).toBe(false);
  });

  it('switching off globally runs cleanup and stops events', async () => {
    const a = recorder('a', { channelDefault: true });
    store.setGlobalEnabled('a', true, admin);
    const rt = runtime([a.module]);
    await rt.start();

    const status = await rt.setModuleGlobalEnabled('a', false, admin);

    expect(status).toEqual({ level: 'ok' });
    expect(a.cleanups).toEqual(['a']);
    expect(store.readGlobal(a.module).enabled).toBe(false);
    await emit(rt, 'c1');
    expect(a.seen).toEqual([]);
    expect(activity).toContainEqual(
      expect.objectContaining({ moduleId: 'a', level: 'info', actor: admin, message: expect.stringMatching(/off/) }),
    );
  });

  it('switching on globally runs setup and returns the status setup set', async () => {
    const mod = defineModule({
      id: 'warm',
      name: 'warm',
      channelDefault: true,
      permissions: [],
      configSchema: empty,
      setup(ctx) {
        ctx.setStatus('degraded', 'not configured');
      },
    });
    const rt = runtime([mod]);
    await rt.start();

    const status = await rt.setModuleGlobalEnabled('warm', true, admin);

    expect(status).toEqual({ level: 'degraded', message: 'not configured' });
    expect(rt.isRunning('warm')).toBe(true);
    expect(store.readGlobal(mod).enabled).toBe(true);
  });

  it('returns an error status when setup throws, and records it', async () => {
    const mod = defineModule({
      id: 'boom',
      name: 'boom',
      channelDefault: true,
      permissions: [],
      configSchema: empty,
      async setup(ctx) {
        ctx.on('messageCreate', () => {});
        throw new Error('setup failed');
      },
    });
    const rt = runtime([mod]);
    await rt.start();

    const status = await rt.setModuleGlobalEnabled('boom', true, admin);

    expect(status).toEqual({ level: 'error', message: 'setup failed' });
    expect(rt.lastError('boom')).toMatchObject({ message: 'setup failed' });
    expect(events.listenerCount('messageCreate')).toBe(0);
    expect(activity).toContainEqual(expect.objectContaining({ moduleId: 'boom', level: 'error' }));
  });

  it('a throwing setup at start does not stop other Modules', async () => {
    const bad = defineModule({
      id: 'bad',
      name: 'bad',
      channelDefault: true,
      permissions: [],
      configSchema: empty,
      setup() {
        throw new Error('nope');
      },
    });
    const good = recorder('good', { channelDefault: true });
    store.setGlobalEnabled('bad', true, admin);
    store.setGlobalEnabled('good', true, admin);
    const rt = runtime([bad, good.module]);
    await rt.start();

    expect(rt.status('bad').level).toBe('error');
    expect(rt.isRunning('good')).toBe(true);
  });

  it('setModuleChannelEnabled stores the choice and logs Activity', async () => {
    const a = recorder('a');
    store.setGlobalEnabled('a', true, admin);
    const rt = runtime([a.module]);
    await rt.start();

    rt.setModuleChannelEnabled('a', { channelId: 'c2', guildId: 'g1' }, true, admin);
    await emit(rt, 'c2');

    expect(a.seen).toEqual(['c2']);
    expect(rt.isEnabledIn('a', 'c2')).toBe(true);
    expect(activity).toContainEqual(
      expect.objectContaining({ moduleId: 'a', channelId: 'c2', guildId: 'g1', actor: admin }),
    );
  });

  it('stop runs every cleanup', async () => {
    const a = recorder('a', { channelDefault: true });
    store.setGlobalEnabled('a', true, admin);
    const rt = runtime([a.module]);
    await rt.start();

    await rt.stop();

    expect(a.cleanups).toEqual(['a']);
    expect(events.listenerCount('messageCreate')).toBe(0);
  });

  it('rejects unknown Module ids', async () => {
    const rt = runtime([]);
    await expect(rt.setModuleGlobalEnabled('ghost', true, admin)).rejects.toThrow(/ghost/);
  });
});

describe('module ctx', () => {
  it('reads Global and Channel config at call time, resolving threads to parents', async () => {
    let ctx!: ModuleContext;
    const mod = defineModule({
      id: 'cfg',
      name: 'cfg',
      channelDefault: true,
      permissions: [],
      configSchema: { global: z.object({ n: z.number().default(1) }), channel: z.object({ tag: z.string().default('none') }) },
      setup(c) {
        ctx = c as unknown as ModuleContext;
      },
    });
    store.setGlobalEnabled('cfg', true, admin);
    const rt = runtime([mod]);
    await rt.start();

    store.writeGlobalConfig(mod, { n: 2 }, admin);
    store.writeChannelConfig(mod, { channelId: 'c1', guildId: 'g1' }, { tag: 'x' }, admin);

    expect(ctx.globalConfig()).toEqual({ n: 2 });
    expect(ctx.config('t1')).toEqual({ global: { n: 2 }, channel: { tag: 'x' } });
  });

  it('writes Module Activity with the guild filled in, and status transitions into error/degraded', async () => {
    let ctx!: ModuleContext;
    const mod = defineModule({
      id: 'act',
      name: 'act',
      channelDefault: true,
      permissions: [],
      configSchema: empty,
      setup(c) {
        ctx = c as unknown as ModuleContext;
      },
    });
    store.setGlobalEnabled('act', true, admin);
    const rt = runtime([mod]);
    await rt.start();
    activity.length = 0;

    ctx.activity({ channelId: 'c1', level: 'info', message: 'saved 1 link', link: 'https://discord.com/x' });
    ctx.setStatus('degraded', 'list missing');
    ctx.setStatus('degraded', 'list missing');
    ctx.setStatus('ok');

    expect(activity).toEqual([
      { moduleId: 'act', guildId: 'g1', channelId: 'c1', level: 'info', message: 'saved 1 link', link: 'https://discord.com/x' },
      expect.objectContaining({ moduleId: 'act', level: 'warn', message: expect.stringMatching(/list missing/) }),
    ]);
    expect(rt.status('act')).toEqual({ level: 'ok' });
  });

  it('records config edits as Activity with the Admin', async () => {
    const a = recorder('a');
    const rt = runtime([a.module]);
    await rt.start();

    rt.updateGlobalConfig('a', {}, admin);
    rt.updateChannelConfig('a', { channelId: 'c1', guildId: 'g1' }, { tag: 'y' }, admin);

    expect(store.readChannel(a.module, 'c1').config).toEqual({ tag: 'y' });
    expect(activity.filter((e) => e.actor)).toHaveLength(2);
  });
});
