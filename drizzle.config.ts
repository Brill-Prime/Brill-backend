import type { Config } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Determine SSL settings. Many hosted Postgres providers require SSL/TLS.
// Allow override via PGSSLMODE or NODE_ENV=production. Also detect common
// ssl parameters in the DATABASE_URL itself (e.g. "ssl=true" or "sslmode=require").
const databaseUrl = process.env.DATABASE_URL!;
const pgSslMode = (process.env.PGSSLMODE || '').toLowerCase();
const shouldUseSsl =
  process.env.NODE_ENV === 'production' ||
  pgSslMode === 'disable' ||
  /sslmode=disable/i.test(databaseUrl) ||
  /ssl=false/i.test(databaseUrl);

const sslOption = shouldUseSsl ? { rejectUnauthorized: false } : false;

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
    ssl: sslOption,
  },
  verbose: true,
  strict: true,
} satisfies Config;
