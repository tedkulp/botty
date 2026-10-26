import { Hono, type Context } from 'hono';
import { validator } from 'hono/validator';
import type { DiscordStatusSource } from '../../../core/discord.js';
import type { CachedChannel, GuildCache } from '../../../core/guild-cache.js';
import {
  ConfigValidationError,
  configJsonSchema,
  isEnabled,
  missingPermissions,
  redactSecrets,
  type AnyModule,
  type ConfigStore,
  type ModuleRuntime,
} from '../../../core/modules/index.js';
import type { AuthEnv } from '../auth/middleware.js';
import { isViewable } from './guilds.js';
import { errorJson, parseToggle, validationFailure, type ConfigInput } from './modules.js';

export interface ChannelsApiDeps {
  runtime: ModuleRuntime;
  store: ConfigStore;
  discord: DiscordStatusSource;
  guilds: GuildCache;
}

/** `/api/channels`: one channel's Module rows (switch, permissions, Channel config). */
export function channelsRoutes({ runtime, store, discord, guilds }: ChannelsApiDeps) {
  const ready = () => discord.state() === 'ready';

  /** One Module row for a channel pane. */
  function row(module: AnyModule, channel: CachedChannel) {
    const global = store.readGlobal(module).enabled;
    const stored = store.readChannel(module, channel.id);
    const channelEnabled = stored.enabled ?? module.channelDefault;
    return {
      id: module.id,
      name: module.name,
      /** The switch as shown: the stored channel value, or the Module's channelDefault. */
      channelEnabled,
      globalEnabled: global === true,
      /** Enabled (in a channel): both switches on. */
      enabled: isEnabled({ global, channel: stored.enabled, channelDefault: module.channelDefault }),
      status: runtime.status(module.id),
      lastError: errorJson(runtime.lastErrorIn(module.id, channel.id)),
      missingPermissions: missingPermissions(module, channel.permissions),
      schema: configJsonSchema(module.configSchema.channel),
      config: redactSecrets(module.configSchema.channel, stored.config as Record<string, unknown>),
      needsReview: stored.needsReview,
      updatedBy: stored.updatedBy,
      updatedAt: stored.updatedAt?.toISOString() ?? null,
    };
  }

  /** The channel and Module a write targets, or the error response. Threads follow their parent: 400. */
  function writeTarget(c: Context<AuthEnv>): { channel: CachedChannel; module: AnyModule } | Response {
    if (!ready()) return c.json({ error: 'Discord is unavailable' }, 503);
    const channel = guilds.channel(c.req.param('id')!);
    if (!channel) return c.json({ error: 'unknown channel' }, 404);
    if (channel.kind === 'thread') return c.json({ error: 'a thread follows its parent channel' }, 400);
    const module = runtime.modules.find((m) => m.id === c.req.param('moduleId'));
    if (!module) return c.json({ error: 'unknown Module' }, 404);
    return { channel, module };
  }

  return new Hono<AuthEnv>()
    .get('/:id/modules', (c) => {
      if (!ready()) return c.json({ available: false as const }, 200);
      const channel = guilds.channel(c.req.param('id'));
      if (!channel) return c.json({ error: 'unknown channel' }, 404);
      return c.json(
        {
          available: true as const,
          channel: { id: channel.id, name: channel.name, guildId: channel.guildId, viewable: isViewable(channel) },
          modules: runtime.modules.map((m) => row(m, channel)),
        },
        200,
      );
    })
    // The body is validated against the Module's zod schema by the runtime.
    .put('/:id/modules/:moduleId/config', validator('json', (value) => value as ConfigInput), (c) => {
      const target = writeTarget(c);
      if (target instanceof Response) return target;
      const { channel, module } = target;
      try {
        runtime.updateChannelConfig(module.id, ref(channel), c.req.valid('json'), c.var.admin!);
      } catch (err) {
        if (err instanceof ConfigValidationError) return c.json(validationFailure(err), 400);
        throw err;
      }
      return c.json(row(module, channel), 200);
    })
    .post('/:id/modules/:moduleId/enabled', validator('json', parseToggle), (c) => {
      const target = writeTarget(c);
      if (target instanceof Response) return target;
      const { channel, module } = target;
      runtime.setModuleChannelEnabled(module.id, ref(channel), c.req.valid('json').on, c.var.admin!);
      return c.json(row(module, channel), 200);
    });
}

function ref(channel: CachedChannel) {
  return { channelId: channel.id, guildId: channel.guildId };
}
