# Karakeep API: bookmarks, tags, and lists

Research for [#2](https://github.com/tedkulp/botty/issues/2). Answers how the link-collector Module saves a link into Karakeep, tags it, and files it in a list.

Sources (read 2026-10-26):

- **Spec**: the OpenAPI spec in the karakeep repo, `packages/open-api/karakeep-openapi-spec.json`, commit [`ba2acc3`](https://github.com/karakeep-app/karakeep/tree/ba2acc3cb9f89973df0ed74a3c6b0681c910503a). Rendered at <https://docs.karakeep.com/api/karakeep-api>.
- **Server**: the source at the same commit (`packages/api` is the Hono REST layer, `packages/trpc` holds the logic).
- **SDK**: [`@karakeep/sdk`](https://www.npmjs.com/package/@karakeep/sdk) 0.34.0 on npm (published 2026-10-17), source in `packages/sdk`.

## TL;DR flow for one Discord link

1. `POST /api/v1/bookmarks` with `{ "type": "link", "url": "<url>" }`. You get `201` for a new bookmark, or `200` with the existing bookmark if the URL is already saved.
2. `POST /api/v1/bookmarks/{id}/tags` with `{ "tags": [{ "tagName": "discord" }, ...] }`. A tag name that doesn't exist yet gets created.
3. `PUT /api/v1/lists/{listId}/bookmarks/{id}`. This is idempotent and returns `204`.

That's three calls. Creating a bookmark can't attach tags or add it to a list in the same request: neither field is in the create body.

## Auth

- Every endpoint needs `Authorization: Bearer <api key>`. You create keys in the web UI under **Settings > API Keys** (spec `info.description`, `components.securitySchemes.bearerAuth`).
- Base URL: `{address}/api/v1`, for example `https://karakeep.example.com/api/v1` (spec `servers`).
- **API keys can be scoped.** Scopes are `fullaccess` or `<resource>:read|readwrite` (`packages/shared/types/apiKeys.ts`). The tRPC procedures check them: a query needs `read` and a mutation needs `readwrite` (`createScopedAuthedProcedure`, `packages/trpc/index.ts:182`). If a scope is missing you get **403** with the message `API key is missing required scope: <scope>`. Botty needs `bookmarks:readwrite`, `tags:readwrite` and `lists:readwrite`, or `fullaccess`. Reading lists and tags for the dashboard pickers only needs `lists:read` and `tags:read`.
- A missing or invalid token gets **401** with the plain-text body `Unauthorized`.

## Official TS SDK: `@karakeep/sdk`

- It is a thin, typed wrapper over [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/): `createKarakeepClient = createClient<paths>` (`packages/sdk/src/index.ts`). The schema types are exported as `KarakeepAPISchemas`.
- Usage, from the SDK README:

  ```ts
  import { createKarakeepClient } from "@karakeep/sdk";
  const client = createKarakeepClient({
    baseUrl: `${addr}/api/v1/`,
    headers: { "Content-Type": "application/json", authorization: `Bearer ${apiKey}` },
  });
  const { data, error, response } = await client.POST("/bookmarks", {
    body: { type: "link", url },
  });
  ```

- Calls return `{ data, error, response }` and **don't throw on HTTP errors**. Check `response.status` to tell `200` (already existed) from `201` (created).
- Versioning: the SDK's minor version follows the server's minor version, and the API aims to stay backward compatible, so older SDKs keep working against newer servers (SDK README).
- License: **AGPL-3.0** (`packages/sdk/package.json`). Check this is acceptable before depending on it. You can also skip it and call `fetch` directly, since the API is small.

## Create a link bookmark: `POST /bookmarks`

- Body: `type: "link"` and `url` (format `uri`) are required. Optional fields: `title` (≤1000), `note`, `summary`, `archived`, `favourited`, `createdAt`, `crawlPriority` (`low|normal`) and `source`, which defaults to `"api"` (`packages/api/routes/bookmarks.ts:56-63`).
- Responses (spec): `201` created, `200` already existed (returns the existing bookmark), `400` validation error, `401`.
- Crawling happens in the background after the bookmark is created, and so does AI tagging if the server has it enabled. The response comes back before either finishes.

### Dedupe (same URL twice)

- The server dedupes per user by **exact string match** on the URL: `eq(bookmarkLinks.url, url) AND bookmarks.userId = me` (`attemptToDedupLink`, `packages/trpc/routers/bookmarks.ts:131`). It does no normalization, so `https://x.com/a` and `https://x.com/a/` are two separate bookmarks.
- The code says the check is not race-safe: "This doesn't 100% protect from duplicates because of races" (`bookmarks.ts:276`). If two Discord posts of the same URL arrive at the same moment, you can end up with two bookmarks.
- **Re-saving changes the existing bookmark** (`bookmarks.ts:286-330`):
  - `createdAt` is set to now, so the bookmark moves back to the top.
  - `archived` is set to `false`, so an archived bookmark comes back.
  - `title`, `note`, `favourited` and `summary` are overwritten only when the request sends them.
  - An `edited` webhook fires.
  - Exception: if `source` is `"rss"` or `"import"`, the existing bookmark is returned untouched (`RESAVE_EXEMPT_SOURCES`, `bookmarks.ts:212`).
- `GET /bookmarks/check-url?url=` returns `{ bookmarkId | null }`. It is a looser check: substring match, then a comparison that ignores the hash fragment and a trailing slash (spec). It's useful if botty wants to say "already saved" without bumping the bookmark.

## Tags: `POST /bookmarks/{bookmarkId}/tags`

- Body: `{ tags: [{ tagId?, tagName?, attachedBy?: "ai"|"human" (default human) }] }`. Each entry needs either a `tagId` or a `tagName`. **An unknown `tagName` is created automatically** (spec).
- Responses: `200 { attached: TagId[] }`, `401`, `404` if the bookmark doesn't exist.
- `GET /tags` (paginated, with `nameContains`, `sort` and `cursor`/`limit`) and `POST /tags` are there for the dashboard. Botty doesn't need them to tag a bookmark.

## Lists: `PUT /lists/{listId}/bookmarks/{bookmarkId}`

- Idempotent: adding a bookmark that's already in the list does nothing. Success is `204` (spec).
- Errors:
  - `404` if the list or bookmark isn't found.
  - **Smart lists** reject the call with tRPC `BAD_REQUEST` ("Smart lists cannot be added to", `packages/trpc/models/lists.ts:1105`), which comes back as HTTP 400. Only `manual` lists can be targets.
  - A list shared with you without edit rights fails in `ensureCanEdit()`.
- `GET /lists` returns every list (owned and shared) as `{ lists: List[] }`, with no pagination. It can fill a list picker in Module config. Store the list **id** in config, since names aren't unique and can change.
- `POST /lists` needs `name` (1-100 characters) and `icon`. `type` defaults to `manual`.

## Error responses

- The spec documents an `Error` schema `{ code, message }` for 400 and 404. In the server, though, tRPC errors are turned into Hono `HTTPException(status, { message })` (`packages/api/middlewares/trpcAdapter.ts`), and the API sets no custom `onError` (`packages/api/index.ts`). Hono's default turns an `HTTPException` into a **plain-text body containing the message**. Validation 400s come from `@hono/zod-validator`, which by default returns a JSON body describing the zod error.
- **Practical rule:** branch on the HTTP status and treat the body as an opaque message to log. Don't parse `{code, message}`. I didn't check this against a running instance.
- Status codes that matter to botty:

  | Status | Meaning |
  |---|---|
  | 200 / 201 | Already existed / created |
  | 204 | Added to list |
  | 400 | Bad URL, or a smart list as the target |
  | 401 | Bad key |
  | 403 | Key is missing a scope |
  | 404 | List or bookmark gone |
  | 429 | Rate limited |
  | 5xx | Server error; the message is masked to "Internal server error" in production |

## Rate limits

- **Off by default.** `RATE_LIMITING_ENABLED` defaults to `false` (`packages/shared/config.ts:224`; [env var docs](https://docs.karakeep.com/configuration/environment-variables)).
- When it's on, limits are per IP + user + procedure (`packages/trpc/lib/rateLimit.ts`). Creating bookmarks is capped at **30 per 60 s** (`bookmarks.ts:242-247`).
- Going over the limit returns **429** with the message `Rate limit exceeded. Try again in N seconds.` There's no `Retry-After` header; the number of seconds is only in the message text.
- One Discord message with many links could reach 30/min. Botty should handle 429 by backing off, using the N from the message if it's there.

## Implications for the link-collector Module and Module config

- Config should store: base URL, API key (scoped or full access), the target **list id** (manual lists only), and the tag names to attach.
- Treat a `200` from create as "already saved". Saving again bumps the bookmark to the top and unarchives it. That's probably fine. If it isn't wanted, call `check-url` first or send `source: "import"`, though the second option mislabels the source.
- The tag and list calls are safe to retry: attaching an existing tag (`onConflictDoNothing`, `bookmarks.ts:1427`) and the list PUT are both idempotent. The create call is not race-safe, so serialize saves of the same URL inside botty if that matters.
