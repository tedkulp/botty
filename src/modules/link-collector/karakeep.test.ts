import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createKarakeepClient, KarakeepError } from './karakeep.js';

const BASE = 'https://karakeep.example.com';
const API = `${BASE}/api/v1`;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = createKarakeepClient({ baseUrl: BASE, apiKey: 'secret-key' });

describe('createBookmark', () => {
  it('returns created: true on 201 and sends a link bookmark with bearer auth', async () => {
    let seen: { auth: string | null; body: unknown } | undefined;
    server.use(
      http.post(`${API}/bookmarks`, async ({ request }) => {
        seen = { auth: request.headers.get('authorization'), body: await request.json() };
        return HttpResponse.json({ id: 'bm_new' }, { status: 201 });
      }),
    );

    const result = await client.createBookmark('https://x.com/a', 'from #general');

    expect(result).toEqual({ bookmarkId: 'bm_new', created: true });
    expect(seen).toEqual({
      auth: 'Bearer secret-key',
      body: { type: 'link', url: 'https://x.com/a', note: 'from #general' },
    });
  });

  it('returns created: false with the existing id on 200', async () => {
    server.use(http.post(`${API}/bookmarks`, () => HttpResponse.json({ id: 'bm_old' }, { status: 200 })));

    await expect(client.createBookmark('https://x.com/a')).resolves.toEqual({
      bookmarkId: 'bm_old',
      created: false,
    });
  });
});

describe('checkUrl', () => {
  it('returns the bookmark id on a hit, passing the url as a query param', async () => {
    let queried: string | null = null;
    server.use(
      http.get(`${API}/bookmarks/check-url`, ({ request }) => {
        queried = new URL(request.url).searchParams.get('url');
        return HttpResponse.json({ bookmarkId: 'bm_1' });
      }),
    );

    await expect(client.checkUrl('https://x.com/a?b=1&c=2')).resolves.toEqual({ bookmarkId: 'bm_1' });
    expect(queried).toBe('https://x.com/a?b=1&c=2');
  });

  it('returns null on a miss', async () => {
    server.use(http.get(`${API}/bookmarks/check-url`, () => HttpResponse.json({ bookmarkId: null })));

    await expect(client.checkUrl('https://x.com/none')).resolves.toBeNull();
  });
});

describe('attachTags', () => {
  it('attaches tags by name', async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/bookmarks/bm_1/tags`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ attached: ['t1', 't2'] });
      }),
    );

    await client.attachTags('bm_1', ['discord', 'links']);

    expect(body).toEqual({ tags: [{ tagName: 'discord' }, { tagName: 'links' }] });
  });
});

describe('addToList', () => {
  it('PUTs the bookmark into the list and resolves on 204', async () => {
    let hit = false;
    server.use(
      http.put(`${API}/lists/list_1/bookmarks/bm_1`, () => {
        hit = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await client.addToList('list_1', 'bm_1');

    expect(hit).toBe(true);
  });

  it('maps a 400 (smart list) to a client error', async () => {
    server.use(
      http.put(`${API}/lists/smart_1/bookmarks/bm_1`, () =>
        HttpResponse.text('Smart lists cannot be added to', { status: 400 }),
      ),
    );

    const err = await client.addToList('smart_1', 'bm_1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KarakeepError);
    expect(err).toMatchObject({ kind: 'client', status: 400, body: 'Smart lists cannot be added to' });
  });
});

describe('error mapping', () => {
  async function createErr(): Promise<unknown> {
    return client.createBookmark('https://x.com/a').catch((e: unknown) => e);
  }

  it.each([401, 403])('maps %i to auth', async (status) => {
    server.use(http.post(`${API}/bookmarks`, () => HttpResponse.text('Unauthorized', { status })));

    expect(await createErr()).toMatchObject({ kind: 'auth', status, body: 'Unauthorized' });
  });

  it('maps 429 to retryable and preserves the plain-text body', async () => {
    const msg = 'Rate limit exceeded. Try again in 42 seconds.';
    server.use(http.post(`${API}/bookmarks`, () => HttpResponse.text(msg, { status: 429 })));

    expect(await createErr()).toMatchObject({ kind: 'retryable', status: 429, body: msg });
  });

  it('maps 500 to retryable', async () => {
    server.use(http.post(`${API}/bookmarks`, () => HttpResponse.text('Internal server error', { status: 500 })));

    expect(await createErr()).toMatchObject({ kind: 'retryable', status: 500, body: 'Internal server error' });
  });

  it('maps a network failure to retryable with no status', async () => {
    server.use(http.post(`${API}/bookmarks`, () => HttpResponse.error()));

    const err = await createErr();
    expect(err).toBeInstanceOf(KarakeepError);
    expect(err).toMatchObject({ kind: 'retryable', status: undefined });
  });

  it('maps a 404 to client', async () => {
    server.use(http.post(`${API}/bookmarks/gone/tags`, () => HttpResponse.text('Bookmark not found', { status: 404 })));

    const err = await client.attachTags('gone', ['x']).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'client', status: 404 });
  });
});

describe('factory', () => {
  it('tolerates a trailing slash on baseUrl and uses an injected fetch', async () => {
    const calls: string[] = [];
    const injected: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ bookmarkId: null }), { status: 200 });
    };
    const c = createKarakeepClient({ baseUrl: `${BASE}/`, apiKey: 'k', fetch: injected });

    await c.checkUrl('https://x.com/a');

    expect(calls).toEqual([`${API}/bookmarks/check-url?url=${encodeURIComponent('https://x.com/a')}`]);
  });
});
