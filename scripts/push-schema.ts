import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from '../src/db/schema';
import { sql } from 'drizzle-orm';

async function pushSchema() {
  console.log('🔄 Pushing database schema...');
  
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const databaseUrl = process.env.DATABASE_URL;
  const isLocalhost = 
    databaseUrl.includes('localhost') || 
    databaseUrl.includes('127.0.0.1');
  
  const connectionString = isLocalhost 
    ? databaseUrl 
    : `${databaseUrl}?sslmode=require`;

  const pool = new Pool({
    connectionString,
    ssl: isLocalhost ? false : { rejectUnauthorized: false },
  });

  const db = drizzle(pool, { schema });

  try {
    console.log('✅ Connected to database');
    
    const tables = Object.keys(schema);
    console.log(`📊 Found ${tables.length} tables in schema`);
    
    // Create enums first
    console.log('🔄 Creating enums...');
    
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE role AS ENUM ('CONSUMER', 'MERCHANT', 'DRIVER', 'ADMIN');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE verification_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE order_status AS ENUM ('PENDING', 'CONFIRMED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE transaction_type AS ENUM ('PAYMENT', 'DELIVERY_EARNINGS', 'REFUND', 'ESCROW_RELEASE');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE kyc_status AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REQUIRES_RESUBMISSION');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE driver_tier AS ENUM ('STANDARD', 'PREMIUM', 'ELITE');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE support_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE escrow_status AS ENUM ('HELD', 'RELEASED', 'REFUNDED', 'DISPUTED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE invoice_status AS ENUM ('DUE', 'PAID', 'OVERDUE');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    console.log('✅ Enums created');
    
    // Test that we can query
    const result = await db.execute(sql`SELECT 1 as test`);
    console.log('✅ Database connection verified');
    
    console.log('');
    console.log('⚠️  Note: To complete the schema setup, you need to:');
    console.log('   1. Use the Replit Database pane to run the schema creation');
    console.log('   2. Or manually run: npm run db:push (and answer the prompts)');
    console.log('');
    console.log('   The database connection is working correctly with SSL.');
    
  } catch (error) {
    console.error('❌ Error pushing schema:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('✅ Database connection closed');
  }
}

pushSchema().catch((error) => {
  console.error('Failed to push schema:', error);
  process.exit(1);
});
