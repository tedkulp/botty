import { Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import type { Db } from '../../../core/db/index.js';
import type { OidcProvider } from './oidc.js';
import { createSession, deleteSession } from './sessions.js';

export interface AuthConfig {
  oidc: OidcProvider;
  /** `PUBLIC_URL`, no trailing slash. Decides the redirect URI and the `Secure` flag. */
  publicUrl: string;
  adminGroup: string;
  sessionSecret: string;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export const PKCE_COOKIE = 'botty_oidc';
export const SESSION_COOKIE = 'botty_session';
const PKCE_MAX_AGE_S = 10 * 60;
/** Matches Pocket ID's default refresh-token lifetime; the DB row is the real gate. */
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

interface PkceCookie {
  state: string;
  codeVerifier: string;
  returnTo: string;
}

/** Only same-origin absolute paths; anything else falls back to `/`. */
export function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}

export function cookieOptions(config: AuthConfig, maxAge?: number): CookieOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.publicUrl.startsWith('https:'),
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

function parsePkce(raw: string | false | undefined): PkceCookie | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<PkceCookie>;
    if (typeof value.state !== 'string' || typeof value.codeVerifier !== 'string') return undefined;
    return { state: value.state, codeVerifier: value.codeVerifier, returnTo: safeReturnTo(value.returnTo) };
  } catch {
    return undefined;
  }
}

/** `/auth/login`, `/auth/callback`, `/auth/logout`. Mount at `/auth`. */
export function authRoutes(db: Db, config: AuthConfig) {
  const redirectUri = `${config.publicUrl}/auth/callback`;
  const now = config.now ?? (() => new Date());

  return new Hono()
    .get('/login', async (c) => {
      const login = await config.oidc.beginLogin(redirectUri);
      const value: PkceCookie = {
        state: login.state,
        codeVerifier: login.codeVerifier,
        returnTo: safeReturnTo(c.req.query('returnTo')),
      };
      await setSignedCookie(c, PKCE_COOKIE, JSON.stringify(value), config.sessionSecret, cookieOptions(config, PKCE_MAX_AGE_S));
      return c.redirect(login.url.toString(), 302);
    })
    .get('/callback', async (c) => {
      const pkce = parsePkce(await getSignedCookie(c, config.sessionSecret, PKCE_COOKIE));
      deleteCookie(c, PKCE_COOKIE, cookieOptions(config));
      if (!pkce) return c.text('Sign-in expired or invalid. Please try again.', 400);

      // The provider validates against the registered redirect URI, so rebuild
      // the callback URL on PUBLIC_URL rather than trusting the Host header.
      const callbackUrl = new URL(redirectUri);
      callbackUrl.search = new URL(c.req.url).search;

      let tokens;
      try {
        tokens = await config.oidc.exchangeCode(callbackUrl, pkce);
      } catch {
        return c.text('Sign-in failed. Please try again.', 400);
      }
      if (!tokens.groups.includes(config.adminGroup)) return c.text('Forbidden: not an Admin.', 403);

      const session = createSession(db, tokens, now());
      await setSignedCookie(c, SESSION_COOKIE, session.id, config.sessionSecret, cookieOptions(config, SESSION_MAX_AGE_S));
      return c.redirect(pkce.returnTo, 302);
    })
    .post('/logout', async (c) => {
      const id = await getSignedCookie(c, config.sessionSecret, SESSION_COOKIE);
      if (id) deleteSession(db, id);
      deleteCookie(c, SESSION_COOKIE, cookieOptions(config));
      let target = '/';
      try {
        target = (await config.oidc.endSessionUrl(`${config.publicUrl}/`))?.toString() ?? '/';
      } catch {
        // Provider unreachable: the local session is gone, which is what matters.
      }
      return c.redirect(target, 302);
    });
}
