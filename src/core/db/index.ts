import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  /** Drizzle query builder over the core schema. */
  db: Db;
  /** The underlying better-sqlite3 connection. */
  sqlite: Database.Database;
  close(): void;
}

/**
 * The drizzle-kit migrations folder at the package root. Same relative depth
 * from `src/core/db` and `dist/core/db`, so it resolves in dev and in builds.
 * (Not `new URL('…', import.meta.url)`: Vite rewrites that pattern into an
 * asset URL when the dashboard's jsdom tests import server code.)
 */
export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

/** Open (creating if needed) a SQLite database. Pass `:memory:` for tests. */
export function openDatabase(path: string): DatabaseHandle {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    close: () => {
      if (sqlite.open) sqlite.close();
    },
  };
}

/** Apply pending migrations. Throws if any migration fails. */
export function runMigrations(handle: DatabaseHandle, migrationsFolder: string = MIGRATIONS_FOLDER): void {
  migrate(handle.db, { migrationsFolder });
}

/** `select 1` against the database; false if it fails or the connection is closed. */
export function pingDatabase(handle: DatabaseHandle): boolean {
  try {
    return handle.sqlite.prepare('select 1 as ok').get() !== undefined;
  } catch {
    return false;
  }
}
