/**
 * JSON Schema (from `z.toJSONSchema(..., { io: 'input' })`) -> the fields the
 * form renders, plus conversions between stored config, the editable draft and
 * the payload sent on Save. Pure; no React.
 */

export type JsonSchema = Record<string, unknown>;

export type FieldKind = 'string' | 'secret' | 'number' | 'boolean' | 'tags' | 'unsupported';

export interface FieldSpec {
  key: string;
  kind: FieldKind;
  label: string;
  description?: string;
  /** False when the field may be left out (optional, or has a default). */
  required: boolean;
  /** For numbers: whole numbers only. */
  integer?: boolean;
  /** e.g. `uri`, rendered as a URL input. */
  format?: string;
}

/** What each kind holds while editing. */
export type DraftValue = string | boolean | string[] | { passthrough: unknown };
export type Draft = Record<string, DraftValue>;

/** A save that the server rejected: `path` is relative to the config object. */
export interface FieldError {
  path: (string | number)[];
  message: string;
}

/** `karakeepUrl` -> `Karakeep url`. */
export function humanize(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function kindOf(prop: JsonSchema): Pick<FieldSpec, 'kind' | 'integer' | 'format'> {
  const type = prop.type;
  if (type === 'string') {
    if (prop.secret === true) return { kind: 'secret' };
    return typeof prop.format === 'string' ? { kind: 'string', format: prop.format } : { kind: 'string' };
  }
  if (type === 'number' || type === 'integer') return { kind: 'number', integer: type === 'integer' };
  if (type === 'boolean') return { kind: 'boolean' };
  if (type === 'array' && (prop.items as JsonSchema | undefined)?.type === 'string') return { kind: 'tags' };
  return { kind: 'unsupported' };
}

export function fieldsFromSchema(schema: JsonSchema): FieldSpec[] {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([key, prop]) => ({
    key,
    label: typeof prop.title === 'string' ? prop.title : humanize(key),
    ...(typeof prop.description === 'string' ? { description: prop.description } : {}),
    required: required.has(key),
    ...kindOf(prop),
  }));
}

/** Whether a redacted secret (`{ set }`) holds a value. */
export function secretIsSet(value: unknown): boolean {
  return (value as { set?: unknown } | null)?.set === true;
}

/** The editable draft for a (redacted) config. Secrets always start blank. */
export function toDraft(fields: FieldSpec[], value: Record<string, unknown>): Draft {
  const draft: Draft = {};
  for (const field of fields) {
    const v = value[field.key];
    switch (field.kind) {
      case 'string':
        draft[field.key] = typeof v === 'string' ? v : '';
        break;
      case 'secret':
        draft[field.key] = '';
        break;
      case 'number':
        draft[field.key] = typeof v === 'number' ? String(v) : '';
        break;
      case 'boolean':
        draft[field.key] = v === true;
        break;
      case 'tags':
        draft[field.key] = Array.isArray(v) ? v.map(String) : [];
        break;
      case 'unsupported':
        draft[field.key] = { passthrough: v };
        break;
    }
  }
  return draft;
}

/**
 * The body for Save. Blank secrets and blank optional fields are left out (a
 * blank secret means "unchanged"); everything else is sent for the server's
 * zod schema to judge.
 */
export function toPayload(fields: FieldSpec[], draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const v = draft[field.key];
    switch (field.kind) {
      case 'string':
        if (v !== '' || field.required) out[field.key] = v;
        break;
      case 'secret':
        if (v !== '') out[field.key] = v;
        break;
      case 'number': {
        const raw = (v as string).trim();
        if (raw === '') break;
        const n = Number(raw);
        out[field.key] = Number.isFinite(n) ? n : raw;
        break;
      }
      case 'boolean':
      case 'tags':
        out[field.key] = v;
        break;
      case 'unsupported': {
        const passthrough = (v as { passthrough: unknown }).passthrough;
        if (passthrough !== undefined) out[field.key] = passthrough;
        break;
      }
    }
  }
  return out;
}
