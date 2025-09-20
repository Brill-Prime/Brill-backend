
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: process.env.DATABASE_URL?.includes('render.com') || process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  },
  verbose: true,
  strict: true,
});
