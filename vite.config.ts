import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The dashboard SPA. `npm run dev:client` serves it with HMR and proxies
// /api and /auth to the bot process (`npm run dev`, on PORT or 3000).
// `npm run build` writes it to dist/client, which Hono serves in production.
// PORT and DEV_ALLOWED_HOSTS (comma-separated extra hostnames for the dev
// server) are read from the repo's .env, like `npm run dev` does.
const repoDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repoDir, ''), ...process.env };
  const botOrigin = `http://127.0.0.1:${env.PORT ?? 3000}`;
  const extraHosts = (env.DEV_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    root: fileURLToPath(new URL('./src/web/client', import.meta.url)),
    plugins: [react()],
    build: {
      outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
      emptyOutDir: true,
    },
    server: {
      allowedHosts: ['localhost', ...extraHosts],
      proxy: {
        '/api': botOrigin,
        '/auth': botOrigin,
      },
    },
  };
});
