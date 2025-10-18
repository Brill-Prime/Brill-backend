import type { Config } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Determine SSL settings. Many hosted Postgres providers require SSL/TLS.
const databaseUrl = process.env.DATABASE_URL!;

// Force SSL for all connections (required by most hosted databases like Render)
// This overrides any sslmode parameter in the connection string
const sslOption = { rejectUnauthorized: false };

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
