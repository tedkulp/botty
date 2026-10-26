/**
 * Karakeep REST client for the link-collector Module.
 *
 * Plain `fetch`, no `@karakeep/sdk` (AGPL-3.0). No retries: the Module owns
 * retry policy and branches on `KarakeepError.kind`.
 */

export interface KarakeepClient {
  /** GET /bookmarks/check-url. Loose match (ignores hash and trailing slash). */
  checkUrl(url: string): Promise<{ bookmarkId: string } | null>;
  /** POST /bookmarks {type:"link"}. 201 → created, 200 → already existed. */
  createBookmark(url: string, note?: string): Promise<{ bookmarkId: string; created: boolean }>;
  /** POST /bookmarks/{id}/tags. Unknown tag names are created by Karakeep. */
  attachTags(bookmarkId: string, tagNames: string[]): Promise<void>;
  /** PUT /lists/{listId}/bookmarks/{id}. Idempotent, 204. */
  addToList(listId: string, bookmarkId: string): Promise<void>;
}

export type KarakeepErrorKind = 'auth' | 'retryable' | 'client';

export class KarakeepError extends Error {
  readonly kind: KarakeepErrorKind;
  readonly status: number | undefined;
  /** Raw response body text (may be plain text, not JSON). Empty for network errors. */
  readonly body: string;

  constructor(opts: { kind: KarakeepErrorKind; status?: number; body: string; message: string; cause?: unknown }) {
    super(opts.message, { cause: opts.cause });
    this.name = 'KarakeepError';
    this.kind = opts.kind;
    this.status = opts.status;
    this.body = opts.body;
  }
}

export interface KarakeepClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

function kindForStatus(status: number): KarakeepErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || status >= 500) return 'retryable';
  return 'client';
}

export function createKarakeepClient(options: KarakeepClientOptions): KarakeepClient {
  const api = `${options.baseUrl.replace(/\/+$/, '')}/api/v1`;

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    const what = `${method} ${path}`;
    const headers: Record<string, string> = { authorization: `Bearer ${options.apiKey}` };
    if (body !== undefined) headers['content-type'] = 'application/json';

    let res: Response;
    try {
      // Resolve global fetch per call so interceptors installed later still apply.
      res = await (options.fetch ?? globalThis.fetch)(`${api}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new KarakeepError({
        kind: 'retryable',
        body: '',
        message: `Karakeep ${what} failed: network error`,
        cause,
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new KarakeepError({
        kind: kindForStatus(res.status),
        status: res.status,
        body: text,
        message: `Karakeep ${what} failed with ${res.status}`,
      });
    }
    return res;
  }

  return {
    async checkUrl(url) {
      const res = await request('GET', `/bookmarks/check-url?url=${encodeURIComponent(url)}`);
      const data = (await res.json()) as { bookmarkId: string | null };
      return data.bookmarkId ? { bookmarkId: data.bookmarkId } : null;
    },

    async createBookmark(url, note) {
      const body: Record<string, string> = { type: 'link', url };
      if (note !== undefined) body.note = note;
      const res = await request('POST', '/bookmarks', body);
      const data = (await res.json()) as { id: string };
      return { bookmarkId: data.id, created: res.status === 201 };
    },

    async attachTags(bookmarkId, tagNames) {
      if (tagNames.length === 0) return;
      await request('POST', `/bookmarks/${encodeURIComponent(bookmarkId)}/tags`, {
        tags: tagNames.map((tagName) => ({ tagName })),
      });
    },

    async addToList(listId, bookmarkId) {
      await request(
        'PUT',
        `/lists/${encodeURIComponent(listId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
      );
    },
  };
}
