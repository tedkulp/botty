import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type DatabaseHandle } from '../../core/db/index.js';
import type { DiscordState } from '../../core/discord.js';
import { createApp } from './app.js';

let handle: DatabaseHandle;
function freshDb(): DatabaseHandle {
  handle = openDatabase(':memory:');
  runMigrations(handle);
  return handle;
}
afterEach(() => handle?.close());

const discord = (state: DiscordState) => ({ state: () => state });

describe('GET /healthz', () => {
  it('returns 200 with db ok and discord ready', async () => {
    const app = createApp({ db: freshDb(), discord: discord('ready') });

    const res = await app.request('/healthz');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ db: 'ok', discord: 'ready' });
  });

  it('stays 200 when Discord is down', async () => {
    const app = createApp({ db: freshDb(), discord: discord('down') });

    const res = await app.request('/healthz');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ db: 'ok', discord: 'down' });
  });

  it('returns 503 when the database check fails', async () => {
    const db = freshDb();
    const app = createApp({ db, discord: discord('ready') });
    db.close();

    const res = await app.request('/healthz');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ db: 'error', discord: 'ready' });
  });
});
