import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './testing.js';

let dir: string;
let t: TestApp;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'botty-spa-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("app")');
  t = createTestApp({ clientDir: dir });
});
afterEach(() => {
  t.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('serving the built SPA', () => {
  it('serves index.html at the root', async () => {
    const res = await t.app.request('/');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('id="root"');
  });

  it('serves built assets', async () => {
    const res = await t.app.request('/assets/app.js');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toBe('console.log("app")');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await t.app.request('/modules/link-collector');

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });

  it('answers a missing asset with 404 rather than the page', async () => {
    const res = await t.app.request('/assets/missing.js');

    expect(res.status).toBe(404);
  });

  it('keeps unknown API paths as JSON 404s', async () => {
    const cookie = await t.signIn();
    const res = await t.app.request('/api/nope', { headers: { Cookie: cookie } });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });

  it('leaves /healthz and /auth to the server', async () => {
    expect((await t.app.request('/healthz')).headers.get('content-type')).toContain('json');
    expect((await t.app.request('/auth/login')).status).toBe(302);
  });
});
