import { KarakeepError, type KarakeepClient, type KarakeepErrorKind } from './karakeep.js';

export interface FakeBookmark {
  id: string;
  url: string;
  note: string | undefined;
  tags: string[];
}

type Method = keyof KarakeepClient;

export interface FakeCall {
  method: Method;
  args: unknown[];
}

/**
 * In-memory KarakeepClient for Module unit tests.
 *
 * Stores bookmarks by exact URL (like Karakeep's create dedupe) and can be
 * scripted to fail with `failNext(method, error | kind)`. Every call, failed
 * or not, is recorded in `calls`.
 */
export class FakeKarakeepClient implements KarakeepClient {
  /** Bookmarks keyed by exact URL. */
  readonly bookmarks = new Map<string, FakeBookmark>();
  /** listId → bookmark ids. */
  readonly lists = new Map<string, Set<string>>();
  readonly calls: FakeCall[] = [];

  private nextId = 1;
  private readonly failures = new Map<Method, KarakeepError[]>();

  /** Queue a failure for the next call to `method`. Chainable; failures are consumed in order. */
  failNext(method: Method, error: KarakeepError | KarakeepErrorKind): this {
    const err =
      typeof error === 'string'
        ? new KarakeepError({ kind: error, body: '', message: `fake ${method} failure (${error})` })
        : error;
    const queue = this.failures.get(method) ?? [];
    queue.push(err);
    this.failures.set(method, queue);
    return this;
  }

  async checkUrl(url: string): Promise<{ bookmarkId: string } | null> {
    this.enter('checkUrl', [url]);
    const b = this.bookmarks.get(url);
    return b ? { bookmarkId: b.id } : null;
  }

  async createBookmark(url: string, note?: string): Promise<{ bookmarkId: string; created: boolean }> {
    this.enter('createBookmark', [url, note]);
    const existing = this.bookmarks.get(url);
    if (existing) {
      if (note !== undefined) existing.note = note;
      return { bookmarkId: existing.id, created: false };
    }
    const id = `bm_${this.nextId++}`;
    this.bookmarks.set(url, { id, url, note, tags: [] });
    return { bookmarkId: id, created: true };
  }

  async attachTags(bookmarkId: string, tagNames: string[]): Promise<void> {
    this.enter('attachTags', [bookmarkId, tagNames]);
    const b = this.byId(bookmarkId);
    for (const name of tagNames) if (!b.tags.includes(name)) b.tags.push(name);
  }

  async addToList(listId: string, bookmarkId: string): Promise<void> {
    this.enter('addToList', [listId, bookmarkId]);
    const set = this.lists.get(listId) ?? new Set<string>();
    set.add(bookmarkId);
    this.lists.set(listId, set);
  }

  private enter(method: Method, args: unknown[]): void {
    this.calls.push({ method, args });
    const err = this.failures.get(method)?.shift();
    if (err) throw err;
  }

  private byId(bookmarkId: string): FakeBookmark {
    for (const b of this.bookmarks.values()) if (b.id === bookmarkId) return b;
    throw new KarakeepError({ kind: 'client', status: 404, body: 'Bookmark not found', message: 'Bookmark not found' });
  }
}
