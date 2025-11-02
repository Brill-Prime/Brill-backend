import type { Config } from 'drizzle-kit';
import fs from 'fs';
import path from 'path';

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
    ssl: isLocalhost ? false : {
      ca: fs.readFileSync('./prod-ca-2021.crt').toString(),
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined,
      servername: undefined,
      minVersion: 'TLSv1.2',
    },
  },
  verbose: true,
  strict: true,
} satisfies Config;
