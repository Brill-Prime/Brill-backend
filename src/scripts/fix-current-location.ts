import { db } from '../db/config';
import { sql } from 'drizzle-orm';

async function fixCurrentLocationColumn() {
  try {
    console.log('Starting to fix current_location column type...');
    
    // Execute the SQL to alter the column type with explicit casting
    await db.execute(sql`
      ALTER TABLE "driver_profiles" 
      ALTER COLUMN "current_location" TYPE jsonb 
      USING CASE 
        WHEN "current_location" IS NULL THEN NULL
        WHEN "current_location" = '' THEN '{}'::jsonb
        ELSE "current_location"::jsonb 
      END
    `);
    
    console.log('Successfully fixed current_location column type!');
  } catch (error) {
    console.error('Error fixing current_location column:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

fixCurrentLocationColumn();