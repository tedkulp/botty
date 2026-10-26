// Test support for HTTP tests: build the app on `:memory:` SQLite with OIDC
// stubbed, and sign an Admin in through the real login/callback routes.
import { EventEmitter } from 'node:events';
import { openDatabase, runMigrations, type DatabaseHandle } from '../../core/db/index.js';
import type { DiscordStatusSource } from '../../core/discord.js';
import type { CachedChannel, CachedGuild, GuildCache } from '../../core/guild-cache.js';
import { createLogger } from '../../core/logger.js';
import {
  createConfigStore,
  createModuleRuntime,
  type ActivityEntryInput,
  type AnyModule,
  type ModuleRuntime,
} from '../../core/modules/index.js';
import { createApp, type App } from './app.js';
import type { OidcProvider, OidcTokens } from './auth/oidc.js';

export const TEST_SESSION_SECRET = 'test-session-secret-at-least-32-chars!!';
export const TEST_ADMIN_GROUP = 'admins';
export const TEST_ISSUER = 'https://id.example.test';

export interface TestAdmin {
  sub: string;
  name: string;
}

export const DEFAULT_ADMIN: TestAdmin = { sub: 'admin-sub', name: 'Ada Admin' };

/** A controllable stand-in for the identity provider. */
export interface StubOidc extends OidcProvider {
  /** What the next code exchange returns (or throws). */
  exchangeResult: OidcTokens | Error;
  /** What the next refresh returns (or throws). */
  refreshResult: OidcTokens | Error;
  /** null mimics a provider without `end_session_endpoint`. */
  endSessionEndpoint: string | null;
  refreshCalls: Array<{ refreshToken: string; sub: string }>;
}

export interface Clock {
  now(): Date;
  advance(ms: number): void;
}

export function createClock(start = new Date('2026-01-01T00:00:00Z')): Clock {
  let t = start.getTime();
  return { now: () => new Date(t), advance: (ms) => void (t += ms) };
}

export function adminTokens(clock: Clock, overrides: Partial<OidcTokens> = {}): OidcTokens {
  return {
    ...DEFAULT_ADMIN,
    groups: [TEST_ADMIN_GROUP],
    refreshToken: 'refresh-1',
    expiresAt: new Date(clock.now().getTime() + 60 * 60 * 1000),
    ...overrides,
  };
}

export function createStubOidc(clock: Clock): StubOidc {
  const stub: StubOidc = {
    exchangeResult: adminTokens(clock),
    refreshResult: new Error('refresh not configured'),
    endSessionEndpoint: `${TEST_ISSUER}/api/oidc/end-session`,
    refreshCalls: [],
    async beginLogin(redirectUri) {
      const state = 'test-state';
      const url = new URL(`${TEST_ISSUER}/authorize`);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      return { url, state, codeVerifier: 'test-verifier' };
    },
    async exchangeCode(callbackUrl, checks) {
      if (callbackUrl.searchParams.get('state') !== checks.state) throw new Error('state mismatch');
      if (stub.exchangeResult instanceof Error) throw stub.exchangeResult;
      return stub.exchangeResult;
    },
    async refresh(refreshToken, sub) {
      stub.refreshCalls.push({ refreshToken, sub });
      if (stub.refreshResult instanceof Error) throw stub.refreshResult;
      return stub.refreshResult;
    },
    async endSessionUrl(postLogoutRedirectUri) {
      if (!stub.endSessionEndpoint) return null;
      const url = new URL(stub.endSessionEndpoint);
      url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
      return url;
    },
  };
  return stub;
}

export interface TestAppOptions {
  publicUrl?: string;
  discord?: DiscordStatusSource;
  /** Modules the runtime knows about (default: none). Channels resolve to themselves in guild 'guild-1'. */
  modules?: readonly AnyModule[];
  /** Serve a built SPA from this directory. */
  clientDir?: string;
  /** The guild/channel cache (default: an empty fake). */
  guilds?: FakeGuildCache;
}

export interface TestApp {
  app: App;
  handle: DatabaseHandle;
  oidc: StubOidc;
  clock: Clock;
  /** The Module runtime behind the API (not started; switch Modules on through the API or the runtime). */
  runtime: ModuleRuntime;
  /** Activity entries the core wrote, in order. */
  activity: ActivityEntryInput[];
  /** The fake guild/channel cache behind the API; add guilds and channels to it. */
  guilds: FakeGuildCache;
  /**
   * Sign in through `/auth/login` + `/auth/callback` with the stub returning
   * `tokens` (an Admin by default). Returns the `Cookie` header to send.
   */
  signIn(tokens?: Partial<OidcTokens>): Promise<string>;
  close(): void;
}

