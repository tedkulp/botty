import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { redactSecrets, secretKeys } from './schema-tools.js';

const schema = z.object({
  url: z.string().optional(),
  apiKey: z.string().meta({ secret: true }).optional(),
  token: z.string().optional().meta({ secret: true }),
  password: z.string().meta({ secret: true }).default(''),
});

describe('secret fields', () => {
  it('finds secrets marked inside or outside optional/default wrappers', () => {
    expect(secretKeys(schema)).toEqual(['apiKey', 'token', 'password']);
  });

  it('redacts secrets to { set } and leaves other fields alone', () => {
    expect(redactSecrets(schema, { url: 'u', apiKey: 'k', password: '' })).toEqual({
      url: 'u',
      apiKey: { set: true },
      token: { set: false },
      password: { set: false },
    });
  });
});
