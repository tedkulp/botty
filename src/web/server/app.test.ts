import { afterEach, describe, expect, it } from 'vitest';
import type { DiscordState } from '../../core/discord.js';
import { createTestApp, type TestApp } from './testing.js';

let t: TestApp;
function setup(state: DiscordState): TestApp {
  t = createTestApp({ discord: { state: () => state } });
  return t;
}
afterEach(() => t?.close());

describe('GET /healthz', () => {
  it('returns 200 with db ok and discord ready', async () => {
    const { app } = setup('ready');

    const res = await app.request('/healthz');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ db: 'ok', discord: 'ready' });
  });

  it('stays 200 when Discord is down', async () => {
    const { app } = setup('down');

    const res = await app.request('/healthz');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ db: 'ok', discord: 'down' });
  });

  it('returns 503 when the database check fails', async () => {
    const { app, handle } = setup('ready');
    handle.close();

    const res = await app.request('/healthz');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ db: 'error', discord: 'ready' });
  });
});
