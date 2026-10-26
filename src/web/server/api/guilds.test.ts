import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { DiscordState } from '../../../core/discord.js';
import { defineModule } from '../../../core/modules/index.js';
import { createTestApp, grants, type TestApp } from '../testing.js';

const collector = defineModule({
  id: 'collector',
  name: 'Collector',
  channelDefault: false,
  permissions: ['ViewChannel', 'ReadMessageHistory', 'AddReactions'],
  configSchema: {
    global: z.object({}),
    channel: z.object({
      tags: z.array(z.string()).default([]),
      listId: z.string().optional(),
      token: z.string().optional().meta({ secret: true }),
    }),
  },
  setup() {},
});

const echo = defineModule({
  id: 'echo',
  name: 'Echo',
  channelDefault: true,
  permissions: ['ViewChannel', 'SendMessages'],
  configSchema: { global: z.object({}), channel: z.object({}) },
  setup() {},
});

let t: TestApp;
let discordState: DiscordState;
let cookie: string;

afterEach(() => t?.close());

async function setup() {
  discordState = 'ready';
  t = createTestApp({ modules: [collector, echo], discord: { state: () => discordState } });
  cookie = await t.signIn();
  return t;
}

async function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookie);
  if (init.body) headers.set('Content-Type', 'application/json');
  return t.app.request(path, { ...init, headers });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

describe('GET /api/guilds', () => {
  it('lists the cached guilds with id, name and icon', async () => {
    await setup();
    t.guilds.addGuild({ id: 'g1', name: 'Homelab', icon: 'https://cdn.test/g1.png' });
    t.guilds.addGuild({ id: 'g2', name: 'Board games' });

    const res = await call('/api/guilds');

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      available: true,
      guilds: [
        { id: 'g1', name: 'Homelab', icon: 'https://cdn.test/g1.png' },
        { id: 'g2', name: 'Board games', icon: null },
      ],
    });
  });

  it('answers available: false and no list while Discord is down', async () => {
    await setup();
    t.guilds.addGuild({ id: 'g1', name: 'Homelab' });
    discordState = 'down';

    expect(await json(await call('/api/guilds'))).toEqual({ available: false });
  });
});

/** A small guild, added to the cache deliberately out of order. */
function seedGuild() {
  const g = t.guilds;
  g.addGuild({ id: 'g1', name: 'Homelab' });
  g.addChannel({ id: '30', guildId: 'g1', name: 'Projects', kind: 'category', position: 2 });
  g.addChannel({ id: '31', guildId: 'g1', name: 'botty', parentId: '30', position: 1 });
  g.addChannel({ id: '32', guildId: 'g1', name: 'Hangout', kind: 'voice', parentId: '30', position: 0 });
  g.addChannel({ id: '33', guildId: 'g1', name: 'printing', parentId: '30', position: 0 });
  g.addChannel({ id: '20', guildId: 'g1', name: 'Text', kind: 'category', position: 1 });
  g.addChannel({ id: '22', guildId: 'g1', name: 'links', parentId: '20', position: 1 });
  g.addChannel({ id: '21', guildId: 'g1', name: 'general', parentId: '20', position: 1 });
  g.addChannel({ id: '10', guildId: 'g1', name: 'rules', position: 0 });
  g.addChannel({ id: '41', guildId: 'g1', name: 'recipes', kind: 'thread', parentId: '22' });
  g.addChannel({ id: '40', guildId: 'g1', name: 'rust stuff', kind: 'thread', parentId: '22' });
  g.addGuild({ id: 'g2', name: 'Other' });
  g.addChannel({ id: '90', guildId: 'g2', name: 'elsewhere' });
}

const shape = (body: any) =>
  body.categories.map((cat: any) => [
    cat.name,
    cat.channels.map((ch: any) => [ch.name, ch.threads.map((th: any) => th.name)]),
  ]);

