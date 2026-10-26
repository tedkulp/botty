import { Configuration } from 'openid-client';
import { describe, expect, it } from 'vitest';
import { createOidcProvider } from './oidc.js';

const ISSUER = 'https://id.example.test';

function config(endSession = true): Configuration {
  return new Configuration(
    {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/api/oidc/token`,
      ...(endSession ? { end_session_endpoint: `${ISSUER}/api/oidc/end-session` } : {}),
    },
    'botty',
    'secret',
  );
}

function provider(discover: () => Promise<Configuration>) {
  return createOidcProvider({ issuer: ISSUER, clientId: 'botty', clientSecret: 'secret', discover });
}

describe('createOidcProvider', () => {
  it('builds an authorization URL with PKCE S256, state and the Admin scopes', async () => {
    const oidc = provider(async () => config());

    const login = await oidc.beginLogin('https://botty.example.com/auth/callback');

    expect(login.url.origin + login.url.pathname).toBe(`${ISSUER}/authorize`);
    const params = login.url.searchParams;
    expect(params.get('client_id')).toBe('botty');
    expect(params.get('redirect_uri')).toBe('https://botty.example.com/auth/callback');
    expect(params.get('scope')).toBe('openid profile email groups');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toBeTruthy();
    expect(params.get('state')).toBe(login.state);
    expect(login.codeVerifier).toBeTruthy();
  });

  it('retries discovery lazily after a failure and caches it once it succeeds', async () => {
    let calls = 0;
    const oidc = provider(async () => {
      calls += 1;
      if (calls === 1) throw new Error('issuer down');
      return config();
    });

    await expect(oidc.beginLogin('http://localhost/auth/callback')).rejects.toThrow('issuer down');
    await oidc.beginLogin('http://localhost/auth/callback');
    await oidc.beginLogin('http://localhost/auth/callback');

    expect(calls).toBe(2);
  });

  it('builds the end-session URL when advertised, null otherwise', async () => {
    const withLogout = await provider(async () => config(true)).endSessionUrl('https://botty.example.com/');
    const without = await provider(async () => config(false)).endSessionUrl('https://botty.example.com/');

    expect(withLogout?.origin + withLogout!.pathname).toBe(`${ISSUER}/api/oidc/end-session`);
    expect(withLogout?.searchParams.get('post_logout_redirect_uri')).toBe('https://botty.example.com/');
    expect(without).toBeNull();
  });
});
