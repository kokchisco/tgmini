#!/usr/bin/env node
const { Pool } = require('pg');

async function main() {
  const sqlArg = process.argv.slice(2).join(' ').trim();
  if (!sqlArg) {
    console.error('Usage: node scripts/run-sql.js "<SQL_STATEMENT>"');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set in environment.');
    process.exit(1);
  }

  const sslMode = process.env.PGSSLMODE === 'require'
    ? { rejectUnauthorized: false }
    : undefined;

  const pool = new Pool({ connectionString, ssl: sslMode });
  const client = await pool.connect();
  try {
    const res = await client.query(sqlArg);
    if (res.command === 'SELECT') {
      console.log(JSON.stringify(res.rows, null, 2));
    } else {
      console.log(`${res.command} OK; rows affected: ${res.rowCount}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('SQL execution failed:', err.message);
  process.exit(1);
});


