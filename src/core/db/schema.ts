// Drizzle table definitions for core storage. `npm run db:generate` turns
// changes here into SQL migrations under ./drizzle.
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

/**
 * Activity entries: durable per-Module history shown in the dashboard.
 * References only (jump-links, display names, URLs, bookmark ids), never message text.
 * Pruned on insert: older than 30 days, and beyond the newest 1000 per Module.
 */
export const activityEntries = sqliteTable(
  'activity_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    moduleId: text('module_id').notNull(),
    guildId: text('guild_id'),
    /** The parent channel when the entry came from a thread. */
    channelId: text('channel_id'),
    level: text('level', { enum: ['info', 'warn', 'error'] }).notNull(),
    message: text('message').notNull(),
    link: text('link'),
    actorSub: text('actor_sub'),
    actorName: text('actor_name'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('activity_entries_module_created_idx').on(t.moduleId, t.createdAt)],
);
