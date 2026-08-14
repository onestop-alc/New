/**
 * Health check for the news pipeline:
 *   npx tsx scripts/status.ts
 * Shows the latest ingestion runs, the cron schedule, and the current row counts.
 */
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await client.connect();

const show = async (label: string, sql: string) => {
  console.log(`\n== ${label}`);
  console.table((await client.query(sql)).rows);
};

await show('totals', `
  select (select count(*) from stories) as stories,
         (select count(*) from articles) as articles,
         (select count(*) from stories where source_count > 1) as corroborated`);

await show('recent runs', `
  select id, status, fetched, passed, new_stories, merged, skipped, errors,
         to_char(started_at, 'MM-DD HH24:MI') as started
    from ingest_runs order by id desc limit 8`);

// The number to watch before and after a casualty-extractor change: what share
// of stories carry a figure at all. `unknown` is honest, not a bug — but a big
// unknown share is where the extraction work pays off.
await show('casualty coverage', `
  select count(*) as stories,
         count(deaths) as with_deaths,
         round(100.0 * count(deaths) / nullif(count(*), 0), 1) as pct_deaths,
         count(injuries) as with_injuries,
         count(*) filter (where casualties_locked) as locked,
         count(*) filter (where deaths_source = 'llm') as from_llm
    from stories`);

await show('extractor versions', `
  select extractor, extractor_version, count(*) as articles,
         count(deaths) as with_deaths,
         count(*) filter (where casualty_scope = 'aggregate') as aggregate
    from articles group by 1, 2 order by 1, 2`);

await show('cron jobs', `select jobname, schedule, active from cron.job order by jobname`);

await show('cron history', `
  select j.jobname, d.status, to_char(d.start_time, 'MM-DD HH24:MI') as started, d.return_message
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   order by d.start_time desc limit 5`);

await show('latest stories', `
  select id, left(display_title, 60) as title, source_count, max_confidence,
         to_char(last_published, 'MM-DD HH24:MI') as published
    from stories order by last_published desc, created_at desc limit 5`);

await client.end();
