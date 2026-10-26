import type { Message } from 'discord.js';
import { z } from 'zod';
import { defineModule, type ModuleContext } from '../../core/modules/index.js';
import { createKarakeepClient, KarakeepError, type KarakeepClient } from './karakeep.js';
import { selectUrls } from './urls.js';

export const DEFAULT_IGNORED_DOMAINS = ['discord.com', 'cdn.discordapp.com', 'tenor.com', 'giphy.com'];

export const globalConfigSchema = z.object({
  karakeepUrl: z.string().optional().describe('Karakeep base URL, e.g. https://karakeep.example'),
  apiKey: z.string().optional().meta({ secret: true }).describe('Karakeep API key'),
  defaultTags: z.array(z.string()).default([]).describe('Tags added to every saved URL'),
  defaultListId: z.string().optional().describe('List used when the channel has none'),
  ignoredDomains: z
    .array(z.string())
    .default([...DEFAULT_IGNORED_DOMAINS])
    .describe('URLs on these hosts (and their subdomains) are never saved'),
});

export const channelConfigSchema = z.object({
  tags: z.array(z.string()).default([]).describe('Tags added to URLs saved from this channel'),
  listId: z.string().optional().describe('List for URLs saved from this channel'),
});

export type LinkCollectorGlobalConfig = z.output<typeof globalConfigSchema>;

/** Builds a Karakeep client from Global config at event time. */
export type KarakeepClientFactory = (config: { karakeepUrl: string; apiKey: string }) => KarakeepClient;

export interface LinkCollectorOptions {
  client?: KarakeepClientFactory;
  /** Waits between retries; injectable so tests run instantly. */
  sleep?: (ms: number) => Promise<void>;
}

/** Delays before each of the 3 retries of a retryable Karakeep error (~60 s in total). */
export const RETRY_DELAYS_MS = [5_000, 15_000, 40_000] as const;

export const MAX_URLS = 20;

const defaultClient: KarakeepClientFactory = ({ karakeepUrl, apiKey }) =>
  createKarakeepClient({ baseUrl: karakeepUrl, apiKey });

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Ctx = ModuleContext<typeof globalConfigSchema, typeof channelConfigSchema>;

/** What happened to one URL. */
type UrlOutcome =
  | { url: string; saved: true; bookmarkId: string; created: boolean; problem?: string }
  | { url: string; saved: false; reason: string; auth: boolean };

