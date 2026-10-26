import type { Actor } from './config-store.js';
import type { ActivityLevel } from './define.js';

/**
 * One Activity entry as written by the core or a Module.
 *
 * References only: jump-links, author display names, URLs and bookmark ids.
 * Never store Discord message text in any field, `message` included.
 */
export interface ActivityEntryInput {
  moduleId: string;
  guildId?: string;
  /** For a thread, the runtime stores the parent channel. */
  channelId?: string;
  level: ActivityLevel;
  /** A short description written by the core or Module, never quoted message text. */
  message: string;
  link?: string;
  actor?: Actor;
}

/** Where Activity entries go. SQLite-backed: `createActivityStore` in activity-store.ts. */
export interface ActivitySink {
  write(entry: ActivityEntryInput): void;
}

export const noopActivitySink: ActivitySink = { write() {} };
