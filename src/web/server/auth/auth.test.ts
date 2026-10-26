import { afterEach, describe, expect, it } from 'vitest';
import { adminTokens, createTestApp, cookiePairs, TEST_ISSUER, type TestApp } from '../testing.js';

let t: TestApp;
function setup(options?: Parameters<typeof createTestApp>[0]): TestApp {
  t = createTestApp(options);
  return t;
}
afterEach(() => t?.close());

describe('GET /auth/login', () => {
  it('sets a short-lived httpOnly PKCE cookie and redirects to the provider', async () => {
    const { app } = setup();

    const res = await app.request('/auth/login?returnTo=/modules');

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe(TEST_ISSUER);
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/callback');
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('botty_oidc='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });
});

async function startLogin(app: TestApp['app'], returnTo = '/') {
  const res = await app.request(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
  return { pkce: cookiePairs(res), state };
}

function sessionCount(handle: TestApp['handle']): number {
  return (handle.sqlite.prepare('select count(*) as n from sessions').get() as { n: number }).n;
}

describe('GET /auth/callback', () => {
  it('creates a session for a member of the Admin group and redirects to the return path', async () => {
    const { app } = setup();
    const { pkce, state } = await startLogin(app, '/modules');

    const res = await app.request(`/auth/callback?code=abc&state=${state}`, { headers: { Cookie: pkce } });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/modules');
    const session = res.headers.getSetCookie().find((c) => c.startsWith('botty_session='));
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    const me = await app.request('/api/me', { headers: { Cookie: cookiePairs(res, 'botty_session') } });
    expect(await me.json()).toEqual({ admin: { sub: 'admin-sub', name: 'Ada Admin' } });
  });

  it('returns 403 and creates no session without the Admin group', async () => {
    const { app, oidc, clock, handle } = setup();
    oidc.exchangeResult = adminTokens(clock, { groups: ['users'] });
    const { pkce, state } = await startLogin(app);

    const res = await app.request(`/auth/callback?code=abc&state=${state}`, { headers: { Cookie: pkce } });

    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('botty_session='))).toBe(false);
    expect(sessionCount(handle)).toBe(0);
  });

  it('rejects a callback without the PKCE cookie', async () => {
    const { app, handle } = setup();

    const res = await app.request('/auth/callback?code=abc&state=test-state');

    expect(res.status).toBe(400);
    expect(sessionCount(handle)).toBe(0);
  });
});

describe('GET /api/me', () => {
  it('returns null admin without a session', async () => {
    const { app } = setup();

    const res = await app.request('/api/me');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: null });
  });
});

describe('/api/* gate', () => {
  it('returns 401 without a session', async () => {
    const { app } = setup();

    const res = await app.request('/api/modules');

    expect(res.status).toBe(401);
  });

  it('returns 401 for a tampered session cookie', async () => {
    const { app, signIn } = setup();
    const cookie = await signIn();
    const [name, value] = cookie.split('=') as [string, string];
    const tampered = `${name}=${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`;

    const res = await app.request('/api/modules', { headers: { Cookie: tampered } });

    expect(res.status).toBe(401);
  });

  it('lets a signed-in Admin through', async () => {
    const { app, signIn } = setup();
    const cookie = await signIn();

    const res = await app.request('/api/modules', { headers: { Cookie: cookie } });

    // No such route yet: past the gate means 404, not 401.
    expect(res.status).toBe(404);
  });
});