export function createLinkCollector(options: LinkCollectorOptions = {}) {
  const makeClient = options.client ?? defaultClient;
  const sleep = options.sleep ?? defaultSleep;

  async function handle(ctx: Ctx, message: Message): Promise<void> {
    if (message.author.bot || message.webhookId) return;

    const { global, channel } = ctx.config(message.channelId);
    if (!global.karakeepUrl || !global.apiKey) {
      ctx.setStatus('error', 'not configured');
      return;
    }

    const texts = [message.content, ...[...message.messageSnapshots.values()].map((s) => s.content ?? '')];
    const { urls, skipped } = selectUrls({ texts, ignoredDomains: global.ignoredDomains, max: MAX_URLS });
    if (urls.length === 0) return;

    const client = makeClient({ karakeepUrl: global.karakeepUrl, apiKey: global.apiKey });
    const tags = [...new Set([...global.defaultTags, ...channel.tags])];
    // `||`: a blank listId (e.g. a cleared form field) falls back too.
    const listId = channel.listId || global.defaultListId;
    const author = message.member?.displayName ?? message.author.displayName;
    const note = `Shared by ${author} in #${channelName(message)} (${message.guild?.name ?? 'DM'}): ${message.url}`;

    /** Run one Karakeep call, retrying `retryable` errors with backoff. */
    async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fn();
        } catch (err) {
          const delay = RETRY_DELAYS_MS[attempt];
          if (!(err instanceof KarakeepError) || err.kind !== 'retryable' || delay === undefined) throw err;
          ctx.log.warn({ status: err.status, body: err.body, attempt: attempt + 1 }, `Karakeep ${what} failed; retrying`);
          await sleep(delay);
        }
      }
    }

    async function save(url: string): Promise<UrlOutcome> {
      let bookmarkId: string;
      let created: boolean;
      try {
        const existing = await withRetry('check-url', () => client.checkUrl(url));
        if (existing) {
          bookmarkId = existing.bookmarkId;
          created = false;
        } else {
          ({ bookmarkId, created } = await withRetry('create bookmark', () => client.createBookmark(url, note)));
        }
      } catch (err) {
        return failed(ctx, url, err);
      }

      // The bookmark exists now: tag or list failures leave it saved but degrade the Module,
      // except auth errors, which fail the URL like any other call.
      const problems: string[] = [];
      try {
        if (tags.length) await withRetry('attach tags', () => client.attachTags(bookmarkId, tags));
      } catch (err) {
        if (isAuth(err)) return failed(ctx, url, err);
        problems.push(`tagging ${bookmarkId} failed: ${reasonOf(err)}`);
      }
      try {
        if (listId) await withRetry('add to list', () => client.addToList(listId, bookmarkId));
      } catch (err) {
        if (isAuth(err)) return failed(ctx, url, err);
        problems.push(`adding ${bookmarkId} to list ${listId} failed: ${reasonOf(err)}`);
      }
      return { url, saved: true, bookmarkId, created, ...(problems.length ? { problem: problems.join('; ') } : {}) };
    }

    const outcomes: UrlOutcome[] = [];
    for (const url of urls) {
      const outcome = await save(url);
      outcomes.push(outcome);
      // A rejected API key fails every remaining call too; don't hammer Karakeep with them.
      if (!outcome.saved && outcome.auth) {
        for (const rest of urls.slice(outcomes.length))
          outcomes.push({ url: rest, saved: false, reason: 'not attempted after auth failure', auth: true });
        break;
      }
    }

    const failures = outcomes.filter((o) => !o.saved);
    const problems = outcomes.flatMap((o) => (o.saved && o.problem ? [o.problem] : []));
    const authFailure = failures.find((o) => o.auth);
    if (authFailure) ctx.setStatus('error', authFailure.reason);
    else if (failures[0]) ctx.setStatus('degraded', `${failures[0].url}: ${failures[0].reason}`);
    else if (problems[0]) ctx.setStatus('degraded', problems[0]);
    else ctx.setStatus('ok');

    await react(ctx, message, failures.length ? '❌' : '✅');
    if (skipped > 0) await react(ctx, message, '⚠️');

    const parts = [`${author}: ${outcomes.map(describe).join(', ')}`];
    if (skipped > 0) parts.push(`${skipped} URL(s) over the cap of ${MAX_URLS} skipped`);
    ctx.activity({
      channelId: message.channelId,
      level: failures.length ? 'error' : problems.length || skipped > 0 ? 'warn' : 'info',
      message: parts.join('; '),
      link: message.url,
    });
  }

  return defineModule({
    id: 'link-collector',
    name: 'Link collector',
    channelDefault: false,
    permissions: ['ViewChannel', 'ReadMessageHistory', 'AddReactions'],
    configSchema: { global: globalConfigSchema, channel: channelConfigSchema },
    setup(ctx) {
      ctx.on('messageCreate', (message) => handle(ctx, message));
    },
  });
}

function channelName(message: Message): string {
  const channel = message.channel as { name?: string | null };
  return channel.name ?? message.channelId;
}

function describe(outcome: UrlOutcome): string {
  if (!outcome.saved) return `${outcome.url} failed (${outcome.reason})`;
  const saved = `saved ${outcome.bookmarkId} ${outcome.created ? 'new' : 'existing'} (${outcome.url})`;
  return outcome.problem ? `${saved}, but ${outcome.problem}` : saved;
}

function isAuth(err: unknown): boolean {
  return err instanceof KarakeepError && err.kind === 'auth';
}

/** Short, status-code-led reason for status and Activity. The raw body goes to the log only. */
function reasonOf(err: unknown): string {
  if (!(err instanceof KarakeepError)) return err instanceof Error ? err.message : String(err);
  const code = err.status === undefined ? 'network error' : String(err.status);
  if (err.kind === 'auth') return `Karakeep rejected the API key (${code})`;
  if (err.kind === 'retryable') return `Karakeep unavailable (${code}) after ${RETRY_DELAYS_MS.length} retries`;
  return `Karakeep error (${code})`;
}

function failed(ctx: Ctx, url: string, err: unknown): UrlOutcome {
  const body = err instanceof KarakeepError ? err.body : undefined;
  ctx.log.warn({ err, url, body }, 'saving URL to Karakeep failed');
  return { url, saved: false, reason: reasonOf(err), auth: isAuth(err) };
}

async function react(ctx: Ctx, message: Message, emoji: string): Promise<void> {
  try {
    await message.react(emoji);
  } catch (err) {
    ctx.log.warn({ err, messageId: message.id }, `could not react ${emoji}`);
  }
}

export const linkCollector = createLinkCollector();
