import { z } from 'zod';
import type { ConfigObject } from './define.js';

interface Wrapper {
  meta(): Record<string, unknown> | undefined;
  unwrap?: () => unknown;
  _zod: { def: { type: string; innerType?: unknown } };
}

/** True when a field (or any optional/default/nullable wrapper of it) has `.meta({ secret: true })`. */
export function isSecretField(field: unknown): boolean {
  let current = field as Wrapper | undefined;
  for (let depth = 0; current && depth < 10; depth++) {
    if (current.meta()?.secret === true) return true;
    const inner = current._zod.def.innerType as Wrapper | undefined;
    current = inner;
  }
  return false;
}

/** Keys of an object schema whose fields are marked secret. */
export function secretKeys(schema: ConfigObject): string[] {
  return Object.entries(schema.shape)
    .filter(([, field]) => isSecretField(field))
    .map(([key]) => key);
}

export interface LenientResult<T> {
  config: T;
  needsReview: boolean;
}

/**
 * Parse stored config without ever throwing: a field that fails validation
 * falls back to its schema default (or is dropped) and flags `needsReview`.
 */
export function parseLeniently<S extends ConfigObject>(schema: S, raw: unknown): LenientResult<z.output<S>> {
  const whole = schema.safeParse(raw);
  if (whole.success) return { config: whole.data, needsReview: false };

  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    const parsed = field.safeParse(source[key]);
    if (parsed.success) {
      if (parsed.data !== undefined) out[key] = parsed.data;
      continue;
    }
    const fallback = field.safeParse(undefined);
    if (fallback.success && fallback.data !== undefined) out[key] = fallback.data;
  }
  return { config: out as z.output<S>, needsReview: true };
}

/** Config with each secret field replaced by `{ set: boolean }`, safe to return from the API. */
export function redactSecrets(schema: ConfigObject, config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const key of secretKeys(schema)) {
    const value = config[key];
    out[key] = { set: value !== undefined && value !== null && value !== '' };
  }
  return out;
}
