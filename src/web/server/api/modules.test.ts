import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModule } from '../../../core/modules/index.js';
import { createTestApp, type TestApp } from '../testing.js';

const SECRET = 'kk_super_secret_value';

/** Records what `setup` saw so tests can observe the stored config through the Module. */
const seen: { apiKey?: string | undefined }[] = [];
let setupBehaviour: 'ok' | 'degraded' | 'throw' = 'ok';

const linkish = defineModule({
  id: 'linkish',
  name: 'Linkish',
  channelDefault: false,
  permissions: [],
  configSchema: {
    global: z.object({
      url: z.url().optional(),
      apiKey: z.string().optional().meta({ secret: true }),
      tags: z.array(z.string()).default([]),
      limit: z.number().int().min(1).default(5),
    }),
    channel: z.object({ listId: z.string().optional() }),
  },
  setup(ctx) {
    seen.push({ apiKey: ctx.globalConfig().apiKey });
    if (setupBehaviour === 'throw') throw new Error('not configured');
    if (setupBehaviour === 'degraded') ctx.setStatus('degraded', 'half there');
  },
});

let t: TestApp;
afterEach(() => {
  t?.close();
  seen.length = 0;
  setupBehaviour = 'ok';
});

function setup(options: Parameters<typeof createTestApp>[0] = {}) {
  t = createTestApp({ modules: [linkish], ...options });
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

const ROUTES: Array<[string, string, unknown?]> = [
  ['GET', '/api/status'],
  ['GET', '/api/modules'],
  ['GET', '/api/modules/linkish'],
  ['PUT', '/api/modules/linkish/config', {}],
  ['POST', '/api/modules/linkish/enabled', { on: true }],
];

describe('API auth gate', () => {
  it.each(ROUTES)('%s %s answers 401 without a session', async (method, path, body) => {
    setup();
    const res = await call(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect(res.status).toBe(401);
  });

  it('does not switch anything on for an unauthenticated toggle', async () => {
    setup();
    await call('/api/modules/linkish/enabled', { method: 'POST', body: JSON.stringify({ on: true }) });
    expect(seen).toHaveLength(0);
  });
});

describe('GET /api/status', () => {
  it('reports the Discord connection state', async () => {
    setup({ discord: { state: () => 'down' } });
    const cookie = await t.signIn();

    const res = await call('/api/status', { cookie });

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ discord: 'down' });
  });
});

describe('GET /api/modules', () => {
  it('lists each Module with its global switch, status and last error', async () => {
    setup();
    const cookie = await t.signIn();

    const res = await call('/api/modules', { cookie });

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      modules: [{ id: 'linkish', name: 'Linkish', enabled: false, status: { level: 'ok' }, lastError: null }],
    });
  });
});

describe('GET /api/modules/:id', () => {
  it('returns the JSON Schemas, the Global config with defaults, and who edited it', async () => {
    setup();
    const cookie = await t.signIn();

    const res = await call('/api/modules/linkish', { cookie });

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      id: 'linkish',
      name: 'Linkish',
      enabled: false,
      status: { level: 'ok' },
      lastError: null,
      config: { tags: [], limit: 5, apiKey: { set: false } },
      needsReview: false,
      updatedBy: null,
      updatedAt: null,
    });
    expect(body.schema.global).toMatchObject({
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        apiKey: { type: 'string', secret: true },
        tags: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', minimum: 1 },
      },
    });
    expect(body.schema.global.required ?? []).not.toContain('tags');
    expect(body.schema.channel).toMatchObject({ type: 'object', properties: { listId: { type: 'string' } } });
  });

  it('answers 404 for an unknown Module', async () => {
    setup();
    const cookie = await t.signIn();

    const res = await call('/api/modules/nope', { cookie });

    expect(res.status).toBe(404);
  });
});

function putConfig(cookie: string, config: unknown, id = 'linkish') {
  return call(`/api/modules/${id}/config`, { method: 'PUT', cookie, body: JSON.stringify(config) });
}

