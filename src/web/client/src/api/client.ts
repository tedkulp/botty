import { hc, type InferResponseType } from 'hono/client';
import type { App } from '../../../server/app.js';
import type { FieldError } from '../forms/fields.js';

// The typed client for the dashboard API. Every screen goes through `Api`, so
// tests can point it at the real Hono app with a swapped `fetch`.

type Rpc = ReturnType<typeof hc<App>>;
type ModuleRoute = Rpc['api']['modules'][':id'];
type GuildRoute = Rpc['api']['guilds'][':id'];
type ChannelModuleRoute = Rpc['api']['channels'][':id']['modules'][':moduleId'];

export type Admin = NonNullable<InferResponseType<Rpc['api']['me']['$get']>['admin']>;
export type DiscordState = InferResponseType<Rpc['api']['status']['$get'], 200>['discord'];
export type ModuleSummary = InferResponseType<Rpc['api']['modules']['$get'], 200>['modules'][number];
export type ModuleDetail = InferResponseType<ModuleRoute['$get'], 200>;
export type ToggleResult = InferResponseType<ModuleRoute['enabled']['$post'], 200>;
export type ModuleStatus = ModuleSummary['status'];
export type BotStatus = InferResponseType<Rpc['api']['status']['$get'], 200>;
export type GuildList = InferResponseType<Rpc['api']['guilds']['$get'], 200>;
export type Guild = Extract<GuildList, { available: true }>['guilds'][number];
export type ChannelTree = InferResponseType<GuildRoute['channels']['$get'], 200>;
export type ChannelCategory = Extract<ChannelTree, { available: true }>['categories'][number];
export type ChannelNode = ChannelCategory['channels'][number];
export type GuildOverview = InferResponseType<GuildRoute['overview']['$get'], 200>;
export type ChannelModules = InferResponseType<Rpc['api']['channels'][':id']['modules']['$get'], 200>;
export type ChannelModule = Extract<ChannelModules, { available: true }>['modules'][number];
export type ActivityPage = InferResponseType<ModuleRoute['activity']['$get'], 200>;
export type ActivityItem = ActivityPage['entries'][number];

/** Filters and paging for a Module's Activity feed. */
export interface ActivityFilter {
  guildId?: string;
  channelId?: string;
  limit?: number;
  /** `nextBefore` of the previous page. */
  before?: number;
}
export type OrphanList = InferResponseType<Rpc['api']['orphans']['$get'], 200>;
export type Orphan = Extract<OrphanList, { available: true }>['orphans'][number];

export type SaveConfigResult = { ok: true; module: ModuleDetail } | { ok: false; fieldErrors: FieldError[] };
export type SaveChannelConfigResult = { ok: true; module: ChannelModule } | { ok: false; fieldErrors: FieldError[] };

/** A response the screen can't do anything sensible with. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  /** Defaults to the browser's `fetch`. */
  fetch?: typeof fetch;
  /** Called on any 401 (session gone or expired). Defaults to sending the browser to sign in. */
  onUnauthorized?: () => void;
}

