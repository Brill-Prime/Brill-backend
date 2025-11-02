import dotenv from 'dotenv';
dotenv.config();

import { db } from '../db/config';
import { sql } from 'drizzle-orm';

async function run() {
  try {
    console.log('Applying fuel_orders time column fixes...');

    await db.execute(sql`
      ALTER TABLE "fuel_orders"
        ALTER COLUMN "scheduled_delivery_time" TYPE timestamp
        USING CASE 
          WHEN "scheduled_delivery_time" IS NULL THEN NULL
          WHEN trim("scheduled_delivery_time") = '' THEN NULL
          ELSE "scheduled_delivery_time"::timestamp
        END;
    `);

    await db.execute(sql`
      ALTER TABLE "fuel_orders"
        ALTER COLUMN "estimated_delivery_time" TYPE timestamp
        USING CASE 
          WHEN "estimated_delivery_time" IS NULL THEN NULL
          WHEN trim("estimated_delivery_time") = '' THEN NULL
          ELSE "estimated_delivery_time"::timestamp
        END;
    `);

    console.log('✅ Fuel_orders columns updated successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to update fuel_orders columns:', err);
    process.exit(1);
  }
}

run();