import { deleteCookie, getSignedCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Db } from '../../../core/db/index.js';
import { cookieOptions, SESSION_COOKIE, type AuthConfig } from './routes.js';
import { applyRefresh, deleteSession, findSession, type Session } from './sessions.js';

/** Refresh when the access token has this long or less to live. */
export const REFRESH_SKEW_MS = 60 * 1000;

/** The signed-in Admin, as recorded in `updated_by` columns. */
export interface Admin {
  sub: string;
  name: string;
}

/** Hono env for everything under `/api`: `c.var.admin` is set by `loadSession`. */
export interface AuthEnv {
  Variables: { admin: Admin | null };
}

/**
 * Resolve the session cookie into `c.var.admin` (null when absent or invalid).
 * A session that can't be kept (refresh failed, Admin group gone) is deleted
 * and answered with 401.
 */
export function loadSession(db: Db, config: AuthConfig) {
  const now = config.now ?? (() => new Date());
  // One refresh per session at a time: concurrent requests share it, so a
  // rotated refresh token isn't spent twice.
  const inFlight = new Map<string, Promise<Session | null>>();

  async function refresh(session: Session): Promise<Session | null> {
    if (!session.refreshToken) return null;
    try {
      const tokens = await config.oidc.refresh(session.refreshToken, session.sub);
      if (tokens.sub !== session.sub || !tokens.groups.includes(config.adminGroup)) return null;
      return applyRefresh(db, session, tokens);
    } catch {
      return null;
    }
  }

  return createMiddleware<AuthEnv>(async (c, next) => {
    c.set('admin', null);
    const id = await getSignedCookie(c, config.sessionSecret, SESSION_COOKIE);
    let session = id ? findSession(db, id) : undefined;
    if (!session) return next();

    if (session.expiresAt.getTime() - now().getTime() <= REFRESH_SKEW_MS) {
      let pending = inFlight.get(session.id);
      if (!pending) {
        pending = refresh(session).finally(() => inFlight.delete(session!.id));
        inFlight.set(session.id, pending);
      }
      const refreshed = await pending;
      if (!refreshed) {
        deleteSession(db, session.id);
        deleteCookie(c, SESSION_COOKIE, cookieOptions(config));
        return c.json({ error: 'unauthorized' }, 401);
      }
      session = refreshed;
    }

    c.set('admin', { sub: session.sub, name: session.name });
    return next();
  });
}

/** 401 unless `loadSession` found an Admin. */
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  if (!c.var.admin) return c.json({ error: 'unauthorized' }, 401);
  return next();
});