describe('GET /api/guilds/:id/channels', () => {
  it('returns categories and channels in Discord order with threads nested under their parent', async () => {
    await setup();
    seedGuild();

    const res = await call('/api/guilds/g1/channels');

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.available).toBe(true);
    expect(body.guild).toEqual({ id: 'g1', name: 'Homelab', icon: null });
    expect(shape(body)).toEqual([
      [null, [['rules', []]]],
      ['Text', [['general', []], ['links', ['rust stuff', 'recipes']]]],
      ['Projects', [['printing', []], ['botty', []], ['Hangout', []]]],
    ]);
    expect(body.categories[2].channels[2].kind).toBe('voice');
  });

  it('marks obfuscated, hidden and unviewable channels viewable: false', async () => {
    await setup();
    seedGuild();
    t.guilds.addChannel({ id: '50', guildId: 'g1', name: 'mods', obfuscated: true, position: 1 });
    t.guilds.addChannel({ id: '51', guildId: 'g1', name: '___hidden___', position: 2 });
    t.guilds.addChannel({ id: '52', guildId: 'g1', name: 'staff', permissions: grants('SendMessages'), position: 3 });
    t.guilds.addChannel({ id: '53', guildId: 'g1', name: 'unknown perms', permissions: null, position: 4 });

    const body = await json(await call('/api/guilds/g1/channels'));

    const top = body.categories[0].channels.map((ch: any) => [ch.id, ch.viewable]);
    expect(top).toEqual([
      ['10', true],
      ['50', false],
      ['51', false],
      ['52', false],
      ['53', false],
    ]);
  });

  it('lists the Modules Enabled in each channel: on globally AND on for the channel', async () => {
    await setup();
    seedGuild();
    const admin = { sub: 's', name: 'Ada' };
    // Echo: channelDefault true but off globally -> Enabled nowhere.
    // Collector: on globally, channelDefault false, switched on in #links only.
    await t.runtime.setModuleGlobalEnabled('collector', true, admin);
    t.runtime.setModuleChannelEnabled('collector', { channelId: '22', guildId: 'g1' }, true, admin);
    t.runtime.setModuleChannelEnabled('echo', { channelId: '21', guildId: 'g1' }, true, admin);

    const body = await json(await call('/api/guilds/g1/channels'));

    const text = body.categories[1].channels;
    expect(text.map((ch: any) => [ch.name, ch.enabledModules])).toEqual([
      ['general', []],
      ['links', ['collector']],
    ]);
    // Threads follow their parent.
    expect(text[1].threads.map((th: any) => th.enabledModules)).toEqual([['collector'], ['collector']]);

    await t.runtime.setModuleGlobalEnabled('echo', true, admin);
    const after = await json(await call('/api/guilds/g1/channels'));
    expect(after.categories[0].channels[0].enabledModules).toEqual(['echo']);
    expect(after.categories[1].channels[1].enabledModules).toEqual(['collector', 'echo']);
  });

  it('answers available: false while Discord is down, and 404 for a guild not in the cache', async () => {
    await setup();
    seedGuild();
    expect((await call('/api/guilds/nope/channels')).status).toBe(404);

    discordState = 'down';
    expect(await json(await call('/api/guilds/g1/channels'))).toEqual({ available: false });
  });
});

describe('GET /api/guilds/:id/overview', () => {
  it('gives each Module its status and the number of channels in this guild it is Enabled in', async () => {
    await setup();
    seedGuild();
    const admin = { sub: 's', name: 'Ada' };
    await t.runtime.setModuleGlobalEnabled('collector', true, admin);
    t.runtime.setModuleChannelEnabled('collector', { channelId: '22', guildId: 'g1' }, true, admin);
    t.runtime.setModuleChannelEnabled('collector', { channelId: '31', guildId: 'g1' }, true, admin);
    t.runtime.setModuleChannelEnabled('collector', { channelId: '90', guildId: 'g2' }, true, admin);

    const res = await call('/api/guilds/g1/overview');

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      available: true,
      guild: { id: 'g1', name: 'Homelab', icon: null },
      modules: [
        { id: 'collector', name: 'Collector', enabled: true, status: { level: 'ok' }, enabledChannels: 2 },
        { id: 'echo', name: 'Echo', enabled: false, status: { level: 'ok' }, enabledChannels: 0 },
      ],
    });
  });

  it('answers available: false while Discord is down', async () => {
    await setup();
    seedGuild();
    discordState = 'down';
    expect(await json(await call('/api/guilds/g1/overview'))).toEqual({ available: false });
  });
});

const ADMIN = { sub: 's', name: 'Ada' };

