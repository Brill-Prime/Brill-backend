import dotenv from 'dotenv';
// Load environment variables as early as possible so any module importing
// this config file sees the correct values (avoid silent fallbacks).
dotenv.config();

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Use database URL from environment variable
if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL not set. Using development mode with limited functionality.");
}

const databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres";

// Determine SSL settings based on environment and database URL
const isLocalhost =
  databaseUrl.includes('localhost') ||
  databaseUrl.includes('127.0.0.1');

// Database connection pool with production-ready settings
// Note: The ssl config here overrides any sslmode in the connection string
const pool = new Pool({
  connectionString: databaseUrl,
  // Handle SSL configuration - most hosted databases require SSL
  // This overrides any sslmode parameter in the connection string
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
  max: 20, // Maximum number of clients in the pool
  min: 5, // Minimum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased to 10 seconds for remote databases
  allowExitOnIdle: false,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

// Drizzle database instance
export const db = drizzle(pool, { schema });

// Test database connection with retry logic
export async function testConnection(retries = 3): Promise<boolean> {
  // Skip database connection test in development mode if needed
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_DB_CONNECTION_TEST === 'true') {
    console.log('⚠️ Skipping database connection test in development mode');
    return true;
  }

  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      console.log('✅ Database connected successfully');
      return true;
    } catch (error) {
      console.error(`❌ Database connection attempt ${i + 1} failed:`, error);
      if (i === retries - 1) {
        return false;
      }
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
  return false;
}

// Graceful shutdown
export async function closePool() {
  await pool.end();
  console.log('Database pool closed');
}

// Auto-test connection on startup
testConnection().catch(err => {
  console.error('Initial database connection failed:', err);
});

export { pool };