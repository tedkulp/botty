import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, pingDatabase } from './index.js';

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'botty-db-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeMigrationFolder(dir: string, sql: string): string {
  const folder = join(dir, 'migrations');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, '0000_test.sql'), sql);
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [{ idx: 0, version: '6', when: 1, tag: '0000_test', breakpoints: true }],
    }),
  );
  return folder;
}

describe('database', () => {
  it('applies the shipped migrations to a fresh in-memory database', () => {
    const handle = openDatabase(':memory:');

    expect(() => runMigrations(handle)).not.toThrow();
    expect(pingDatabase(handle)).toBe(true);
    handle.close();
  });

  it('creates the database file under a fresh data dir', () => {
    const dataDir = join(tmp(), 'nested', 'data');
    const handle = openDatabase(join(dataDir, 'botty.db'));
    runMigrations(handle);
    handle.close();

    expect(existsSync(join(dataDir, 'botty.db'))).toBe(true);
  });

  it('applies a migration folder and is idempotent', () => {
    const folder = writeMigrationFolder(tmp(), 'CREATE TABLE widgets (id integer primary key);');
    const handle = openDatabase(':memory:');

    runMigrations(handle, folder);
    runMigrations(handle, folder);
    const row = handle.sqlite.prepare("select count(*) as n from sqlite_master where name = 'widgets'").get();
    expect(row).toEqual({ n: 1 });
    handle.close();
  });

  it('throws when a migration fails', () => {
    const folder = writeMigrationFolder(tmp(), 'CREATE TABLE broken (;');
    const handle = openDatabase(':memory:');

    expect(() => runMigrations(handle, folder)).toThrow();
    handle.close();
  });

  it('reports a closed database as not ok', () => {
    const handle = openDatabase(':memory:');
    handle.close();

    expect(pingDatabase(handle)).toBe(false);
  });
});
