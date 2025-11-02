require('dotenv').config();
const { Client } = require('pg');

console.log('Node version:', process.version);
console.log('Using DATABASE_URL:', process.env.DATABASE_URL ? '[present]' : '[missing]');

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

client.connect()
    .then(() => client.query('SELECT NOW()'))
    .then(res => {
        console.log('Query result:', res.rows);
        return client.end();
    })
    .catch(err => {
        console.error('PG test error:', err);
        client.end().finally(() => process.exit(1));
    });
