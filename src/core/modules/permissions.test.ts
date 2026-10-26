import { PermissionsBitField } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModule } from './define.js';
import { deriveIntents, invitePermissions, missingPermissions } from './permissions.js';

const empty = { global: z.object({}), channel: z.object({}) };
const a = defineModule({
  id: 'a',
  name: 'A',
  channelDefault: false,
  permissions: ['ViewChannel', 'ReadMessageHistory', 'AddReactions'],
  configSchema: empty,
  setup() {},
});
const b = defineModule({
  id: 'b',
  name: 'B',
  channelDefault: false,
  permissions: ['ViewChannel', 'SendMessages'],
  configSchema: empty,
  setup() {},
});

describe('deriveIntents', () => {
  it('maps messageCreate to Guilds, GuildMessages and MessageContent', () => {
    expect(deriveIntents(['messageCreate']).sort()).toEqual(['GuildMessages', 'Guilds', 'MessageContent']);
  });

  it('always includes Guilds', () => {
    expect(deriveIntents([])).toEqual(['Guilds']);
  });
});

describe('invitePermissions', () => {
  it('is the union of every Module permission', () => {
    expect(invitePermissions([a])).toBe(66624n);
    expect(invitePermissions([a, b])).toBe(66624n + 2048n);
    expect(invitePermissions([])).toBe(0n);
  });
});

describe('missingPermissions', () => {
  it('lists the Module permissions the bot lacks in a channel', () => {
    const perms = new PermissionsBitField(['ViewChannel', 'AddReactions']);
    expect(missingPermissions(a, perms)).toEqual(['ReadMessageHistory']);
  });

  it('treats unknown permissions (null) as all missing', () => {
    expect(missingPermissions(a, null)).toEqual(['ViewChannel', 'ReadMessageHistory', 'AddReactions']);
  });

  it('treats Administrator as having everything', () => {
    expect(missingPermissions(a, new PermissionsBitField(['Administrator']))).toEqual([]);
  });
});
