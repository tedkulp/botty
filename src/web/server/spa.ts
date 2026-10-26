import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

/**
 * Where `vite build` puts the SPA (`dist/client`), resolved from this file's
 * location in `dist/web/server`. Undefined when it hasn't been built, e.g.
 * under `npm run dev`, where Vite's dev server serves the client instead.
 */
export function builtClientDir(): string | undefined {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../client');
  return existsSync(join(dir, 'index.html')) ? dir : undefined;
}

/** A request for something that looks like a file (has an extension), not a client-side route. */
function looksLikeFile(path: string): boolean {
  return /\.[^/]+$/.test(path);
}

/**
 * Serve the built SPA from `clientDir`. Files are served as-is; any other GET
 * that isn't a file gets `index.html` so client-side routes survive a reload.
 * Mount after `/api`, `/auth` and `/healthz`.
 */
export function spaRoutes(clientDir: string) {
  const index = serveStatic({ root: clientDir, path: 'index.html' });
  return new Hono()
    .use('*', serveStatic({ root: clientDir }))
    .use('*', async (c, next) => {
      if (c.req.method !== 'GET' || looksLikeFile(c.req.path)) return next();
      return index(c, next);
    });
}
