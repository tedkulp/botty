import { z } from 'zod';
import type { AnyModule, ConfigObject } from './define.js';

/**
 * A JSON Schema object as produced by `z.toJSONSchema`. Fields marked
 * `.meta({ secret: true })` carry `secret: true`; the dashboard's form renderer
 * reads only this, never zod.
 */
export type JsonSchema = Record<string, unknown>;

export interface ModuleJsonSchemas {
  global: JsonSchema;
  channel: JsonSchema;
}

/**
 * The input side of a config schema: fields with a default are not `required`,
 * so the form treats them as optional. Unrepresentable parts become `{}` rather
 * than throwing, and the renderer shows them as unsupported.
 */
export function configJsonSchema(schema: ConfigObject): JsonSchema {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
}

export function moduleJsonSchemas(module: AnyModule): ModuleJsonSchemas {
  return {
    global: configJsonSchema(module.configSchema.global),
    channel: configJsonSchema(module.configSchema.channel),
  };
}
