import dotenv from 'dotenv';
dotenv.config();

import { db } from '../db/config';
import { sql } from 'drizzle-orm';

async function run() {
  try {
    const result = await db.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'fuel_orders'
        AND column_name IN ('scheduled_delivery_time','estimated_delivery_time')
      ORDER BY column_name;
    `);

    console.log('fuel_orders column types:');
    const rows: any[] = (result as any)?.rows ?? (Array.isArray(result) ? (result as any) : []);
    for (const row of rows) {
      console.log(`- ${row.column_name}: ${row.data_type}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Failed to check column types:', err);
    process.exit(1);
  }
}

run();