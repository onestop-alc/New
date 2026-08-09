/**
 * One-time setup for the cloud schedule:
 *   1. stores the project URL and the ingest trigger secret in Supabase Vault
 *   2. applies supabase/migrations/0006_cron.sql (the pg_cron jobs)
 *   3. prints the command that puts the same secret on the Edge Function
 *
 *   npx tsx scripts/setup-cron.ts
 *
 * Re-running is safe: existing secrets are updated in place and the cron jobs
 * are unscheduled before being recreated. Pass INGEST_TRIGGER_SECRET in the
 * environment to reuse an existing secret instead of generating a new one.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const projectUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
if (!projectUrl) {
  console.error('VITE_SUPABASE_URL / SUPABASE_URL is not set');
  process.exit(1);
}

const triggerSecret = process.env.INGEST_TRIGGER_SECRET || randomBytes(32).toString('hex');

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

async function putSecret(name: string, value: string, description: string) {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM vault.secrets WHERE name = $1',
    [name]
  );
  if (rows.length > 0) {
    await client.query('SELECT vault.update_secret($1, $2, $3, $4)', [
      rows[0].id,
      value,
      name,
      description
    ]);
    console.log(`vault: updated ${name}`);
  } else {
    await client.query('SELECT vault.create_secret($1, $2, $3)', [value, name, description]);
    console.log(`vault: created ${name}`);
  }
}

await client.connect();
try {
  await putSecret('project_url', projectUrl, 'Supabase project URL used by the ingest cron');
  await putSecret(
    'ingest_trigger_secret',
    triggerSecret,
    'Shared secret sent as x-ingest-secret by the ingest cron'
  );

  const sql = await readFile('supabase/migrations/0006_cron.sql', 'utf8');
  await client.query(sql);
  console.log('cron: scheduled ingest-news-every-30-min and ingest-sweep-stale');

  const { rows } = await client.query(
    'SELECT jobname, schedule, active FROM cron.job ORDER BY jobname'
  );
  console.table(rows);

  console.log('\nNow put the same secret on the Edge Function:');
  console.log(`  npx supabase secrets set INGEST_TRIGGER_SECRET=${triggerSecret}`);
} finally {
  await client.end();
}