/** Build the full app with a fresh migrated `:memory:` DB and stubbed OIDC. */
export function createTestApp(options: TestAppOptions = {}): TestApp {
  const handle = openDatabase(':memory:');
  runMigrations(handle);
  const clock = createClock();
  const oidc = createStubOidc(clock);
  const activity: ActivityEntryInput[] = [];
  const guilds = options.guilds ?? createFakeGuildCache();
  const runtime = createModuleRuntime({
    modules: options.modules ?? [],
    store: createConfigStore(handle.db),
    events: new EventEmitter(),
    // Threads resolve to their parent, as the discord.js resolver does; unknown channels to themselves in 'guild-1'.
    channels: {
      resolve: (channelId) => {
        const channel = guilds.channel(channelId);
        if (!channel) return { channelId, guildId: 'guild-1' };
        const id = channel.kind === 'thread' && channel.parentId ? channel.parentId : channelId;
        return { channelId: id, guildId: channel.guildId };
      },
    },
    logger: createLogger('silent'),
    activity: { write: (entry) => void activity.push(entry) },
  });
  const app = createApp({
    db: handle,
    modules: runtime,
    guilds,
    ...(options.clientDir ? { clientDir: options.clientDir } : {}),
    discord: options.discord ?? { state: () => 'ready' },
    auth: {
      oidc,
      publicUrl: options.publicUrl ?? 'http://localhost:3000',
      adminGroup: TEST_ADMIN_GROUP,
      sessionSecret: TEST_SESSION_SECRET,
      now: clock.now,
    },
  });

  async function signIn(tokens: Partial<OidcTokens> = {}): Promise<string> {
    oidc.exchangeResult = adminTokens(clock, tokens);
    const login = await app.request('/auth/login');
    const pkce = cookiePairs(login);
    const state = new URL(login.headers.get('location')!).searchParams.get('state');
    const callback = await app.request(`/auth/callback?code=test-code&state=${state}`, {
      headers: { Cookie: pkce },
    });
    if (callback.status !== 302) throw new Error(`sign-in failed: ${callback.status}`);
    return cookiePairs(callback, 'botty_session');
  }

  return {
    app,
    handle,
    oidc,
    clock,
    runtime,
    activity,
    guilds,
    signIn,
    close: () => {
      void runtime.stop();
      handle.close();
    },
  };
}

/** `name=value` pairs from a response's Set-Cookie headers, joined for a `Cookie` header. */
export function cookiePairs(res: Response, only?: string): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((pair) => !only || pair.startsWith(`${only}=`))
    .join('; ');
}

/** Permissions for a fake channel: has exactly the listed ones. */
export function grants(...names: string[]) {
  const set = new Set(names);
  return { has: (permission: string) => set.has(permission) };
}

/** Every permission a v1 Module asks for, so fake channels are viewable unless a test says otherwise. */
export const ALL_PERMISSIONS = grants('ViewChannel', 'ReadMessageHistory', 'AddReactions', 'SendMessages');

/** A mutable in-memory GuildCache for tests. */
export interface FakeGuildCache extends GuildCache {
  appId: string | null;
  addGuild(guild: Partial<CachedGuild> & { id: string }): CachedGuild;
  addChannel(channel: Partial<CachedChannel> & { id: string; guildId: string }): CachedChannel;
  removeGuild(id: string): void;
  removeChannel(id: string): void;
}

export function createFakeGuildCache(): FakeGuildCache {
  const guildMap = new Map<string, CachedGuild>();
  const channelMap = new Map<string, CachedChannel>();
  const fake: FakeGuildCache = {
    appId: 'app-1',
    applicationId: () => fake.appId,
    guilds: () => [...guildMap.values()],
    guild: (id) => guildMap.get(id) ?? null,
    channels: (guildId) => [...channelMap.values()].filter((c) => c.guildId === guildId),
    channel: (id) => channelMap.get(id) ?? null,
    addGuild(guild) {
      const full: CachedGuild = { name: `Guild ${guild.id}`, icon: null, ...guild };
      guildMap.set(full.id, full);
      return full;
    },
    addChannel(channel) {
      const full: CachedChannel = {
        name: channel.id,
        kind: 'text',
        parentId: null,
        position: 0,
        obfuscated: false,
        permissions: ALL_PERMISSIONS,
        ...channel,
      };
      channelMap.set(full.id, full);
      return full;
    },
    removeGuild(id) {
      guildMap.delete(id);
      for (const c of [...channelMap.values()]) if (c.guildId === id) channelMap.delete(c.id);
    },
    removeChannel: (id) => void channelMap.delete(id),
  };
  return fake;
}
