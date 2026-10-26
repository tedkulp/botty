import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/index.js';
import { moduleSettings } from '../db/schema.js';
import type { AnyModule, ConfigObject } from './define.js';
import { parseLeniently, secretKeys } from './schema-tools.js';

/** The Admin making a change, recorded as `updated_by_*`. */
export interface Actor {
  sub: string;
  name: string;
}

export interface ConfigRead<T> {
  config: T;
  /** A stored field failed validation and was replaced by its default. Nothing is auto-repaired. */
  needsReview: boolean;
  /** null = no stored choice (global default: off; channel default: the Module's channelDefault). */
  enabled: boolean | null;
  updatedBy: Actor | null;
  updatedAt: Date | null;
}

export interface ChannelConfigRead<T> extends ConfigRead<T> {
  guildId: string | null;
}

export interface ChannelRef {
  channelId: string;
  guildId: string;
}

export interface ChannelRow {
  channelId: string;
  guildId: string | null;
  enabled: boolean | null;
  updatedBy: Actor | null;
  updatedAt: Date | null;
}

export class ConfigValidationError extends Error {
  constructor(
    readonly issues: z.core.$ZodIssue[],
    message: string,
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

type GlobalOf<M extends AnyModule> = z.output<M['configSchema']['global']>;
type ChannelOf<M extends AnyModule> = z.output<M['configSchema']['channel']>;

/**
 * Synchronous, uncached access to `module_settings`. Every read hits SQLite.
 * Config and enablement live in the same row but are written independently.
 */
export interface ConfigStore {
  readGlobal<M extends AnyModule>(module: M): ConfigRead<GlobalOf<M>>;
  readChannel<M extends AnyModule>(module: M, channelId: string): ChannelConfigRead<ChannelOf<M>>;
  /** Validates with zod (throws ConfigValidationError). A blank secret keeps the stored value. */
  writeGlobalConfig<M extends AnyModule>(module: M, input: unknown, actor: Actor): ConfigRead<GlobalOf<M>>;
  writeChannelConfig<M extends AnyModule>(
    module: M,
    channel: ChannelRef,
    input: unknown,
    actor: Actor,
  ): ChannelConfigRead<ChannelOf<M>>;
  setGlobalEnabled(moduleId: string, enabled: boolean | null, actor: Actor): void;
  setChannelEnabled(moduleId: string, channel: ChannelRef, enabled: boolean | null, actor: Actor): void;
  /** Every stored channel row for a Module, including orphans. */
  listChannelRows(moduleId: string): ChannelRow[];
  deleteChannelRow(moduleId: string, channelId: string): void;
}

type Row = typeof moduleSettings.$inferSelect;
type Scope = Row['scope'];

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function actorOf(row: Row | undefined): Actor | null {
  return row?.updatedBySub ? { sub: row.updatedBySub, name: row.updatedByName ?? '' } : null;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

export function createConfigStore(db: Db): ConfigStore {
  function getRow(moduleId: string, scope: Scope, channelId: string): Row | undefined {
    return db
      .select()
      .from(moduleSettings)
      .where(
        and(
          eq(moduleSettings.moduleId, moduleId),
          eq(moduleSettings.scope, scope),
          eq(moduleSettings.channelId, channelId),
        ),
      )
      .get();
  }

  function read<T>(schema: ConfigObject, row: Row | undefined): ConfigRead<T> {
    const { config, needsReview } = parseLeniently(schema, row ? parseJson(row.config) : {});
    return {
      config: config as T,
      needsReview,
      enabled: row?.enabled ?? null,
      updatedBy: actorOf(row),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  function upsert(
    key: { moduleId: string; scope: Scope; channelId: string; guildId: string | null },
    values: { config?: string; enabled?: boolean | null },
    actor: Actor,
  ): void {
    const audit = { updatedBySub: actor.sub, updatedByName: actor.name, updatedAt: new Date() };
    const set = { ...values, ...audit, ...(key.guildId !== null ? { guildId: key.guildId } : {}) };
    db.insert(moduleSettings)
      .values({ ...key, ...values, ...audit })
      .onConflictDoUpdate({
        target: [moduleSettings.moduleId, moduleSettings.scope, moduleSettings.channelId],
        set,
      })
      .run();
  }

  function validate(schema: ConfigObject, stored: Row | undefined, input: unknown): string {
    const incoming =
      input !== null && typeof input === 'object' && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : input;
    if (incoming !== null && typeof incoming === 'object') {
      const previous = stored ? (parseJson(stored.config) as Record<string, unknown> | undefined) : undefined;
      for (const key of secretKeys(schema)) {
        const record = incoming as Record<string, unknown>;
        if (!isBlank(record[key])) continue;
        if (previous && !isBlank(previous[key])) record[key] = previous[key];
        else delete record[key];
      }
    }
    const result = schema.safeParse(incoming);
    if (!result.success) {
      const detail = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new ConfigValidationError(result.error.issues, `invalid config: ${detail}`);
    }
    return JSON.stringify(result.data);
  }

  const store: ConfigStore = {
    readGlobal(module) {
      return read(module.configSchema.global, getRow(module.id, 'global', ''));
    },

    readChannel(module, channelId) {
      const row = getRow(module.id, 'channel', channelId);
      return { ...read(module.configSchema.channel, row), guildId: row?.guildId ?? null };
    },

    writeGlobalConfig(module, input, actor) {
      const stored = getRow(module.id, 'global', '');
      const config = validate(module.configSchema.global, stored, input);
      upsert({ moduleId: module.id, scope: 'global', channelId: '', guildId: null }, { config }, actor);
      return store.readGlobal(module);
    },

    writeChannelConfig(module, channel, input, actor) {
      const stored = getRow(module.id, 'channel', channel.channelId);
      const config = validate(module.configSchema.channel, stored, input);
      upsert({ moduleId: module.id, scope: 'channel', ...channel }, { config }, actor);
      return store.readChannel(module, channel.channelId);
    },

    setGlobalEnabled(moduleId, enabled, actor) {
      upsert({ moduleId, scope: 'global', channelId: '', guildId: null }, { enabled }, actor);
    },

    setChannelEnabled(moduleId, channel, enabled, actor) {
      upsert({ moduleId, scope: 'channel', ...channel }, { enabled }, actor);
    },

    listChannelRows(moduleId) {
      return db
        .select()
        .from(moduleSettings)
        .where(and(eq(moduleSettings.moduleId, moduleId), eq(moduleSettings.scope, 'channel')))
        .orderBy(asc(moduleSettings.channelId))
        .all()
        .map((row) => ({
          channelId: row.channelId,
          guildId: row.guildId,
          enabled: row.enabled,
          updatedBy: actorOf(row),
          updatedAt: row.updatedAt,
        }));
    },

    deleteChannelRow(moduleId, channelId) {
      db.delete(moduleSettings)
        .where(
          and(
            eq(moduleSettings.moduleId, moduleId),
            eq(moduleSettings.scope, 'channel'),
            eq(moduleSettings.channelId, channelId),
          ),
        )
        .run();
    },
  };
  return store;
}