export function loginUrl(returnTo = window.location.pathname + window.location.search): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function createApi(options: ApiOptions = {}) {
  const onUnauthorized = options.onUnauthorized ?? (() => window.location.assign(loginUrl()));
  const rpc = hc<App>(typeof window === 'undefined' ? 'http://localhost' : window.location.origin, {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    init: { credentials: 'same-origin' },
  });

  /** Throws on anything but `expected`; a 401 also triggers `onUnauthorized`. */
  function check(res: Response, ...expected: number[]): void {
    if (expected.includes(res.status)) return;
    if (res.status === 401) onUnauthorized();
    throw new ApiError(res.status, `${res.url || 'request'} failed: ${res.status}`);
  }

  return {
    /** Send the browser to sign in (the same as any 401 does). */
    signIn: onUnauthorized,

    /** The signed-in Admin, or null (does not trigger `onUnauthorized`). */
    async me(): Promise<Admin | null> {
      const res = await rpc.api.me.$get();
      check(res, 200);
      return (await res.json()).admin;
    },

    async discordStatus(): Promise<DiscordState> {
      const res = await rpc.api.status.$get();
      check(res, 200);
      return (await res.json()).discord;
    },

    /** Discord's connection state and the bot's invite URL (null before login). */
    async status(): Promise<BotStatus> {
      const res = await rpc.api.status.$get();
      check(res, 200);
      return await res.json();
    },

    async listModules(): Promise<ModuleSummary[]> {
      const res = await rpc.api.modules.$get();
      check(res, 200);
      return (await res.json()).modules;
    },

    async getModule(id: string): Promise<ModuleDetail> {
      const res = await rpc.api.modules[':id'].$get({ param: { id } });
      check(res, 200);
      return (await res.json()) as ModuleDetail;
    },

    /** Save Global config. A 400 comes back as field errors, not an exception. */
    async saveGlobalConfig(id: string, config: Record<string, unknown>): Promise<SaveConfigResult> {
      const res = await rpc.api.modules[':id'].config.$put({ param: { id }, json: config });
      if (res.status === 400) {
        const body = (await res.json()) as { fieldErrors: FieldError[] };
        return { ok: false, fieldErrors: body.fieldErrors };
      }
      check(res, 200);
      return { ok: true, module: (await res.json()) as ModuleDetail };
    },

    /** Switch a Module on or off globally; resolves after setup/cleanup with the resulting status. */
    async setGlobalEnabled(id: string, on: boolean): Promise<ToggleResult> {
      const res = await rpc.api.modules[':id'].enabled.$post({ param: { id }, json: { on } });
      check(res, 200);
      return (await res.json()) as ToggleResult;
    },

    /** Guilds from the bot's cache; `{ available: false }` while Discord is down. */
    async listGuilds(): Promise<GuildList> {
      const res = await rpc.api.guilds.$get();
      check(res, 200);
      return await res.json();
    },

    /** A guild's channel tree. A guild not in the cache is an ApiError 404. */
    async guildChannels(id: string): Promise<ChannelTree> {
      const res = await rpc.api.guilds[':id'].channels.$get({ param: { id } });
      check(res, 200);
      return (await res.json()) as ChannelTree;
    },

    async guildOverview(id: string): Promise<GuildOverview> {
      const res = await rpc.api.guilds[':id'].overview.$get({ param: { id } });
      check(res, 200);
      return (await res.json()) as GuildOverview;
    },

    /** One row per Module for a channel pane. */
    async channelModules(id: string): Promise<ChannelModules> {
      const res = await rpc.api.channels[':id'].modules.$get({ param: { id } });
      check(res, 200);
      return (await res.json()) as ChannelModules;
    },

    async setChannelEnabled(channelId: string, moduleId: string, on: boolean): Promise<ChannelModule> {
      const route: ChannelModuleRoute = rpc.api.channels[':id'].modules[':moduleId'];
      const res = await route.enabled.$post({ param: { id: channelId, moduleId }, json: { on } });
      check(res, 200);
      return (await res.json()) as ChannelModule;
    },

    /** Save Channel config. A 400 with field errors comes back as `{ ok: false }`. */
    async saveChannelConfig(
      channelId: string,
      moduleId: string,
      config: Record<string, unknown>,
    ): Promise<SaveChannelConfigResult> {
      const route: ChannelModuleRoute = rpc.api.channels[':id'].modules[':moduleId'];
      const res = await route.config.$put({ param: { id: channelId, moduleId }, json: config });
      if (res.status === 400) {
        const body = (await res.json()) as { fieldErrors?: FieldError[]; error?: string };
        if (body.fieldErrors) return { ok: false, fieldErrors: body.fieldErrors };
      }
      check(res, 200);
      return { ok: true, module: (await res.json()) as ChannelModule };
    },

    /** A Module's Activity entries, newest first; `nextBefore` is null on the last page. */
    async listActivity(moduleId: string, filter: ActivityFilter = {}): Promise<ActivityPage> {
      const query: Record<string, string> = {};
      for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== '') query[key] = String(value);
      const res = await rpc.api.modules[':id'].activity.$get({ param: { id: moduleId }, query });
      check(res, 200);
      return (await res.json()) as ActivityPage;
    },

    async listOrphans(): Promise<OrphanList> {
      const res = await rpc.api.orphans.$get();
      check(res, 200);
      return await res.json();
    },

    async deleteOrphan(moduleId: string, channelId: string): Promise<void> {
      const res = await rpc.api.orphans[':moduleId'][':channelId'].$delete({ param: { moduleId, channelId } });
      check(res, 200);
    },
  };
}

export type Api = ReturnType<typeof createApi>;
