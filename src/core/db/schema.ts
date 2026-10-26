// Drizzle table definitions for core storage. `npm run db:generate` turns
// changes here into SQL migrations under ./drizzle.
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * One row per (module_id, scope, channel_id). `scope` is `global` or `channel`;
 * `channel_id` is '' for global rows. No row means schema defaults plus default
 * enablement.
 */
export const moduleSettings = sqliteTable(
  'module_settings',
  {
    moduleId: text('module_id').notNull(),
    scope: text('scope', { enum: ['global', 'channel'] }).notNull(),
    channelId: text('channel_id').notNull().default(''),
    /** Channel rows only; groups orphans by guild. */
    guildId: text('guild_id'),
    /** JSON blob, validated with zod on write and leniently on read. */
    config: text('config').notNull().default('{}'),
    /** null = use the default (global: off; channel: the Module's channelDefault). */
    enabled: integer('enabled', { mode: 'boolean' }),
    updatedBySub: text('updated_by_sub'),
    updatedByName: text('updated_by_name'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [primaryKey({ columns: [t.moduleId, t.scope, t.channelId] })],
);

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
