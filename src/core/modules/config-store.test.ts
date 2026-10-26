import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDatabase, runMigrations, type DatabaseHandle } from '../db/index.js';
import { createConfigStore, type ConfigStore } from './config-store.js';
import { defineModule } from './define.js';

const mod = defineModule({
  id: 'sample',
  name: 'Sample',
  channelDefault: false,
  permissions: [],
  configSchema: {
    global: z.object({
      url: z.string().url().optional(),
      apiKey: z.string().meta({ secret: true }).optional(),
      tags: z.array(z.string()).default(['a']),
      limit: z.number().int().default(5),
    }),
    channel: z.object({ tags: z.array(z.string()).default([]), listId: z.string().optional() }),
  },
  setup() {},
});

const admin = { sub: 'sub-1', name: 'Ada' };

let handle: DatabaseHandle;
let store: ConfigStore;
beforeEach(() => {
  handle = openDatabase(':memory:');
  runMigrations(handle);
  store = createConfigStore(handle.db);
});
afterEach(() => handle.close());

describe('config store', () => {
  it('returns schema defaults and default enablement when there is no row', () => {
    expect(store.readGlobal(mod)).toEqual({
      config: { tags: ['a'], limit: 5 },
      needsReview: false,
      enabled: null,
      updatedBy: null,
      updatedAt: null,
    });
    expect(store.readChannel(mod, 'c1')).toMatchObject({
      config: { tags: [] },
      needsReview: false,
      enabled: null,
      guildId: null,
    });
  });

  it('writes a valid Global config and records the Admin', () => {
    store.writeGlobalConfig(mod, { url: 'https://k.example', limit: 9 }, admin);

    const read = store.readGlobal(mod);
    expect(read.config).toEqual({ url: 'https://k.example', tags: ['a'], limit: 9 });
    expect(read.updatedBy).toEqual(admin);
    expect(read.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid write and keeps the stored config', () => {
    store.writeGlobalConfig(mod, { limit: 2 }, admin);

    expect(() => store.writeGlobalConfig(mod, { limit: 'many' }, admin)).toThrow(/limit/);
    expect(store.readGlobal(mod).config.limit).toBe(2);
  });

  it('parses a drifted stored row leniently and flags needsReview', () => {
    store.writeGlobalConfig(mod, { url: 'https://k.example', limit: 3 }, admin);
    handle.sqlite
      .prepare("update module_settings set config = ? where module_id = 'sample'")
      .run(JSON.stringify({ url: 'https://k.example', limit: 'three', tags: 7 }));

    const read = store.readGlobal(mod);
    expect(read.needsReview).toBe(true);
    expect(read.config).toEqual({ url: 'https://k.example', limit: 5, tags: ['a'] });
  });

  it('treats unparseable JSON as defaults with needsReview', () => {
    store.writeGlobalConfig(mod, {}, admin);
    handle.sqlite.prepare("update module_settings set config = 'not json'").run();

    expect(store.readGlobal(mod)).toMatchObject({ config: { tags: ['a'], limit: 5 }, needsReview: true });
  });

  it('keeps the stored secret when a write leaves it blank', () => {
    store.writeGlobalConfig(mod, { apiKey: 's3cret' }, admin);
    store.writeGlobalConfig(mod, { apiKey: '', limit: 7 }, admin);
    store.writeGlobalConfig(mod, { limit: 8 }, admin);

    expect(store.readGlobal(mod).config).toMatchObject({ apiKey: 's3cret', limit: 8 });
  });

  it('writes Channel config with its guild and keeps channels separate', () => {
    store.writeChannelConfig(mod, { channelId: 'c1', guildId: 'g1' }, { tags: ['x'] }, admin);

    expect(store.readChannel(mod, 'c1')).toMatchObject({
      config: { tags: ['x'] },
      guildId: 'g1',
      updatedBy: admin,
    });
    expect(store.readChannel(mod, 'c2').config).toEqual({ tags: [] });
  });

  it('stores enablement separately from config, with null meaning default', () => {
    store.writeGlobalConfig(mod, { limit: 4 }, admin);
    store.setGlobalEnabled(mod.id, true, admin);
    store.setChannelEnabled(mod.id, { channelId: 'c1', guildId: 'g1' }, false, admin);

    expect(store.readGlobal(mod)).toMatchObject({ enabled: true, config: { limit: 4 } });
    expect(store.readChannel(mod, 'c1')).toMatchObject({ enabled: false, guildId: 'g1' });

    store.setChannelEnabled(mod.id, { channelId: 'c1', guildId: 'g1' }, null, admin);
    expect(store.readChannel(mod, 'c1').enabled).toBeNull();
  });

  it('lists and deletes channel rows', () => {
    store.setChannelEnabled(mod.id, { channelId: 'c1', guildId: 'g1' }, true, admin);
    store.writeChannelConfig(mod, { channelId: 'c2', guildId: 'g2' }, {}, admin);

    expect(store.listChannelRows(mod.id).map((r) => [r.channelId, r.guildId, r.enabled])).toEqual([
      ['c1', 'g1', true],
      ['c2', 'g2', null],
    ]);

    store.deleteChannelRow(mod.id, 'c1');
    expect(store.listChannelRows(mod.id).map((r) => r.channelId)).toEqual(['c2']);
  });
});
