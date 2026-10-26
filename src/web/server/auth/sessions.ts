import { randomBytes } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../../../core/db/index.js';
import { sessions } from '../../../core/db/schema.js';
import type { OidcTokens } from './oidc.js';

export type Session = typeof sessions.$inferSelect;

export function createSession(db: Db, tokens: OidcTokens, now: Date): Session {
  const row: Session = {
    id: randomBytes(32).toString('base64url'),
    sub: tokens.sub,
    name: tokens.name,
    refreshToken: tokens.refreshToken ?? null,
    expiresAt: tokens.expiresAt,
    createdAt: now,
  };
  db.insert(sessions).values(row).run();
  return row;
}

export function findSession(db: Db, id: string): Session | undefined {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

/** Store refreshed tokens. Keeps the old refresh token if the provider didn't rotate it. */
export function applyRefresh(db: Db, session: Session, tokens: OidcTokens): Session {
  const next: Session = {
    ...session,
    name: tokens.name || session.name,
    refreshToken: tokens.refreshToken ?? session.refreshToken,
    expiresAt: tokens.expiresAt,
  };
  db.update(sessions)
    .set({ name: next.name, refreshToken: next.refreshToken, expiresAt: next.expiresAt })
    .where(eq(sessions.id, session.id))
    .run();
  return next;
}

export function deleteSession(db: Db, id: string): void {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

/**
 * Delete sessions that can never be used again: past `maxAgeMs` since sign-in
 * (the cookie is gone), or expired with no refresh token to renew them.
 */
export function pruneSessions(db: Db, now: Date, maxAgeMs: number): void {
  db.delete(sessions)
    .where(
      or(
        lt(sessions.createdAt, new Date(now.getTime() - maxAgeMs)),
        and(isNull(sessions.refreshToken), lt(sessions.expiresAt, now)),
      ),
    )
    .run();
}
