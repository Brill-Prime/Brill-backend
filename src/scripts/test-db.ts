import dotenv from 'dotenv';
// Load environment variables before requiring the DB config so the pool
// is created with the correct connection string.
dotenv.config();

// Use require here to avoid static-import hoisting which would run
// `src/db/config` before dotenv had a chance to inject env vars.
const { db, testConnection } = require('../db/config');
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Testing database connection...');
    console.log('Database URL:', process.env.DATABASE_URL || 'Using default local connection');

    try {
        // Test basic connection
        const connected = await testConnection();
        if (!connected) {
            console.error('❌ Failed to connect to database');
            process.exit(1);
        }
        console.log('✅ Successfully connected to database');

        // Test query execution
        const result = await db.execute(sql`SELECT NOW()`);
        console.log('✅ Successfully executed test query');
        // Drizzle/pg may return different shapes depending on driver/version.
        const nowRow = (result && (result.rows?.[0] ?? result[0])) || null;
        console.log('Current database time:', nowRow ? nowRow.now : JSON.stringify(result));

        // Get database version
        const versionResult = await db.execute(sql`SELECT version()`);
        const versionRow = (versionResult && (versionResult.rows?.[0] ?? versionResult[0])) || null;
        console.log('Database version:', versionRow ? versionRow.version : JSON.stringify(versionResult));

        // Test connection pool
        const poolResult = await db.execute(sql`SELECT current_database(), current_user`);
        const poolRow = (poolResult && (poolResult.rows?.[0] ?? poolResult[0])) || null;
        console.log('Database name:', poolRow ? poolRow.current_database : JSON.stringify(poolResult));
        console.log('Connected as user:', poolRow ? poolRow.current_user : JSON.stringify(poolResult));

        console.log('\n✨ All database checks passed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Database connection test failed:', error);
        process.exit(1);
    }
}

main();