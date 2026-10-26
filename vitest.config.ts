import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          include: ['src/**/*.test.ts'],
          exclude: ['src/web/client/**'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'client',
          include: ['src/web/client/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['src/web/client/src/test-setup.ts'],
        },
      },
    ],
  },
});
