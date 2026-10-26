import type { Message } from 'discord.js';
import type { Logger } from '../logger.js';
import { noopActivitySink, type ActivityEntryInput, type ActivitySink } from './activity.js';
import type { Actor, ChannelRef, ConfigStore } from './config-store.js';
import type {
  AnyModule,
  Cleanup,
  ModuleContext,
  ModuleEventName,
  ModuleEvents,
  ModuleStatus,
  StatusLevel,
} from './define.js';
import { isEnabled } from './enablement.js';

type Listener = (...args: any[]) => void;

/** Where events come from. A discord.js Client satisfies this; tests use an EventEmitter. */
export interface ModuleEventSource {
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
}

/**
 * Maps a channel id to the channel used for enablement and config: a thread or
 * forum post resolves to its parent. Unknown channels resolve to themselves.
 */
export interface ChannelResolver {
  resolve(channelId: string): { channelId: string; guildId: string | null };
}

export interface ErrorRecord {
  message: string;
  at: Date;
  channelId?: string;
}

export type StatusListener = (moduleId: string, status: ModuleStatus) => void;

export interface ModuleRuntimeOptions {
  modules: readonly AnyModule[];
  store: ConfigStore;
  events: ModuleEventSource;
  channels: ChannelResolver;
  logger: Logger;
  activity?: ActivitySink;
  onStatusChange?: StatusListener;
}

export interface ModuleRuntime {
  readonly modules: readonly AnyModule[];
  module(id: string): AnyModule;
  /** Run `setup` for every Module that is on globally. Never rejects. */
  start(): Promise<void>;
  /** Run every cleanup and drop all subscriptions. */
  stop(): Promise<void>;
  /** Store the global switch, await setup or cleanup, and return the resulting Module status. */
  setModuleGlobalEnabled(id: string, on: boolean, actor: Actor): Promise<ModuleStatus>;
  /** Store the channel switch (null = back to channelDefault). Applies from the next event. */
  setModuleChannelEnabled(id: string, channel: ChannelRef, on: boolean | null, actor: Actor): void;
  /** Validate and save Global config, writing an Activity entry. Throws ConfigValidationError. */
  updateGlobalConfig(id: string, input: unknown, actor: Actor): void;
  updateChannelConfig(id: string, channel: ChannelRef, input: unknown, actor: Actor): void;
  /** Enabled (in a channel), with threads resolved to their parent. */
  isEnabledIn(id: string, channelId: string): boolean;
  /** Whether setup has run and the Module's handlers are registered. */
  isActive(id: string): boolean;
  status(id: string): ModuleStatus;
  lastError(id: string): ErrorRecord | null;
  /** Last handler error in a channel; errors in its threads count toward it. */
  lastErrorIn(id: string, channelId: string): ErrorRecord | null;
  /** Resolves once every in-flight dispatch and lifecycle change has finished. */
  settled(): Promise<void>;
}

