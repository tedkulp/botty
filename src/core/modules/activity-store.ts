import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { activityEntries } from '../db/schema.js';
import type { ActivityEntryInput, ActivitySink } from './activity.js';
import type { Actor } from './config-store.js';
import type { ActivityLevel } from './define.js';

/**
 * A stored Activity entry. Like its input, it holds references only (jump-links,
 * display names, URLs, bookmark ids), never message text.
 */
export interface ActivityEntry {
  /** Increases with insertion; pass it as `before` to page. */
  id: number;
  moduleId: string;
  guildId: string | null;
  /** The parent channel when the entry came from a thread. */
  channelId: string | null;
  level: ActivityLevel;
  message: string;
  link: string | null;
  /** The Admin who made the change, for Enable switches and config edits. */
  actor: Actor | null;
  createdAt: Date;
}

export interface ListActivityQuery {
  moduleId: string;
  guildId?: string;
  channelId?: string;
  /** Page size. Default 50, capped at 200. */
  limit?: number;
  /** Only entries older than this entry id (the last `id` of the previous page). */
  before?: number;
}

export interface ActivityStore extends ActivitySink {
  /** A Module's entries, newest first. */
  listActivity(query: ListActivityQuery): ActivityEntry[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PER_MODULE = 1000;

export interface ActivityStoreOptions {
  now?: () => Date;
}

export function createActivityStore(db: Db, options: ActivityStoreOptions = {}): ActivityStore {
  const now = options.now ?? (() => new Date());

  return {
    write(entry: ActivityEntryInput) {
      const createdAt = now();
      db.transaction((tx) => {
        tx.insert(activityEntries)
          .values({
            moduleId: entry.moduleId,
            guildId: entry.guildId ?? null,
            channelId: entry.channelId ?? null,
            level: entry.level,
            message: entry.message,
            link: entry.link ?? null,
            actorSub: entry.actor?.sub ?? null,
            actorName: entry.actor?.name ?? null,
            createdAt,
          })
          .run();
        // Age applies to every Module, so a Module that stops writing still loses old entries.
        tx.delete(activityEntries)
          .where(lt(activityEntries.createdAt, new Date(createdAt.getTime() - MAX_AGE_MS)))
          .run();
        // The count cap only ever touches the writing Module.
        const ofModule = eq(activityEntries.moduleId, entry.moduleId);
        const cutoff = tx
          .select({ id: activityEntries.id })
          .from(activityEntries)
          .where(ofModule)
          .orderBy(desc(activityEntries.id))
          .limit(1)
          .offset(MAX_PER_MODULE - 1)
          .get();
        if (cutoff)
          tx.delete(activityEntries)
            .where(and(ofModule, lt(activityEntries.id, cutoff.id)))
            .run();
      });
    },

    listActivity(query) {
      const rows = db
        .select()
        .from(activityEntries)
        .where(
          and(
            eq(activityEntries.moduleId, query.moduleId),
            query.guildId !== undefined ? eq(activityEntries.guildId, query.guildId) : undefined,
            query.channelId !== undefined ? eq(activityEntries.channelId, query.channelId) : undefined,
            query.before !== undefined ? lt(activityEntries.id, query.before) : undefined,
          ),
        )
        .orderBy(desc(activityEntries.id))
        .limit(Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT))
        .all();
      return rows.map((row) => ({
        id: row.id,
        moduleId: row.moduleId,
        guildId: row.guildId,
        channelId: row.channelId,
        level: row.level,
        message: row.message,
        link: row.link,
        actor: row.actorSub ? { sub: row.actorSub, name: row.actorName ?? '' } : null,
        createdAt: row.createdAt,
      }));
    },
  };
}
