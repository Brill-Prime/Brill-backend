import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "../src/db/schema";

// Use Render database URL or fallback to environment variable
const databaseUrl = process.env.DATABASE_URL || 'postgresql://brillprimemobile:PrveAcaiCfun5AanWQtclfRYJ4LBBaOF@dpg-d2kond3uibrs73eesitg-a.oregon-postgres.render.com/dbbrillprimemobile';

export const pool = new Pool({ 
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false } // Required for Render
});

export const db = drizzle(pool, { schema });
