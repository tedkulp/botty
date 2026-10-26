import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dashboard SPA. `npm run dev:client` serves it with HMR and proxies
// /api and /auth to the bot process (`npm run dev`, on PORT or 3000).
// `npm run build` writes it to dist/client, which Hono serves in production.
const botOrigin = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

export default defineConfig({
  root: fileURLToPath(new URL('./src/web/client', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': botOrigin,
      '/auth': botOrigin,
    },
  },
});
