// Drizzle table definitions for core storage. `npm run db:generate` turns
// changes here into SQL migrations under ./drizzle.
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Dashboard sign-in sessions. The cookie carries only the (signed) id. */
export const sessions = sqliteTable('sessions', {
  /** base64url of 32 random bytes. */
  id: text('id').primaryKey(),
  /** OIDC subject: the Admin's stable key. */
  sub: text('sub').notNull(),
  name: text('name').notNull(),
  refreshToken: text('refresh_token'),
  /** When the access token expires; the session is refreshed near this time. */
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
