import type { Actor } from './config-store.js';
import type { ActivityLevel } from './define.js';

/** One Activity entry as written by the core or a Module. References only, never message text. */
export interface ActivityEntryInput {
  moduleId: string;
  guildId?: string;
  channelId?: string;
  level: ActivityLevel;
  message: string;
  link?: string;
  actor?: Actor;
}

/** Where Activity entries go. #15 provides the SQLite-backed implementation. */
export interface ActivitySink {
  write(entry: ActivityEntryInput): void;
}

export const noopActivitySink: ActivitySink = { write() {} };