/** Channel id an event belongs to, or null to drop it (e.g. DMs). */
const EVENT_CHANNEL: { [E in ModuleEventName]: (...args: ModuleEvents[E]) => string | null } = {
  messageCreate: (message: Message) => (message.guildId ? message.channelId : null),
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface ModuleState {
  module: AnyModule;
  status: ModuleStatus;
  lastError: ErrorRecord | null;
  channelErrors: Map<string, ErrorRecord>;
  /** Present while active: handlers registered by this activation and its cleanup. */
  active: { handlers: Map<ModuleEventName, Set<Listener>>; cleanup?: Cleanup } | null;
  /** Serialises setup/cleanup for this Module. */
  lock: Promise<unknown>;
}

export function createModuleRuntime(options: ModuleRuntimeOptions): ModuleRuntime {
  const { modules, store, events, channels, logger } = options;
  const sink = options.activity ?? noopActivitySink;
  const log = logger.child({ component: 'modules' });
  const states = new Map<string, ModuleState>();
  for (const module of modules) {
    if (states.has(module.id)) throw new Error(`duplicate Module id: ${module.id}`);
    states.set(module.id, {
      module,
      status: { level: 'ok' },
      lastError: null,
      channelErrors: new Map(),
      active: null,
      lock: Promise.resolve(),
    });
  }
  const sourceListeners = new Map<ModuleEventName, Listener>();
  const inFlight = new Set<Promise<unknown>>();

  function track<T>(promise: Promise<T>): Promise<T> {
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise)).catch(() => {});
    return promise;
  }

  function stateOf(id: string): ModuleState {
    const state = states.get(id);
    if (!state) throw new Error(`unknown Module: ${id}`);
    return state;
  }

  function writeActivity(entry: ActivityEntryInput) {
    try {
      sink.write(entry);
    } catch (err) {
      log.error({ err, moduleId: entry.moduleId }, 'failed to write Activity entry');
    }
  }

  /** Where an Activity entry belongs: a thread resolves to its parent channel, plus the guild. */
  function placeOf(channelId: string | undefined): { channelId?: string; guildId?: string } {
    if (!channelId) return {};
    const resolved = channels.resolve(channelId);
    return { channelId: resolved.channelId, ...(resolved.guildId ? { guildId: resolved.guildId } : {}) };
  }

  function setStatus(state: ModuleState, level: StatusLevel, message: string | undefined, announce: boolean) {
    const previous = state.status;
    const next: ModuleStatus = message === undefined ? { level } : { level, message };
    state.status = next;
    if (previous.level === next.level && previous.message === next.message) return;
    options.onStatusChange?.(state.module.id, next);
    if (announce && level !== 'ok' && previous.level !== level) {
      writeActivity({
        moduleId: state.module.id,
        level: level === 'error' ? 'error' : 'warn',
        message: `status ${level}${message ? `: ${message}` : ''}`,
      });
    }
  }

  function recordError(state: ModuleState, err: unknown, where: string, channelId?: string) {
    const message = errorMessage(err);
    const record: ErrorRecord = { message, at: new Date(), ...(channelId ? { channelId } : {}) };
    const place = placeOf(channelId);
    state.lastError = record;
    // Keyed by the parent channel, so a thread's error shows on its channel's page.
    if (place.channelId) state.channelErrors.set(place.channelId, record);
    log.error({ err, moduleId: state.module.id, channelId }, `Module ${where} failed`);
    setStatus(state, 'error', message, false);
    writeActivity({
      moduleId: state.module.id,
      ...place,
      level: 'error',
      message: `${where} failed: ${message}`,
    });
  }

  function enabledIn(state: ModuleState, channelId: string): boolean {
    const parent = channels.resolve(channelId).channelId;
    return isEnabled({
      global: store.readGlobal(state.module).enabled,
      channel: store.readChannel(state.module, parent).enabled,
      channelDefault: state.module.channelDefault,
    });
  }

  async function dispatch<E extends ModuleEventName>(event: E, args: ModuleEvents[E]): Promise<void> {
    const channelId = (EVENT_CHANNEL[event] as (...a: ModuleEvents[E]) => string | null)(...args);
    if (!channelId) return;
    const runs: Promise<void>[] = [];
    for (const state of states.values()) {
      const handlers = state.active?.handlers.get(event);
      if (!handlers?.size) continue;
      let enabled: boolean;
      try {
        enabled = enabledIn(state, channelId);
      } catch (err) {
        log.error({ err, moduleId: state.module.id }, 'enablement check failed');
        continue;
      }
      if (!enabled) continue;
      for (const handler of handlers) {
        runs.push(
          (async () => {
            try {
              await handler(...args);
            } catch (err) {
              recordError(state, err, `${event} handler`, channelId);
            }
          })(),
        );
      }
    }
    await Promise.all(runs);
  }

  /** Attach or detach the source listener for an event to match current handlers. */
  function syncSubscription(event: ModuleEventName) {
    const wanted = [...states.values()].some((s) => (s.active?.handlers.get(event)?.size ?? 0) > 0);
    const current = sourceListeners.get(event);
    if (wanted && !current) {
      const listener: Listener = (...args) => void track(dispatch(event, args as ModuleEvents[typeof event]));
      sourceListeners.set(event, listener);
      events.on(event, listener);
    } else if (!wanted && current) {
      sourceListeners.delete(event);
      events.off(event, current);
    }
  }

  function makeContext(state: ModuleState, activation: NonNullable<ModuleState['active']>): ModuleContext {
    const { module } = state;
    return {
      on(event, handler) {
        if (state.active !== activation) return;
        let set = activation.handlers.get(event);
        if (!set) activation.handlers.set(event, (set = new Set()));
        set.add(handler as Listener);
        syncSubscription(event);
      },
      config(channelId) {
        const parent = channels.resolve(channelId).channelId;
        return { global: store.readGlobal(module).config, channel: store.readChannel(module, parent).config };
      },
      globalConfig() {
        return store.readGlobal(module).config;
      },
      setStatus(level, message) {
        setStatus(state, level, message, true);
      },
      log: logger.child({ module: module.id }),
      activity(entry) {
        writeActivity({ moduleId: module.id, ...entry, ...placeOf(entry.channelId) });
      },
    };
  }

  function withLock<T>(state: ModuleState, fn: () => Promise<T>): Promise<T> {
    const run = state.lock.then(fn, fn);
    state.lock = run.catch(() => {});
    return track(run);
  }

  function deactivateHandlers(state: ModuleState) {
    const activation = state.active;
    state.active = null;
    for (const event of activation?.handlers.keys() ?? []) syncSubscription(event);
    return activation;
  }

  async function activate(state: ModuleState): Promise<void> {
    if (state.active) return;
    const activation: NonNullable<ModuleState['active']> = { handlers: new Map() };
    state.active = activation;
    setStatus(state, 'ok', undefined, false);
    try {
      const cleanup = await state.module.setup(makeContext(state, activation) as never);
      if (typeof cleanup === 'function') activation.cleanup = cleanup;
      log.info({ moduleId: state.module.id }, 'Module set up');
    } catch (err) {
      if (state.active === activation) deactivateHandlers(state);
      recordError(state, err, 'setup');
    }
  }

  async function deactivate(state: ModuleState): Promise<void> {
    const activation = deactivateHandlers(state);
    if (!activation?.cleanup) return;
    try {
      await activation.cleanup();
    } catch (err) {
      recordError(state, err, 'cleanup');
    }
  }

  return {
    modules,
    module: (id) => stateOf(id).module,

    async start() {
      await Promise.all(
        [...states.values()].map((state) =>
          withLock(state, async () => {
            if (store.readGlobal(state.module).enabled === true) await activate(state);
          }),
        ),
      );
    },

    async stop() {
      await Promise.all([...states.values()].map((state) => withLock(state, () => deactivate(state))));
    },

    async setModuleGlobalEnabled(id, on, actor) {
      const state = stateOf(id);
      return withLock(state, async () => {
        store.setGlobalEnabled(id, on, actor);
        writeActivity({ moduleId: id, level: 'info', message: `switched ${on ? 'on' : 'off'} globally`, actor });
        if (on) await activate(state);
        else await deactivate(state);
        return state.status;
      });
    },

    setModuleChannelEnabled(id, channel, on, actor) {
      stateOf(id);
      store.setChannelEnabled(id, channel, on, actor);
      writeActivity({
        moduleId: id,
        guildId: channel.guildId,
        channelId: channel.channelId,
        level: 'info',
        message: on === null ? 'channel switch reset to default' : `switched ${on ? 'on' : 'off'} in channel`,
        actor,
      });
    },

    updateGlobalConfig(id, input, actor) {
      const { module } = stateOf(id);
      store.writeGlobalConfig(module, input, actor);
      writeActivity({ moduleId: id, level: 'info', message: 'Global config edited', actor });
    },

    updateChannelConfig(id, channel, input, actor) {
      const { module } = stateOf(id);
      store.writeChannelConfig(module, channel, input, actor);
      writeActivity({
        moduleId: id,
        guildId: channel.guildId,
        channelId: channel.channelId,
        level: 'info',
        message: 'Channel config edited',
        actor,
      });
    },

    isEnabledIn: (id, channelId) => enabledIn(stateOf(id), channelId),
    isActive: (id) => stateOf(id).active !== null,
    status: (id) => stateOf(id).status,
    lastError: (id) => stateOf(id).lastError,
    lastErrorIn: (id, channelId) => stateOf(id).channelErrors.get(channelId) ?? null,

    async settled() {
      while (inFlight.size) await Promise.allSettled([...inFlight]);
    },
  };
}