describe('GET /api/channels/:id/modules', () => {
  it('gives every Module its channel switch, global switch, schema and Channel config', async () => {
    await setup();
    seedGuild();
    await t.runtime.setModuleGlobalEnabled('collector', true, ADMIN);
    t.runtime.updateChannelConfig('collector', { channelId: '22', guildId: 'g1' }, { tags: ['news'], token: 'shh' }, ADMIN);

    const res = await call('/api/channels/22/modules');

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.channel).toEqual({ id: '22', name: 'links', guildId: 'g1', viewable: true });
    const [col, ech] = body.modules;
    expect(col).toMatchObject({
      id: 'collector',
      name: 'Collector',
      globalEnabled: true,
      channelEnabled: false,
      enabled: false,
      status: { level: 'ok' },
      missingPermissions: [],
      config: { tags: ['news'], token: { set: true } },
      needsReview: false,
      updatedBy: ADMIN,
    });
    expect(col.schema.properties.tags.type).toBe('array');
    expect(typeof col.updatedAt).toBe('string');
    expect(ech).toMatchObject({ id: 'echo', globalEnabled: false, channelEnabled: true, enabled: false, updatedBy: null });
  });

  it('lists the Module permissions the bot lacks in the channel', async () => {
    await setup();
    seedGuild();
    t.guilds.addChannel({ id: '60', guildId: 'g1', name: 'read-only', permissions: grants('ViewChannel', 'AddReactions') });

    const body = await json(await call('/api/channels/60/modules'));

    expect(body.modules.map((m: any) => [m.id, m.missingPermissions])).toEqual([
      ['collector', ['ReadMessageHistory']],
      ['echo', ['SendMessages']],
    ]);
  });

  it('flags a Channel config that needs review', async () => {
    await setup();
    seedGuild();
    t.handle.sqlite
      .prepare(
        "insert into module_settings (module_id, scope, channel_id, guild_id, config, updated_at) values ('collector', 'channel', '22', 'g1', ?, ?)",
      )
      .run(JSON.stringify({ tags: 'not-a-list' }), Date.now());

    const body = await json(await call('/api/channels/22/modules'));

    expect(body.modules[0]).toMatchObject({ needsReview: true, config: { tags: [] } });
  });

  it('answers 404 for a channel not in the cache and available: false while Discord is down', async () => {
    await setup();
    seedGuild();
    expect((await call('/api/channels/nope/modules')).status).toBe(404);
    discordState = 'down';
    expect(await json(await call('/api/channels/22/modules'))).toEqual({ available: false });
  });
});

describe('channel writes', () => {
  it('keeps a channel switch flipped while the Module is off globally', async () => {
    await setup();
    seedGuild();

    const res = await call('/api/channels/22/modules/collector/enabled', { method: 'POST', body: JSON.stringify({ on: true }) });

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: 'collector', globalEnabled: false, channelEnabled: true, enabled: false });
    const again = await json(await call('/api/channels/22/modules'));
    expect(again.modules[0]).toMatchObject({ channelEnabled: true, enabled: false, updatedBy: { name: 'Ada Admin' } });
    expect(t.activity.listActivity({ moduleId: 'collector' })[0]).toMatchObject({ moduleId: 'collector', channelId: '22', guildId: 'g1', message: 'switched on in channel' });

    await t.runtime.setModuleGlobalEnabled('collector', true, ADMIN);
    expect(t.runtime.isEnabledIn('collector', '22')).toBe(true);
    expect(t.runtime.isEnabledIn('collector', '40')).toBe(true);
  });

  it('saves Channel config, keeping a blank secret and rejecting invalid input', async () => {
    await setup();
    seedGuild();
    const put = (body: unknown) =>
      call('/api/channels/22/modules/collector/config', { method: 'PUT', body: JSON.stringify(body) });

    const saved = await put({ tags: ['a', 'b'], token: 'secret-1' });
    expect(saved.status).toBe(200);
    expect(await json(saved)).toMatchObject({ config: { tags: ['a', 'b'], token: { set: true } }, updatedBy: { name: 'Ada Admin' } });

    const blank = await json(await put({ tags: ['c'], token: '' }));
    expect(blank.config).toEqual({ tags: ['c'], token: { set: true } });

    const bad = await put({ tags: 'nope' });
    expect(bad.status).toBe(400);
    expect(await json(bad)).toMatchObject({ error: 'invalid config', fieldErrors: [{ path: ['tags'] }] });
    expect(t.activity.listActivity({ moduleId: 'collector' }).filter((a) => a.message === 'Channel config edited')).toHaveLength(2);
  });

  it.each([
    ['PUT', 'config', {}],
    ['POST', 'enabled', { on: true }],
  ])('rejects a thread id with 400 (%s %s): a thread follows its parent', async (method, path, body) => {
    await setup();
    seedGuild();

    const res = await call(`/api/channels/40/modules/collector/${path}`, { method, body: JSON.stringify(body) });

    expect(res.status).toBe(400);
    expect(t.handle.sqlite.prepare("select count(*) as n from module_settings where scope = 'channel'").get()).toEqual({ n: 0 });
  });

  it('answers 404 for an unknown channel or Module', async () => {
    await setup();
    seedGuild();
    const toggle = (path: string) => call(path, { method: 'POST', body: JSON.stringify({ on: true }) });
    expect((await toggle('/api/channels/nope/modules/collector/enabled')).status).toBe(404);
    expect((await toggle('/api/channels/22/modules/nope/enabled')).status).toBe(404);
  });
});

