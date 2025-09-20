
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Use Render database URL or fallback to environment variable
const databaseUrl = process.env.DATABASE_URL || 'postgresql://brillprimemobile:PrveAcaiCfun5AanWQtclfRYJ4LBBaOF@dpg-d2kond3uibrs73eesitg-a.oregon-postgres.render.com/dbbrillprimemobile';

// Database connection pool
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }, // Required for Render PostgreSQL
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Drizzle database instance
export const db = drizzle(pool, { schema });

// Test database connection
export async function testConnection() {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connected successfully');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

export { pool };
