#!/usr/bin/env node
/**
 * Applies db/schema.sql to Supabase (or any Postgres). Idempotent, so it is safe
 * to run on every deploy and after any release that changes the schema.
 *
 *   DATABASE_URL='postgres://…' npm run migrate
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  console.error('\nSupabase → Project Settings → Database → Connection string.');
  console.error('Use the POOLED string (port 6543), not the direct one.');
  process.exit(1);
}

const schemaPath = path.join(import.meta.dirname, '..', 'db', 'schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');
const local = /localhost|127\.0\.0\.1/.test(url);

const client = new pg.Client({
  connectionString: url,
  ssl: local ? false : { rejectUnauthorized: false }
});

try {
  await client.connect();
  await client.query(sql);

  const { rows } = await client.query(
    `SELECT c.relname AS table_name,
            (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid) AS indexes
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`
  );

  console.log(`Schema applied — ${rows.length} tables:\n`);
  for (const row of rows) {
    console.log(`  ${row.table_name.padEnd(24)} ${row.indexes} index(es)`);
  }
  console.log('\nNext: npm run seed  (optional demo data, password demo1234)');
} catch (err) {
  console.error(`Migration failed: ${err.message}`);
  process.exit(1);
} finally {
  await client.end();
}
