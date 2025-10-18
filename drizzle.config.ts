import type { Config } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Determine SSL settings. Many hosted Postgres providers require SSL/TLS.
const databaseUrl = process.env.DATABASE_URL!;

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
    ssl: 'require',
  },
  verbose: true,
  strict: true,
} satisfies Config;
