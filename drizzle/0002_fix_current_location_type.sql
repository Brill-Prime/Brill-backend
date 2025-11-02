-- Fix current_location column type in driver_profiles table
ALTER TABLE "driver_profiles" ALTER COLUMN "current_location" TYPE jsonb USING current_location::jsonb;