import { Hono, type Context } from 'hono';
import { validator } from 'hono/validator';
import {
  ConfigValidationError,
  moduleJsonSchemas,
  redactSecrets,
  type AnyModule,
  type ConfigStore,
  type ErrorRecord,
  type ModuleRuntime,
} from '../../../core/modules/index.js';
import type { AuthEnv } from '../auth/middleware.js';
import { findModule, lastEditedJson } from './shared.js';

export interface ModulesApiDeps {
  /** Writes (switches, config) go through the runtime so the core writes Activity entries. */
  runtime: ModuleRuntime;
  /** Reads only. */
  store: ConfigStore;
}

/** JSON shape of a last error. */
export function errorJson(record: ErrorRecord | null) {
  return record ? { message: record.message, at: record.at.toISOString() } : null;
}

/** `/api/modules`: the ⚙️ Modules screen (global switch, status, Global config). */
export function modulesRoutes({ runtime, store }: ModulesApiDeps) {
  function summary(module: AnyModule) {
    return {
      id: module.id,
      name: module.name,
      enabled: store.readGlobal(module).enabled === true,
      status: runtime.status(module.id),
      lastError: errorJson(runtime.lastError(module.id)),
    };
  }

  function detail(module: AnyModule) {
    const global = store.readGlobal(module);
    return {
      ...summary(module),
      schema: moduleJsonSchemas(module),
      config: redactSecrets(module.configSchema.global, global.config as Record<string, unknown>),
      needsReview: global.needsReview,
      ...lastEditedJson(global),
    };
  }

  return new Hono<AuthEnv>()
    .get('/', (c) => c.json({ modules: runtime.modules.map(summary) }))
    .get('/:id', (c) => {
      const module = findModule(runtime, c.req.param('id'));
      if (!module) return c.json({ error: 'unknown Module' }, 404);
      return c.json(detail(module), 200);
    })
    // The body is validated against the Module's zod schema by the runtime; the
    // validator here only types it for the RPC client.
    .put('/:id/config', validator('json', (value) => value as ConfigInput), async (c) => {
      const module = findModule(runtime, c.req.param('id'));
      if (!module) return c.json({ error: 'unknown Module' }, 404);
      const input = c.req.valid('json');
      try {
        runtime.updateGlobalConfig(module.id, input, c.var.admin!);
      } catch (err) {
        if (err instanceof ConfigValidationError) return c.json(validationFailure(err), 400);
        throw err;
      }
      return c.json(detail(module), 200);
    })
    .post('/:id/enabled', validator('json', parseToggle), async (c) => {
      const module = findModule(runtime, c.req.param('id'));
      if (!module) return c.json({ error: 'unknown Module' }, 404);
      const { on } = c.req.valid('json');
      // Awaits setup or cleanup; the runtime records failures as status + last error.
      const status = await runtime.setModuleGlobalEnabled(module.id, on, c.var.admin!);
      return c.json({ enabled: on, status, lastError: errorJson(runtime.lastError(module.id)) }, 200);
    });
}

/** A field error as the form renderer shows it: `path` is relative to the config object. */
export interface FieldError {
  path: (string | number)[];
  message: string;
}

/** The 400 body for a config that fails validation. Messages never echo submitted values. */
export function validationFailure(err: ConfigValidationError) {
  const fieldErrors: FieldError[] = err.issues.map((issue) => ({
    path: issue.path.map((p) => (typeof p === 'number' ? p : String(p))),
    message: issue.message,
  }));
  return { error: 'invalid config' as const, fieldErrors };
}

/** A config as submitted by the dashboard form: blank secrets mean unchanged. */
export type ConfigInput = Record<string, unknown>;

/** The body of a switch request (global and channel switches). */
export function parseToggle(value: unknown, c: Context): { on: boolean } | Response {
  const on = (value as { on?: unknown } | null)?.on;
  if (typeof on !== 'boolean') return c.json({ error: '`on` must be a boolean' }, 400);
  return { on };
}
