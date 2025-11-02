require('dotenv').config();
const { Client } = require('pg');

console.log('Node version:', process.version);
const dbUrl = process.env.DATABASE_URL;
console.log('Raw DB URL:', dbUrl ? '[present]' : '[missing]');

try {
    const u = new URL(dbUrl);
    const user = u.username;
    const password = u.password;
    const host = u.hostname;
    const port = u.port || 5432;
    const database = u.pathname ? u.pathname.slice(1) : undefined;
    console.log({ user, host, port, database });

    const client = new Client({ host, port, database, user, password, ssl: { rejectUnauthorized: false } });
    client.connect()
        .then(() => client.query('SELECT NOW()'))
        .then(res => {
            console.log('Parsed PG query result:', res.rows);
            return client.end();
        })
        .catch(err => {
            console.error('Parsed PG error:', err);
            client.end().finally(() => process.exit(1));
        });
} catch (err) {
    console.error('URL parse error', err);
}
