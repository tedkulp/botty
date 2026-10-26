// Test harness for Modules. Builds a real runtime and config store on SQLite
// :memory: with the real migrations, fed by a fake event source and fake
// channels, so Module tests never mock discord.js themselves.
import { EventEmitter } from 'node:events';
import { Collection, type Message } from 'discord.js';
import type { z } from 'zod';
import { openDatabase, runMigrations } from '../db/index.js';
import { createLogger } from '../logger.js';
import type { ActivityEntryInput } from './activity.js';
import { createConfigStore, type Actor, type ConfigStore } from './config-store.js';
import type { AnyModule, ModuleStatus } from './define.js';
import { createModuleRuntime, type ChannelResolver, type ModuleRuntime } from './runtime.js';

export const TEST_ADMIN: Actor = { sub: 'test-admin', name: 'Test Admin' };

export interface FakeMessageInput {
  content?: string;
  author?: { id?: string; username?: string; displayName?: string; bot?: boolean };
  /** Sent through a webhook (`webhookId` set). */
  webhook?: boolean;
  /** Contents of forwarded messages (`messageSnapshots[].content`). */
  snapshots?: string[];
  /** Channel the message lands in; defaults to the harness channel. */
  channelId?: string;
  channelName?: string;
  /** Post in a thread under `channelId` instead of the channel itself. */
  thread?: boolean;
}

export interface SentMessage {
  id: string;
  /** The channel (or thread) id the message was posted in. */
  channelId: string;
  url: string;
  /** Emojis the Module reacted with, in order. */
  reactions: string[];
  /** The fake discord.js Message handed to handlers. */
  message: Message;
}

export interface RecordedReaction {
  messageId: string;
  channelId: string;
  emoji: string;
}

export interface TestContext<M extends AnyModule> {
  module: M;
  runtime: ModuleRuntime;
  store: ConfigStore;
  guildId: string;
  guildName: string;
  /** The default channel, Enabled for the Module. */
  channelId: string;
  /** Push a fake `messageCreate` and wait for every handler to finish. */
  sendMessage(input?: FakeMessageInput): Promise<SentMessage>;
  reactions: RecordedReaction[];
  activity: ActivityEntryInput[];
  statusChanges: ModuleStatus[];
  status(): ModuleStatus;
  setGlobalConfig(input: z.input<M['configSchema']['global']>): void;
  setChannelConfig(input: z.input<M['configSchema']['channel']>, channelId?: string): void;
  setChannelEnabled(channelId: string, on: boolean | null): void;
  setGlobalEnabled(on: boolean): Promise<ModuleStatus>;
  close(): Promise<void>;
}

export interface CreateTestContextOptions<M extends AnyModule> {
  module: M;
  globalConfig?: z.input<M['configSchema']['global']>;
  channelConfig?: z.input<M['configSchema']['channel']>;
}

/**
 * A Module switched on globally and Enabled in one channel of one guild, with
 * its config set and `setup` already run.
 */
export async function createTestContext<M extends AnyModule>(
  options: CreateTestContextOptions<M>,
): Promise<TestContext<M>> {
  const { module } = options;
  const guildId = 'guild-1';
  const guildName = 'Test Guild';
  const channelId = 'channel-1';

  const handle = openDatabase(':memory:');
  runMigrations(handle);
  const store = createConfigStore(handle.db);
  const events = new EventEmitter();
  const threadParents = new Map<string, string>();
  const channels: ChannelResolver = {
    resolve: (id) => ({ channelId: threadParents.get(id) ?? id, guildId }),
  };

  const activity: ActivityEntryInput[] = [];
  const statusChanges: ModuleStatus[] = [];
  const reactions: RecordedReaction[] = [];
  const runtime = createModuleRuntime({
    modules: [module],
    store,
    events,
    channels,
    logger: createLogger('silent'),
    activity: { write: (entry) => void activity.push(entry) },
    onStatusChange: (_id, status) => void statusChanges.push(status),
  });

  try {
    if (options.globalConfig !== undefined) store.writeGlobalConfig(module, options.globalConfig, TEST_ADMIN);
    if (options.channelConfig !== undefined)
      store.writeChannelConfig(module, { channelId, guildId }, options.channelConfig, TEST_ADMIN);
  } catch (err) {
    handle.close();
    throw err;
  }
  store.setGlobalEnabled(module.id, true, TEST_ADMIN);
  store.setChannelEnabled(module.id, { channelId, guildId }, true, TEST_ADMIN);
  await runtime.start();

  let seq = 0;
  const guild = { id: guildId, name: guildName };

  return {
    module,
    runtime,
    store,
    guildId,
    guildName,
    channelId,
    reactions,
    activity,
    statusChanges,

    async sendMessage(input = {}) {
      seq += 1;
      const parentId = input.channelId ?? channelId;
      const postedIn = input.thread ? `${parentId}-thread` : parentId;
      if (input.thread) threadParents.set(postedIn, parentId);
      const id = `message-${seq}`;
      const url = `https://discord.com/channels/${guildId}/${postedIn}/${id}`;
      const sent: SentMessage = { id, channelId: postedIn, url, reactions: [], message: undefined as never };
      const username = input.author?.username ?? 'ada';
      const channel = {
        id: postedIn,
        name: input.channelName ?? (input.thread ? 'thread' : 'general'),
        guildId,
        parentId: input.thread ? parentId : null,
        isThread: () => input.thread === true,
        toString: () => `<#${postedIn}>`,
      };
      const fake = {
        id,
        content: input.content ?? '',
        author: {
          id: input.author?.id ?? 'user-1',
          username,
          globalName: input.author?.displayName ?? username,
          displayName: input.author?.displayName ?? username,
          bot: input.author?.bot ?? false,
          toString: () => `<@${input.author?.id ?? 'user-1'}>`,
        },
        member: { displayName: input.author?.displayName ?? username },
        webhookId: input.webhook ? 'webhook-1' : null,
        messageSnapshots: new Collection(
          (input.snapshots ?? []).map((content, i) => [`snapshot-${seq}-${i}`, { content }] as const),
        ),
        channelId: postedIn,
        channel,
        guildId,
        guild,
        url,
        createdTimestamp: Date.now(),
        inGuild: () => true,
        async react(emoji: string) {
          sent.reactions.push(emoji);
          reactions.push({ messageId: id, channelId: postedIn, emoji });
          return { emoji: { name: emoji } };
        },
      };
      sent.message = fake as unknown as Message;
      events.emit('messageCreate', sent.message);
      await runtime.settled();
      return sent;
    },

    status: () => runtime.status(module.id),
    setGlobalConfig: (input) => void store.writeGlobalConfig(module, input, TEST_ADMIN),
    setChannelConfig: (input, id = channelId) =>
      void store.writeChannelConfig(module, { channelId: id, guildId }, input, TEST_ADMIN),
    setChannelEnabled: (id, on) => store.setChannelEnabled(module.id, { channelId: id, guildId }, on, TEST_ADMIN),
    setGlobalEnabled: (on) => runtime.setModuleGlobalEnabled(module.id, on, TEST_ADMIN),

    async close() {
      await runtime.stop();
      handle.close();
    },
  };
}
