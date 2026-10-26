import { z } from 'zod';

const required = z.string().trim().min(1, 'is required');

const envSchema = z.object({
  DISCORD_TOKEN: required,
  OIDC_ISSUER: z.url(),
  OIDC_CLIENT_ID: required,
  OIDC_CLIENT_SECRET: required,
  ADMIN_GROUP: required,
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  PUBLIC_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, '')),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: required.default('/data'),
});

export type Env = z.output<typeof envSchema>;

export interface EnvError {
  variable: string;
  message: string;
}

export type ParseEnvResult = { ok: true; env: Env } | { ok: false; errors: EnvError[] };

/** Validate the bootstrap env. Empty strings count as unset. Reports every bad var. */
export function parseEnv(source: Record<string, string | undefined>): ParseEnvResult {
  const input: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') input[key] = value;
  }

  const result = envSchema.safeParse(input);
  if (result.success) return { ok: true, env: result.data };

  const errors = result.error.issues.map((issue) => {
    const variable = String(issue.path[0] ?? '(env)');
    return { variable, message: input[variable] === undefined ? 'is required' : issue.message };
  });
  return { ok: false, errors };
}

export function formatEnvErrors(errors: EnvError[]): string {
  return ['Invalid environment:', ...errors.map((e) => `  ${e.variable}: ${e.message}`)].join('\n');
}
