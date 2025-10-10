import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Use database URL from environment variable
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const databaseUrl = process.env.DATABASE_URL;

// Database connection pool with production-ready settings
const pool = new Pool({
  connectionString: databaseUrl,
  // Handle SSL configuration for production (Render)
  ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 20, // Maximum number of clients in the pool
  min: 5, // Minimum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Reconnection settings
  allowExitOnIdle: false,
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

// Drizzle database instance
export const db = drizzle(pool, { schema });

// Test database connection with retry logic
export async function testConnection(retries = 3): Promise<boolean> {
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