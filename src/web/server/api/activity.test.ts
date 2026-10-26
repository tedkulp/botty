import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModule } from '../../../core/modules/index.js';
import { createTestApp, type TestApp } from '../testing.js';

const collector = defineModule({
  id: 'collector',
  name: 'Collector',
  channelDefault: false,
  permissions: [],
  configSchema: {
    global: z.object({ tags: z.array(z.string()).default([]) }),
    channel: z.object({ listId: z.string().optional() }),
  },
  setup() {},
});

const other = defineModule({
  id: 'other',
  name: 'Other',
  channelDefault: false,
  permissions: [],
  configSchema: { global: z.object({}), channel: z.object({}) },
  setup() {},
});

let t: TestApp;
afterEach(() => t?.close());

function setup() {
  t = createTestApp({ modules: [collector, other] });
  return t;
}

async function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set('Cookie', cookie);
  if (rest.body) headers.set('Content-Type', 'application/json');
  return t.app.request(path, { ...rest, headers });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

describe('GET /api/modules/:id/activity', () => {
  it('answers 401 without a session', async () => {
    setup();
    const res = await call('/api/modules/collector/activity');
    expect(res.status).toBe(401);
  });

  it('shows a global switch made through the API, with the Admin who made it', async () => {
    setup();
    const cookie = await t.signIn({ sub: 'sub-ted', name: 'Ted' });
    await call('/api/modules/collector/enabled', { method: 'POST', cookie, body: JSON.stringify({ on: true }) });

    const res = await call('/api/modules/collector/activity', { cookie });

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      entries: [
        {
          id: expect.any(Number),
          level: 'info',
          message: 'switched on globally',
          link: null,
          actor: { sub: 'sub-ted', name: 'Ted' },
          guild: null,
          channel: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      nextBefore: null,
    });
  });

  it('filters by server and channel, and resolves their names from the cache', async () => {
    setup();
    t.guilds.addGuild({ id: 'g1', name: 'Home' });
    t.guilds.addChannel({ id: 'c1', guildId: 'g1', name: 'links' });
    const cookie = await t.signIn();
    t.activity.write({ moduleId: 'collector', guildId: 'g1', channelId: 'c1', level: 'info', message: 'in c1' });
    t.activity.write({ moduleId: 'collector', guildId: 'g1', channelId: 'c2', level: 'warn', message: 'in c2' });
    t.activity.write({ moduleId: 'collector', guildId: 'g2', channelId: 'c3', level: 'error', message: 'in g2' });
    t.activity.write({ moduleId: 'other', guildId: 'g1', channelId: 'c1', level: 'info', message: 'other Module' });

    const inGuild = await json(await call('/api/modules/collector/activity?guildId=g1', { cookie }));
    expect(inGuild.entries.map((e: { message: string }) => e.message)).toEqual(['in c2', 'in c1']);

    const inChannel = await json(await call('/api/modules/collector/activity?channelId=c1', { cookie }));
    expect(inChannel.entries).toEqual([
      expect.objectContaining({
        message: 'in c1',
        guild: { id: 'g1', name: 'Home' },
        channel: { id: 'c1', name: 'links' },
      }),
    ]);

    // Not in the cache: raw ids only.
    const elsewhere = await json(await call('/api/modules/collector/activity?guildId=g2&channelId=c3', { cookie }));
    expect(elsewhere.entries).toEqual([
      expect.objectContaining({ message: 'in g2', guild: { id: 'g2', name: null }, channel: { id: 'c3', name: null } }),
    ]);
  });

  it('pages with before and limit until nextBefore is null', async () => {
    setup();
    const cookie = await t.signIn();
    for (let i = 1; i <= 5; i++) t.activity.write({ moduleId: 'collector', level: 'info', message: `entry ${i}` });
    const messages = (body: { entries: { message: string }[] }) => body.entries.map((e) => e.message);

    const first = await json(await call('/api/modules/collector/activity?limit=2', { cookie }));
    expect(messages(first)).toEqual(['entry 5', 'entry 4']);
    expect(first.nextBefore).toBe(first.entries[1].id);

    const second = await json(await call(`/api/modules/collector/activity?limit=2&before=${first.nextBefore}`, { cookie }));
    expect(messages(second)).toEqual(['entry 3', 'entry 2']);

    const last = await json(await call(`/api/modules/collector/activity?limit=2&before=${second.nextBefore}`, { cookie }));
    expect(messages(last)).toEqual(['entry 1']);
    expect(last.nextBefore).toBeNull();
  });

  it('gives nextBefore null when the page is exactly the rest', async () => {
    setup();
    const cookie = await t.signIn();
    for (let i = 1; i <= 2; i++) t.activity.write({ moduleId: 'collector', level: 'info', message: `entry ${i}` });

    const page = await json(await call('/api/modules/collector/activity?limit=2', { cookie }));

    expect(page.entries).toHaveLength(2);
    expect(page.nextBefore).toBeNull();
  });

  it.each(['limit=abc', 'limit=0', 'before=x', 'before=1.5'])('rejects ?%s with 400', async (query) => {
    setup();
    const cookie = await t.signIn();
    const res = await call(`/api/modules/collector/activity?${query}`, { cookie });
    expect(res.status).toBe(400);
  });

  it('answers 404 for an unknown Module', async () => {
    setup();
    const cookie = await t.signIn();
    const res = await call('/api/modules/nope/activity', { cookie });
    expect(res.status).toBe(404);
  });
});