describe('session refresh', () => {
  const HOUR = 60 * 60 * 1000;

  it('does not refresh a session that is not near expiry', async () => {
    const { app, signIn, oidc } = setup();
    const cookie = await signIn();

    await app.request('/api/me', { headers: { Cookie: cookie } });

    expect(oidc.refreshCalls).toEqual([]);
  });

  it('refreshes an expired session and keeps the Admin signed in', async () => {
    const { app, signIn, oidc, clock } = setup();
    const cookie = await signIn();
    clock.advance(2 * HOUR);
    oidc.refreshResult = adminTokens(clock, { name: 'Ada Renamed', refreshToken: 'refresh-2' });

    const first = await app.request('/api/me', { headers: { Cookie: cookie } });
    const second = await app.request('/api/me', { headers: { Cookie: cookie } });

    expect(await first.json()).toEqual({ admin: { sub: 'admin-sub', name: 'Ada Renamed' } });
    expect(second.status).toBe(200);
    expect(oidc.refreshCalls).toEqual([{ refreshToken: 'refresh-1', sub: 'admin-sub' }]);
  });

  it('uses the rotated refresh token next time', async () => {
    const { app, signIn, oidc, clock } = setup();
    const cookie = await signIn();
    clock.advance(2 * HOUR);
    oidc.refreshResult = adminTokens(clock, { refreshToken: 'refresh-2' });
    await app.request('/api/me', { headers: { Cookie: cookie } });
    clock.advance(2 * HOUR);
    oidc.refreshResult = adminTokens(clock, { refreshToken: 'refresh-3' });

    await app.request('/api/me', { headers: { Cookie: cookie } });

    expect(oidc.refreshCalls.map((r) => r.refreshToken)).toEqual(['refresh-1', 'refresh-2']);
  });

  it('returns 401 and deletes the session when the refresh drops the Admin group', async () => {
    const { app, signIn, oidc, clock, handle } = setup();
    const cookie = await signIn();
    clock.advance(2 * HOUR);
    oidc.refreshResult = adminTokens(clock, { groups: ['users'] });

    const res = await app.request('/api/modules', { headers: { Cookie: cookie } });

    expect(res.status).toBe(401);
    expect(sessionCount(handle)).toBe(0);
  });

  it('returns 401 and deletes the session when the refresh fails', async () => {
    const { app, signIn, oidc, clock, handle } = setup();
    const cookie = await signIn();
    clock.advance(2 * HOUR);
    oidc.refreshResult = new Error('invalid_grant');

    const res = await app.request('/api/me', { headers: { Cookie: cookie } });

    expect(res.status).toBe(401);
    expect(sessionCount(handle)).toBe(0);
  });

  it('returns 401 and deletes an expired session that has no refresh token', async () => {
    const { app, signIn, clock, handle } = setup();
    const cookie = await signIn({ refreshToken: undefined });
    clock.advance(2 * HOUR);

    const res = await app.request('/api/modules', { headers: { Cookie: cookie } });

    expect(res.status).toBe(401);
    expect(sessionCount(handle)).toBe(0);
  });
});

describe('POST /auth/logout', () => {
  it('deletes the session and redirects to the provider end-session endpoint', async () => {
    const { app, signIn, handle } = setup();
    const cookie = await signIn();

    const res = await app.request('/auth/logout', { method: 'POST', headers: { Cookie: cookie } });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe(`${TEST_ISSUER}/api/oidc/end-session`);
    expect(location.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:3000/');
    expect(sessionCount(handle)).toBe(0);
    const me = await app.request('/api/me', { headers: { Cookie: cookie } });
    expect(await me.json()).toEqual({ admin: null });
  });

  it('redirects to / when the provider advertises no end-session endpoint', async () => {
    const { app, signIn, oidc } = setup();
    oidc.endSessionEndpoint = null;
    const cookie = await signIn();

    const res = await app.request('/auth/logout', { method: 'POST', headers: { Cookie: cookie } });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });
});

describe('cookie Secure flag', () => {
  async function setCookies(publicUrl: string): Promise<string[]> {
    const { app } = setup({ publicUrl });
    const { pkce, state } = await startLogin(app);
    const login = await app.request('/auth/login');
    const callback = await app.request(`/auth/callback?code=abc&state=${state}`, { headers: { Cookie: pkce } });
    return [...login.headers.getSetCookie(), ...callback.headers.getSetCookie()];
  }

  it('is set when PUBLIC_URL is https', async () => {
    const cookies = await setCookies('https://botty.example.com');

    expect(cookies.length).toBeGreaterThan(1);
    for (const c of cookies) expect(c).toMatch(/; Secure/);
  });

  it('is not set when PUBLIC_URL is http', async () => {
    const cookies = await setCookies('http://localhost:3000');

    expect(cookies.length).toBeGreaterThan(1);
    for (const c of cookies) expect(c).not.toMatch(/Secure/);
  });
});
