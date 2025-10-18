import type { Config } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Determine SSL settings. Many hosted Postgres providers require SSL/TLS.
const databaseUrl = process.env.DATABASE_URL!;

// Determine if this is a localhost connection
const isLocalhost =
  databaseUrl.includes('localhost') ||
  databaseUrl.includes('127.0.0.1');

// For Replit PostgreSQL, we need to remove sslmode=disable and force SSL
const cleanedUrl = isLocalhost 
  ? databaseUrl 
  : databaseUrl.replace(/[?&]sslmode=disable/g, '');

const sslOption = isLocalhost ? false : { rejectUnauthorized: false };

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: cleanedUrl,
    ssl: sslOption,
  },
  verbose: true,
  strict: true,
} satisfies Config;
