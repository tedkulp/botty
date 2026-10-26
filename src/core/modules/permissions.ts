import { PermissionsBitField, type GatewayIntentsString, type PermissionsString } from 'discord.js';
import type { AnyModule, ModuleEventName } from './define.js';

const EVENT_INTENTS: Record<ModuleEventName, GatewayIntentsString[]> = {
  messageCreate: ['GuildMessages', 'MessageContent'],
};

/** Gateway intents for a set of subscribed events. `Guilds` is always on (guild/channel cache). */
export function deriveIntents(events: Iterable<ModuleEventName>): GatewayIntentsString[] {
  const intents = new Set<GatewayIntentsString>(['Guilds']);
  for (const event of events) for (const intent of EVENT_INTENTS[event]) intents.add(intent);
  return [...intents];
}

/** The invite permission integer: the union of every Module's `permissions`. */
export function invitePermissions(modules: readonly AnyModule[]): bigint {
  return PermissionsBitField.resolve(modules.flatMap((m) => [...m.permissions]));
}

/** Anything shaped like `channel.permissionsFor(me)`'s result. */
export interface PermissionCheck {
  has(permission: PermissionsString, checkAdmin?: boolean): boolean;
}

/** Module permissions the bot lacks in a channel. `null` (unknown) means all are missing. */
export function missingPermissions(module: AnyModule, perms: PermissionCheck | null): PermissionsString[] {
  return module.permissions.filter((p) => !perms?.has(p, true));
}
