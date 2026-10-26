import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/core/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: `${process.env.DATA_DIR ?? './data'}/botty.db`,
  },
});
