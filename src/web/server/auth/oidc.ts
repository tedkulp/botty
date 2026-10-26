import * as client from 'openid-client';

export const OIDC_SCOPES = 'openid profile email groups';

/** Identity and token data the dashboard needs from one OIDC token response. */
export interface OidcTokens {
  sub: string;
  name: string;
  /** Group names from the `groups` claim; empty when absent. */
  groups: string[];
  /** Absent when the provider issued none (the session then can't be refreshed). */
  refreshToken?: string;
  /** When the access token expires; the session is refreshed near this time. */
  expiresAt: Date;
}

export interface LoginRequest {
  /** Where the browser is sent: the provider's authorization endpoint. */
  url: URL;
  state: string;
  codeVerifier: string;
}

/**
 * The seam between the dashboard and the identity provider (Pocket ID).
 * Production uses `createOidcProvider`; tests pass a stub.
 */
export interface OidcProvider {
  /** Generate PKCE + state and build the authorization URL. */
  beginLogin(redirectUri: string): Promise<LoginRequest>;
  /** Validate the callback (state, PKCE, ID token) and exchange the code. Throws on any failure. */
  exchangeCode(callbackUrl: URL, checks: { state: string; codeVerifier: string }): Promise<OidcTokens>;
  /** Refresh tokens for `sub`. Throws when the provider refuses. */
  refresh(refreshToken: string, sub: string): Promise<OidcTokens>;
  /** RP-initiated logout URL, or null when the provider doesn't advertise `end_session_endpoint`. */
  endSessionUrl(postLogoutRedirectUri: string): Promise<URL | null>;
}

export interface OidcProviderOptions {
  /** `OIDC_ISSUER`; discovery is fetched from its `/.well-known/openid-configuration`. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Override discovery (tests). Defaults to openid-client `discovery()`. */
  discover?: () => Promise<client.Configuration>;
}

type TokenResponse = client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
type Claims = Record<string, unknown>;

function toTokens(response: TokenResponse, claims: Claims, now = Date.now()): OidcTokens {
  const groups = Array.isArray(claims.groups) ? claims.groups.filter((g): g is string => typeof g === 'string') : [];
  const name = [claims.name, claims.preferred_username, claims.sub].find(
    (v): v is string => typeof v === 'string' && v !== '',
  );
  const expiresIn = response.expiresIn() ?? 3600;
  return {
    sub: String(claims.sub),
    name: name ?? '',
    groups,
    ...(response.refresh_token ? { refreshToken: response.refresh_token } : {}),
    expiresAt: new Date(now + expiresIn * 1000),
  };
}

/**
 * Pocket ID over openid-client v6: confidential client, authorization code +
 * PKCE S256. Discovery runs on first use and is cached; if the issuer is down
 * it fails that request and is retried on the next one.
 */
export function createOidcProvider(options: OidcProviderOptions): OidcProvider {
  const discover =
    options.discover ?? (() => client.discovery(new URL(options.issuer), options.clientId, options.clientSecret));
  let cached: Promise<client.Configuration> | undefined;

  function config(): Promise<client.Configuration> {
    cached ??= discover().catch((err: unknown) => {
      cached = undefined;
      throw err;
    });
    return cached;
  }

  /** ID token claims, falling back to userinfo when they lack `groups`. */
  async function claimsOf(cfg: client.Configuration, response: TokenResponse, expectedSub?: string): Promise<Claims> {
    const idClaims = response.claims() as Claims | undefined;
    if (idClaims && Array.isArray(idClaims.groups)) return idClaims;
    const sub = (idClaims?.sub as string | undefined) ?? expectedSub;
    if (!sub) throw new Error('token response has no subject');
    const info = (await client.fetchUserInfo(cfg, response.access_token, sub)) as Claims;
    return { ...idClaims, ...info };
  }

  return {
    async beginLogin(redirectUri) {
      const cfg = await config();
      const codeVerifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const url = client.buildAuthorizationUrl(cfg, {
        redirect_uri: redirectUri,
        scope: OIDC_SCOPES,
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
      });
      return { url, state, codeVerifier };
    },
    async exchangeCode(callbackUrl, checks) {
      const cfg = await config();
      const response = await client.authorizationCodeGrant(cfg, callbackUrl, {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        idTokenExpected: true,
      });
      return toTokens(response, await claimsOf(cfg, response));
    },
    async refresh(refreshToken, sub) {
      const cfg = await config();
      const response = await client.refreshTokenGrant(cfg, refreshToken);
      return toTokens(response, await claimsOf(cfg, response, sub));
    },
    async endSessionUrl(postLogoutRedirectUri) {
      const cfg = await config();
      if (!cfg.serverMetadata().end_session_endpoint) return null;
      return client.buildEndSessionUrl(cfg, { post_logout_redirect_uri: postLogoutRedirectUri });
    },
  };
}
