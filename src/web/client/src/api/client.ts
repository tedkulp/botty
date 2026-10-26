import { hc, type InferResponseType } from 'hono/client';
import type { App } from '../../../server/app.js';
import type { FieldError } from '../forms/fields.js';

// The typed client for the dashboard API. Every screen goes through `Api`, so
// tests can point it at the real Hono app with a swapped `fetch`.

type Rpc = ReturnType<typeof hc<App>>;
type ModuleRoute = Rpc['api']['modules'][':id'];

export type Admin = NonNullable<InferResponseType<Rpc['api']['me']['$get']>['admin']>;
export type DiscordState = InferResponseType<Rpc['api']['status']['$get'], 200>['discord'];
export type ModuleSummary = InferResponseType<Rpc['api']['modules']['$get'], 200>['modules'][number];
export type ModuleDetail = InferResponseType<ModuleRoute['$get'], 200>;
export type ToggleResult = InferResponseType<ModuleRoute['enabled']['$post'], 200>;
export type ModuleStatus = ModuleSummary['status'];

export type SaveConfigResult = { ok: true; module: ModuleDetail } | { ok: false; fieldErrors: FieldError[] };

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
  };
}

export type Api = ReturnType<typeof createApi>;
