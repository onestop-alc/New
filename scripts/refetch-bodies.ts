/**
 * Re-crawls publisher pages for stories that still carry no death figure, reads
 * the casualties out of the body, and writes back the figures — never the body.
 *
 *   npx tsx scripts/refetch-bodies.ts                       # dry run
 *   npx tsx scripts/refetch-bodies.ts --commit --max 200
 *
 * Run this from a laptop, not the Edge Function: a historical backlog has no
 * business inside a 30-minute cron slot, and the polite per-host delay makes it
 * slow by design.
 *
 * Bodies are held in memory and discarded. That is the accepted cost of not
 * storing third-party article text: every extractor change that wants the body
 * has to re-crawl rather than replay a stored column.
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import {
  CASUALTY_EXTRACTOR_VERSION,
  readCasualties
} from '../supabase/functions/_shared/casualties.ts';
import { createBodyFetcher } from '../supabase/functions/_shared/article-text.ts';
import { CONFIG } from '../supabase/functions/_shared/feeds.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const args = process.argv.slice(2);
const value = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const commit = args.includes('--commit');
const max = Number(value('--max') ?? 100);
const delayMs = Number(value('--delay') ?? 500);

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await client.connect();

const { rows } = await client.query<{
  id: string;
  story_id: string;
  url: string;
  title: string;
  summary: string | null;
}>(
  `SELECT a.id, a.story_id, a.url, a.title, a.summary
     FROM articles a
     JOIN stories s ON s.id = a.story_id
    WHERE s.deaths IS NULL
      AND NOT s.casualties_locked
      AND NOT a.aggregator
    ORDER BY a.published DESC
    LIMIT $1`,
  [max]
);

console.log(`${commit ? 'Applying' : 'Dry run'} · ${rows.length} candidate articles`);

const fetchBody = createBodyFetcher({
  timeoutMs: CONFIG.BODY_FETCH_TIMEOUT_MS,
  maxChars: CONFIG.MAX_BODY_LENGTH,
  maxBytes: CONFIG.BODY_FETCH_MAX_BYTES,
  hostDelayMs: delayMs
});

const via: Record<string, number> = {};
const touchedStories = new Set<string>();
let improved = 0;
let noBody = 0;

for (const [index, row] of rows.entries()) {
  process.stdout.write(`\r${index + 1}/${rows.length}  improved=${improved}`);

  const body = await fetchBody(row.url);
  if (!body) {
    noBody++;
    continue;
  }
  via[body.via] = (via[body.via] ?? 0) + 1;

  const reading = readCasualties({
    title: row.title,
    summary: row.summary ?? undefined,
    body: body.text
  });
  // Only worth a write when the body actually added something.
  if (reading.deaths.value === null && reading.injuries.value === null) continue;
  improved++;

  if (!commit) continue;

  await client.query(
    `UPDATE articles SET
       deaths = $1, injuries = $2, regex_deaths = $1, regex_injuries = $2,
       deaths_evidence = $3, injuries_evidence = $4,
       deaths_confidence = $5, injuries_confidence = $6,
       casualty_scope = $7, casualty_field = $8, casualty_snippet = $9,
       extractor_version = $10, extracted_at = now()
     WHERE id = $11`,
    [
      reading.deaths.value,
      reading.injuries.value,
      reading.deaths.evidence,
      reading.injuries.evidence,
      reading.deaths.value === null ? null : reading.deaths.confidence,
      reading.injuries.value === null ? null : reading.injuries.confidence,
      reading.deaths.scope,
      reading.deaths.field ?? reading.injuries.field,
      reading.deaths.snippet ?? reading.injuries.snippet,
      CASUALTY_EXTRACTOR_VERSION,
      row.id
    ]
  );
  touchedStories.add(row.story_id);
}

console.log(`\n\ncrawled ${rows.length - noBody}, unusable ${noBody}, improved ${improved}`);
if (Object.keys(via).length > 0) {
  console.log('body source: ' + Object.entries(via).map(([k, n]) => `${k}=${n}`).join(' '));
}

if (commit && touchedStories.size > 0) {
  console.log(`recomputing ${touchedStories.size} stories...`);
  for (const storyId of touchedStories) {
    await client.query('SELECT recompute_story_casualties($1)', [storyId]);
  }
}

if (!commit) console.log('\nDry run — nothing written. Re-run with --commit to apply.');

await client.end();
