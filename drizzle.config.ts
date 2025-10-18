import type { Config } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Determine SSL settings. Many hosted Postgres providers require SSL/TLS.
const databaseUrl = process.env.DATABASE_URL!;

// Determine if we need SSL based on the database URL
const isLocalhost = 
  databaseUrl.includes('localhost') || 
  databaseUrl.includes('127.0.0.1');

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: isLocalhost ? databaseUrl : `${databaseUrl}?sslmode=require`,
  },
  verbose: true,
  strict: true,
} satisfies Config;
