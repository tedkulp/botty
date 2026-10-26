import type { Message, PermissionsString } from 'discord.js';
import type { z } from 'zod';
import type { Logger } from '../logger.js';

/** Events a Module may subscribe to, with their handler arguments. v1: messageCreate only. */
export interface ModuleEvents {
  messageCreate: [message: Message];
}
export type ModuleEventName = keyof ModuleEvents;
export const SUPPORTED_EVENTS: readonly ModuleEventName[] = ['messageCreate'];

export type ModuleHandler<E extends ModuleEventName> = (...args: ModuleEvents[E]) => unknown;

export type StatusLevel = 'ok' | 'degraded' | 'error';
export interface ModuleStatus {
  level: StatusLevel;
  message?: string;
}

export type ActivityLevel = 'info' | 'warn' | 'error';

/**
 * What a Module passes to `ctx.activity()`. References only (jump-links, author
 * display names, URLs, bookmark ids), never Discord message text.
 */
export interface ModuleActivityInput {
  /** The core fills in the guild and resolves a thread to its parent channel. */
  channelId?: string;
  level: ActivityLevel;
  message: string;
  link?: string;
}

export type ConfigObject = z.ZodObject;

export interface ModuleConfigSchema<G extends ConfigObject = ConfigObject, C extends ConfigObject = ConfigObject> {
  global: G;
  channel: C;
}

export interface ModuleContext<G extends ConfigObject = ConfigObject, C extends ConfigObject = ConfigObject> {
  on<E extends ModuleEventName>(event: E, handler: ModuleHandler<E>): void;
  /** Global + Channel config for a channel (a thread resolves to its parent). Read at event time. */
  config(channelId: string): { global: z.output<G>; channel: z.output<C> };
  globalConfig(): z.output<G>;
  setStatus(level: StatusLevel, message?: string): void;
  log: Logger;
  activity(entry: ModuleActivityInput): void;
}

export type Cleanup = () => unknown;

export interface ModuleDefinition<G extends ConfigObject = ConfigObject, C extends ConfigObject = ConfigObject> {
  /** Stable forever; all stored data is keyed by it. */
  id: string;
  name: string;
  /** Whether channels with no stored row start switched on. */
  channelDefault: boolean;
  permissions: readonly PermissionsString[];
  configSchema: ModuleConfigSchema<G, C>;
  setup(ctx: ModuleContext<G, C>): void | Cleanup | Promise<void | Cleanup>;
}

/** Any Module, regardless of its config schema types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModule = ModuleDefinition<any, any>;

export function defineModule<G extends ConfigObject, C extends ConfigObject>(
  module: ModuleDefinition<G, C>,
): ModuleDefinition<G, C> {
  return module;
}
