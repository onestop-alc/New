/**
 * Re-reads casualty figures for stored articles with the current extractor,
 * then re-derives each affected story from its member articles.
 *
 *   npx tsx scripts/backfill-casualties.ts                # dry run (default)
 *   npx tsx scripts/backfill-casualties.ts --commit
 *   npx tsx scripts/backfill-casualties.ts --commit --limit 500
 *   npx tsx scripts/backfill-casualties.ts --story 1234 --commit
 *
 * Replaces scripts/backfill-facts.ts, which recomputed from stories.display_title
 * only and overwrote unconditionally — reverting every manual correction.
 *
 * Selects on extractor_version so it is incremental and resumable: bump
 * CASUALTY_EXTRACTOR_VERSION in _shared/casualties.ts and only the stale rows
 * are re-read. `casualties_locked` stories are never recomputed.
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import {
  CASUALTY_EXTRACTOR_VERSION,
  readCasualties
} from '../supabase/functions/_shared/casualties.ts';
import { extractProvinces } from '../supabase/functions/_shared/dedup.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const commit = flag('--commit');
const force = flag('--force');
const limit = Number(value('--limit') ?? 0) || null;
const storyFilter = value('--story');
const since = value('--since');
const BATCH = 500;

interface ArticleRow {
  id: string;
  story_id: string;
  title: string;
  summary: string | null;
  deaths: number | null;
  injuries: number | null;
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await client.connect();

const where: string[] = [];
const params: unknown[] = [];
if (!force) {
  params.push(CASUALTY_EXTRACTOR_VERSION);
  where.push(`extractor_version < $${params.length}`);
}
if (storyFilter) {
  params.push(storyFilter);
  where.push(`story_id = $${params.length}`);
}
if (since) {
  params.push(since);
  where.push(`published >= $${params.length}`);
}
// Never re-read an article whose figure came from a human or the LLM: this
// script only knows how to produce a regex reading.
where.push(`extractor = 'regex'`);

const changes = { toNumber: 0, numberToNumber: 0, toNull: 0, unchanged: 0 };
const byRule: Record<string, number> = {};
const informationLoss: string[] = [];
const touchedStories = new Set<string>();
let scanned = 0;
let lastId = '0';

console.log(
  `${commit ? 'Applying' : 'Dry run'} · extractor v${CASUALTY_EXTRACTOR_VERSION}` +
  `${force ? ' · --force (ignoring extractor_version)' : ''}`
);

for (;;) {
  if (limit && scanned >= limit) break;

  const pageSize = limit ? Math.min(BATCH, limit - scanned) : BATCH;
  const { rows } = await client.query<ArticleRow>(
    `SELECT id, story_id, title, summary, deaths, injuries
       FROM articles
      WHERE ${[...where, `id > $${params.length + 1}`].join(' AND ')}
      ORDER BY id
      LIMIT $${params.length + 2}`,
    [...params, lastId, pageSize]
  );
  if (rows.length === 0) break;
  lastId = rows[rows.length - 1].id;
  scanned += rows.length;

  for (const row of rows) {
    const summary = row.summary ?? '';
    // Bodies are never stored (see _shared/article-text.ts), so this reads
    // title + summary. scripts/refetch-bodies.ts covers the residual.
    const reading = readCasualties({ title: row.title, summary });
    const deaths = reading.deaths.value;
    const injuries = reading.injuries.value;

    const same = deaths === row.deaths && injuries === row.injuries;
    if (same) {
      changes.unchanged++;
    } else if (row.deaths === null && deaths !== null) {
      changes.toNumber++;
    } else if (deaths === null && row.deaths !== null) {
      changes.toNull++;
      informationLoss.push(`  ${row.id} ${row.deaths} -> null  ${row.title.slice(0, 70)}`);
    } else {
      changes.numberToNumber++;
    }

    for (const rule of [reading.deaths.rule, reading.injuries.rule]) {
      if (rule) byRule[rule] = (byRule[rule] ?? 0) + 1;
    }

    if (!commit) continue;

    await client.query(
      `UPDATE articles SET
         deaths = $1, injuries = $2, regex_deaths = $1, regex_injuries = $2,
         deaths_evidence = $3, injuries_evidence = $4,
         deaths_confidence = $5, injuries_confidence = $6,
         casualty_scope = $7, casualty_field = $8, casualty_snippet = $9,
         article_provinces = $10::text[],
         extractor_version = $11, extracted_at = now()
       WHERE id = $12`,
      [
        deaths,
        injuries,
        reading.deaths.evidence,
        reading.injuries.evidence,
        deaths === null ? null : reading.deaths.confidence,
        injuries === null ? null : reading.injuries.confidence,
        reading.deaths.scope,
        reading.deaths.field ?? reading.injuries.field,
        reading.deaths.snippet ?? reading.injuries.snippet,
        extractProvinces(`${row.title} ${summary}`),
        CASUALTY_EXTRACTOR_VERSION,
        row.id
      ]
    );
    touchedStories.add(row.story_id);
  }

  process.stdout.write(`\rscanned ${scanned} articles...`);
}

process.stdout.write('\r');
console.log(`\nscanned ${scanned} articles`);
console.table([
  { change: 'null   -> number', articles: changes.toNumber },
  { change: 'number -> number', articles: changes.numberToNumber },
  { change: 'number -> null  ', articles: changes.toNull },
  { change: 'unchanged       ', articles: changes.unchanged }
]);

if (Object.keys(byRule).length > 0) {
  console.log(
    'per-rule: ' +
    Object.entries(byRule).sort().map(([rule, n]) => `${rule}=${n}`).join(' ')
  );
}

// The one class of change that loses information. Read it before committing.
if (informationLoss.length > 0) {
  console.log(`\nREVIEW — ${informationLoss.length} articles lose a figure:`);
  console.log(informationLoss.join('\n'));
}

if (commit && touchedStories.size > 0) {
  console.log(`\nrecomputing ${touchedStories.size} stories...`);
  let done = 0;
  for (const storyId of touchedStories) {
    // Honours casualties_locked internally, so manual corrections survive.
    await client.query('SELECT recompute_story_casualties($1)', [storyId]);
    if (++done % 100 === 0) process.stdout.write(`\r  ${done}/${touchedStories.size}`);
  }
  console.log(`\r  ${done}/${touchedStories.size} done`);
}

if (!commit) {
  console.log('\nDry run — nothing written. Re-run with --commit to apply.');
}

await client.end();