describe('orphans', () => {
  async function seedOrphans() {
    await setup();
    seedGuild();
    t.runtime.setModuleChannelEnabled('collector', { channelId: '22', guildId: 'g1' }, true, ADMIN);
    t.runtime.setModuleChannelEnabled('collector', { channelId: '77', guildId: 'g1' }, true, ADMIN); // channel gone
    t.runtime.updateChannelConfig('echo', { channelId: '88', guildId: 'g9' }, {}, ADMIN); // guild gone
  }

  it('lists channel rows whose channel or guild is no longer in the cache', async () => {
    await seedOrphans();

    const res = await call('/api/orphans');

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.available).toBe(true);
    expect(body.orphans.map((o: any) => [o.moduleId, o.moduleName, o.channelId, o.guildId, o.guildName])).toEqual([
      ['collector', 'Collector', '77', 'g1', 'Homelab'],
      ['echo', 'Echo', '88', 'g9', null],
    ]);
    expect(body.orphans[0]).toMatchObject({ enabled: true, updatedBy: ADMIN });
  });

  it('lists nothing while Discord is down (the cache cannot be trusted)', async () => {
    await seedOrphans();
    discordState = 'down';
    expect(await json(await call('/api/orphans'))).toEqual({ available: false });
  });

  it('deletes one orphan row, and refuses rows that are not orphans', async () => {
    await seedOrphans();

    expect((await call('/api/orphans/collector/22', { method: 'DELETE' })).status).toBe(404);
    const res = await call('/api/orphans/collector/77', { method: 'DELETE' });
    expect(res.status).toBe(200);

    const body = await json(await call('/api/orphans'));
    expect(body.orphans.map((o: any) => o.channelId)).toEqual(['88']);
    // The row for a channel that still exists is kept.
    const remaining = await json(await call('/api/channels/22/modules'));
    expect(remaining.modules[0].channelEnabled).toBe(true);
  });
});

describe('GET /api/status', () => {
  it('includes the invite URL with the union of every Module permission', async () => {
    await setup();

    const body = await json(await call('/api/status'));

    // ViewChannel 1024 + ReadMessageHistory 65536 + AddReactions 64 + SendMessages 2048
    expect(body.inviteUrl).toBe('https://discord.com/oauth2/authorize?client_id=app-1&scope=bot&permissions=68672');
  });

  it('has no invite URL before the bot has logged in', async () => {
    await setup();
    t.guilds.appId = null;
    expect((await json(await call('/api/status'))).inviteUrl).toBeNull();
  });
});

describe('auth gate', () => {
  it.each([
    ['GET', '/api/guilds'],
    ['GET', '/api/guilds/g1/channels'],
    ['GET', '/api/guilds/g1/overview'],
    ['GET', '/api/channels/22/modules'],
    ['PUT', '/api/channels/22/modules/collector/config'],
    ['POST', '/api/channels/22/modules/collector/enabled'],
    ['GET', '/api/orphans'],
    ['DELETE', '/api/orphans/collector/77'],
  ])('%s %s answers 401 without a session', async (method, path) => {
    await setup();
    seedGuild();
    cookie = '';
    expect((await call(path, { method, ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{"on":true}' }) })).status).toBe(401);
  });
});
