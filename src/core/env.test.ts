import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const valid = {
  DISCORD_TOKEN: 'token',
  OIDC_ISSUER: 'https://id.example.com',
  OIDC_CLIENT_ID: 'botty',
  OIDC_CLIENT_SECRET: 'secret',
  ADMIN_GROUP: 'botty-admins',
  SESSION_SECRET: 'a-session-secret-that-is-at-least-32-chars',
  PUBLIC_URL: 'https://botty.example.com',
};

describe('parseEnv', () => {
  it('accepts a valid env and applies defaults', () => {
    const result = parseEnv(valid);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env).toMatchObject({
      DISCORD_TOKEN: 'token',
      PUBLIC_URL: 'https://botty.example.com',
      LOG_LEVEL: 'info',
      PORT: 3000,
      DATA_DIR: '/data',
    });
  });

  it('coerces PORT and accepts overrides', () => {
    const result = parseEnv({ ...valid, PORT: '8080', LOG_LEVEL: 'debug', DATA_DIR: './data' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.PORT).toBe(8080);
    expect(result.env.LOG_LEVEL).toBe('debug');
    expect(result.env.DATA_DIR).toBe('./data');
  });

  it('reports every bad var together', () => {
    const { DISCORD_TOKEN: _t, ADMIN_GROUP: _g, ...rest } = valid;
    const result = parseEnv({
      ...rest,
      PUBLIC_URL: 'not a url',
      PORT: 'abc',
      LOG_LEVEL: 'loud',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const vars = result.errors.map((e) => e.variable).sort();
    expect(vars).toEqual(['ADMIN_GROUP', 'DISCORD_TOKEN', 'LOG_LEVEL', 'PORT', 'PUBLIC_URL']);
    for (const e of result.errors) expect(e.message).not.toBe('');
  });

  it('treats empty strings as missing', () => {
    const result = parseEnv({ ...valid, DISCORD_TOKEN: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ variable: 'DISCORD_TOKEN', message: 'is required' }]);
  });
});
