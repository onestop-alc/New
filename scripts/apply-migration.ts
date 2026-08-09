/**
 * Applies a .sql file to DATABASE_URL in a single transaction.
 *   npx tsx scripts/apply-migration.ts supabase/migrations/0005_ingest_rpc.sql
 */
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const file = process.argv[2];
if (!file) {
  console.error('usage: tsx scripts/apply-migration.ts <file.sql>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = await readFile(file, 'utf8');
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

await client.connect();
try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log(`Applied ${file}`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error(`Failed to apply ${file}:`, err);
  process.exitCode = 1;
} finally {
  await client.end();
}