describe('PUT /api/modules/:id/config', () => {
  it('saves valid config, records the Admin, and returns the updated Module', async () => {
    setup();
    const cookie = await t.signIn({ sub: 'sub-ted', name: 'Ted' });

    const res = await putConfig(cookie, { url: 'https://karakeep.test', apiKey: SECRET, tags: ['discord'], limit: 3 });

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      config: { url: 'https://karakeep.test', apiKey: { set: true }, tags: ['discord'], limit: 3 },
      needsReview: false,
      updatedBy: { sub: 'sub-ted', name: 'Ted' },
    });
    expect(typeof body.updatedAt).toBe('string');
    expect(t.activity).toContainEqual(
      expect.objectContaining({ moduleId: 'linkish', actor: { sub: 'sub-ted', name: 'Ted' } }),
    );
  });

  it('rejects invalid config with 400 and the failing field paths, saving nothing', async () => {
    setup();
    const cookie = await t.signIn();

    const res = await putConfig(cookie, { url: 'not a url', tags: 'discord', limit: 0 });

    expect(res.status).toBe(400);
    const body = await json(res);
    const paths = body.fieldErrors.map((e: { path: string[] }) => e.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['url', 'tags', 'limit']));
    for (const e of body.fieldErrors) expect(typeof e.message).toBe('string');
    const after = await json(await call('/api/modules/linkish', { cookie }));
    expect(after.updatedBy).toBeNull();
  });

  it('keeps the stored secret when the secret is sent blank', async () => {
    setup();
    const cookie = await t.signIn();
    await putConfig(cookie, { apiKey: SECRET, tags: [] });

    const res = await putConfig(cookie, { apiKey: '', tags: ['changed'] });
    expect(res.status).toBe(200);
    await call('/api/modules/linkish/enabled', { method: 'POST', cookie, body: JSON.stringify({ on: true }) });

    expect(seen.at(-1)).toEqual({ apiKey: SECRET });
  });

  it('answers 404 for an unknown Module', async () => {
    setup();
    const cookie = await t.signIn();

    const res = await putConfig(cookie, {}, 'nope');

    expect(res.status).toBe(404);
  });
});

function toggle(cookie: string, on: unknown, id = 'linkish') {
  return call(`/api/modules/${id}/enabled`, { method: 'POST', cookie, body: JSON.stringify({ on }) });
}

describe('POST /api/modules/:id/enabled', () => {
  it('runs setup and returns the status setup left behind', async () => {
    setup();
    setupBehaviour = 'degraded';
    const cookie = await t.signIn({ sub: 'sub-ted', name: 'Ted' });

    const res = await toggle(cookie, true);

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      enabled: true,
      status: { level: 'degraded', message: 'half there' },
      lastError: null,
    });
    expect(seen).toHaveLength(1);
    expect(t.activity).toContainEqual(
      expect.objectContaining({ moduleId: 'linkish', message: 'switched on globally', actor: { sub: 'sub-ted', name: 'Ted' } }),
    );
    const list = await json(await call('/api/modules', { cookie }));
    expect(list.modules[0]).toMatchObject({ enabled: true, status: { level: 'degraded' } });
  });

  it('returns an error status and the last error when setup throws', async () => {
    setup();
    setupBehaviour = 'throw';
    const cookie = await t.signIn();

    const res = await toggle(cookie, true);

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      enabled: true,
      status: { level: 'error', message: 'not configured' },
      lastError: { message: 'not configured' },
    });
    expect(Number.isNaN(Date.parse(body.lastError.at))).toBe(false);
  });

  it('switches a Module off again', async () => {
    setup();
    const cookie = await t.signIn();
    await toggle(cookie, true);

    const res = await toggle(cookie, false);

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ enabled: false });
    expect(t.runtime.isActive('linkish')).toBe(false);
  });

  it('rejects a body without a boolean `on`', async () => {
    setup();
    const cookie = await t.signIn();

    const res = await toggle(cookie, 'yes');

    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('answers 404 for an unknown Module', async () => {
    setup();
    const cookie = await t.signIn();

    const res = await toggle(cookie, true, 'nope');

    expect(res.status).toBe(404);
  });
});

describe('secrets', () => {
  it('never appear in any response', async () => {
    setup();
    const cookie = await t.signIn();
    const bodies: string[] = [];
    const record = async (res: Response | Promise<Response>) => bodies.push(await (await res).text());

    await record(putConfig(cookie, { apiKey: SECRET }));
    await record(putConfig(cookie, { apiKey: '', limit: 'bad' }));
    await record(putConfig(cookie, { apiKey: '' }));
    await record(call('/api/modules/linkish/enabled', { method: 'POST', cookie, body: JSON.stringify({ on: true }) }));
    await record(call('/api/modules', { cookie }));
    await record(call('/api/modules/linkish', { cookie }));
    await record(call('/api/status', { cookie }));

    expect(bodies).toHaveLength(7);
    for (const body of bodies) expect(body).not.toContain(SECRET);
  });
});
