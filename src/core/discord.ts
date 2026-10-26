import { Client, Events, GatewayIntentBits, type GatewayIntentsString } from 'discord.js';
import type { Logger } from './logger.js';

export type DiscordState = 'ready' | 'down';

/** Read-only view of the gateway connection, injected wherever state is reported. */
export interface DiscordStatusSource {
  state(): DiscordState;
}

interface EventSource {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** Follow a discord.js client's ready / disconnect / reconnect events. */
export function trackConnectionState(client: EventSource): DiscordStatusSource {
  let current: DiscordState = 'down';
  const set = (next: DiscordState) => () => {
    current = next;
  };

  client.on(Events.ClientReady, set('ready'));
  client.on(Events.ShardReady, set('ready'));
  client.on(Events.ShardResume, set('ready'));
  client.on(Events.ShardDisconnect, set('down'));
  client.on(Events.ShardReconnecting, set('down'));
  client.on(Events.Invalidated, set('down'));

  return { state: () => current };
}

/**
 * Placeholder gateway intents. The Module core derives the real set from the
 * events Modules subscribe to.
 */
export const PLACEHOLDER_INTENTS: GatewayIntentsString[] = ['Guilds'];

export interface DiscordConnection {
  client: Client;
  status: DiscordStatusSource;
  /** Log in. Never rejects: a failed login is logged and leaves the state `down`. */
  login(): Promise<void>;
  destroy(): Promise<void>;
}

export interface CreateDiscordOptions {
  token: string;
  logger: Logger;
  intents?: GatewayIntentsString[];
}

export function createDiscordConnection({
  token,
  logger,
  intents = PLACEHOLDER_INTENTS,
}: CreateDiscordOptions): DiscordConnection {
  const log = logger.child({ component: 'discord' });
  const client = new Client({ intents: intents.map((name) => GatewayIntentBits[name]) });
  const status = trackConnectionState(client);

  client.on(Events.ClientReady, (c) => log.info({ user: c.user.tag }, 'discord ready'));
  client.on(Events.ShardDisconnect, (event, shardId) =>
    log.warn({ shardId, code: event.code }, 'discord disconnected'),
  );
  client.on(Events.ShardReconnecting, (shardId) => log.info({ shardId }, 'discord reconnecting'));
  client.on(Events.ShardResume, (shardId) => log.info({ shardId }, 'discord resumed'));
  client.on(Events.Invalidated, () => log.error('discord session invalidated'));
  client.on(Events.Error, (err) => log.error({ err }, 'discord client error'));

  return {
    client,
    status,
    async login() {
      try {
        await client.login(token);
      } catch (err) {
        log.error({ err }, 'discord login failed; continuing without Discord');
      }
    },
    async destroy() {
      await client.destroy();
    },
  };
}
