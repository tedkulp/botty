import { describe, expect, it } from 'vitest';
import { FakeKarakeepClient } from './fake-karakeep.js';
import { KarakeepError } from './karakeep.js';

describe('FakeKarakeepClient', () => {
  it('creates a bookmark once per exact URL and reports existing ones', async () => {
    const kk = new FakeKarakeepClient();

    const first = await kk.createBookmark('https://x.com/a', 'note');
    const again = await kk.createBookmark('https://x.com/a');
    const slash = await kk.createBookmark('https://x.com/a/');

    expect(first.created).toBe(true);
    expect(again).toEqual({ bookmarkId: first.bookmarkId, created: false });
    expect(slash.created).toBe(true);
    expect(slash.bookmarkId).not.toBe(first.bookmarkId);
    expect(kk.bookmarks.get('https://x.com/a')).toMatchObject({ note: 'note' });
  });

  it('checkUrl finds stored bookmarks by exact URL', async () => {
    const kk = new FakeKarakeepClient();
    const { bookmarkId } = await kk.createBookmark('https://x.com/a');

    await expect(kk.checkUrl('https://x.com/a')).resolves.toEqual({ bookmarkId });
    await expect(kk.checkUrl('https://x.com/b')).resolves.toBeNull();
  });

  it('records tags and list membership', async () => {
    const kk = new FakeKarakeepClient();
    const { bookmarkId } = await kk.createBookmark('https://x.com/a');

    await kk.attachTags(bookmarkId, ['discord', 'links']);
    await kk.attachTags(bookmarkId, ['discord']);
    await kk.addToList('list_1', bookmarkId);
    await kk.addToList('list_1', bookmarkId);

    expect(kk.bookmarks.get('https://x.com/a')?.tags).toEqual(['discord', 'links']);
    expect(kk.lists.get('list_1')).toEqual(new Set([bookmarkId]));
  });

  it('can be scripted to fail the next call to a method, then recovers', async () => {
    const kk = new FakeKarakeepClient();
    kk.failNext('createBookmark', new KarakeepError({ kind: 'retryable', status: 429, body: 'slow down', message: 'rate limited' }));

    await expect(kk.createBookmark('https://x.com/a')).rejects.toMatchObject({ kind: 'retryable', status: 429 });
    await expect(kk.createBookmark('https://x.com/a')).resolves.toMatchObject({ created: true });
  });

  it('accepts an error kind shorthand and queues multiple failures', async () => {
    const kk = new FakeKarakeepClient();
    kk.failNext('addToList', 'client').failNext('addToList', 'auth');

    await expect(kk.addToList('l', 'b')).rejects.toMatchObject({ kind: 'client' });
    await expect(kk.addToList('l', 'b')).rejects.toMatchObject({ kind: 'auth' });
    await expect(kk.addToList('l', 'b')).resolves.toBeUndefined();
  });

  it('records every call in order', async () => {
    const kk = new FakeKarakeepClient();
    const { bookmarkId } = await kk.createBookmark('https://x.com/a');
    await kk.addToList('list_1', bookmarkId);

    expect(kk.calls.map((c) => c.method)).toEqual(['createBookmark', 'addToList']);
  });
});
