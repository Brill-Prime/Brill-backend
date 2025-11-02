-- Fix fuel_orders time columns types with explicit casting
-- Convert scheduled_delivery_time and estimated_delivery_time from text to timestamp

ALTER TABLE "fuel_orders"
  ALTER COLUMN "scheduled_delivery_time" TYPE timestamp
  USING CASE 
    WHEN "scheduled_delivery_time" IS NULL THEN NULL
    WHEN trim("scheduled_delivery_time") = '' THEN NULL
    ELSE "scheduled_delivery_time"::timestamp
  END;

ALTER TABLE "fuel_orders"
  ALTER COLUMN "estimated_delivery_time" TYPE timestamp
  USING CASE 
    WHEN "estimated_delivery_time" IS NULL THEN NULL
    WHEN trim("estimated_delivery_time") = '' THEN NULL
    ELSE "estimated_delivery_time"::timestamp
  END;