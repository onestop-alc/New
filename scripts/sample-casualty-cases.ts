/**
 * READ-ONLY sampler that prints stored articles as ready-to-paste CasualtyCase
 * literals for tests/fixtures/casualties.ts.
 *
 *   npx tsx scripts/sample-casualty-cases.ts --bucket missed --limit 40
 *   npx tsx scripts/sample-casualty-cases.ts --bucket false-friend
 *   npx tsx scripts/sample-casualty-cases.ts --from-feeds --limit 20   # no DB needed
 *
 * The expectations come out as `// TODO` on purpose. Auto-filling them from the
 * current extractor would freeze whatever it gets wrong into the gold set,
 * which is the one way to make a regression suite worse than none.
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import { readCasualties } from '../supabase/functions/_shared/casualties.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

const args = process.argv.slice(2);
const value = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const limit = Number(value('--limit') ?? 40);
const bucket = value('--bucket') ?? 'missed';
const fromFeeds = args.includes('--from-feeds');

const CASUALTY_WORDS = 'ดับ|เสียชีวิต|ตาย|เจ็บ|สาหัส|ศพ|สังเวย';

/**
 * Stratified, not uniform. A random sample is dominated by headlines the
 * extractor already handles; these four buckets are where the errors live.
 */
const BUCKETS: Record<string, { label: string; sql: string }> = {
  missed: {
    label: 'no figure extracted, but a casualty word is present',
    sql: `SELECT a.title, a.summary, a.url
            FROM articles a
           WHERE a.deaths IS NULL AND a.injuries IS NULL
             AND (a.title ~ '${CASUALTY_WORDS}' OR coalesce(a.summary, '') ~ '${CASUALTY_WORDS}')
           ORDER BY random() LIMIT $1`
  },
  suspect: {
    label: 'largest extracted figures — candidate false positives',
    sql: `SELECT a.title, a.summary, a.url
            FROM articles a
           WHERE a.deaths IS NOT NULL
           ORDER BY a.deaths DESC LIMIT $1`
  },
  truncated: {
    label: 'headlines cut off by the aggregator',
    sql: `SELECT a.title, a.summary, a.url
            FROM articles a
           WHERE a.title ~ '(…|\\.\\.\\.)\\s*$'
           ORDER BY a.published DESC LIMIT $1`
  },
  'false-friend': {
    label: 'known false-friend vocabulary',
    sql: `SELECT a.title, a.summary, a.url
            FROM articles a
           WHERE a.title ~ 'อันดับ|ระดับ|ไฟดับ|ดับเพลิง|ดับเครื่อง|ตายาย|สี่แยก|สองแถว'
           ORDER BY a.published DESC LIMIT $1`
  }
};

interface Sample {
  title: string;
  summary: string | null;
  url?: string;
}

function slug(index: number): string {
  return `sampled-${bucket}-${String(index + 1).padStart(3, '0')}`;
}

function escape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function print(samples: Sample[]): void {
  console.log(`\n// ${samples.length} cases — fill in every deaths/injuries before committing.`);
  samples.forEach((sample, index) => {
    const current = readCasualties({
      title: sample.title,
      summary: sample.summary ?? undefined
    });
    console.log(
      `  { id: '${slug(index)}',\n` +
      `    title: '${escape(sample.title)}',\n` +
      (sample.summary ? `    summary: '${escape(sample.summary)}',\n` : '') +
      `    deaths: null, // TODO (extractor says ${current.deaths.value})\n` +
      `    injuries: null, // TODO (extractor says ${current.injuries.value})\n` +
      `    tags: [],` +
      (sample.url ? `\n    note: '${escape(sample.url)}'` : '') +
      ` },`
    );
  });
}

if (fromFeeds) {
  // No credentials on hand: sample live feed output through the existing dry-run
  // path instead of the database.
  const { runIngestion } = await import('../src/backend/ingest/index.js');
  const result = await runIngestion({ dryRun: true });
  const articles = result && 'articles' in result ? result.articles : [];
  console.log(`\n// from live feeds — ${articles.length} relevant articles`);
  print(articles.slice(0, limit).map(a => ({ title: a.title, summary: a.summary, url: a.link })));
} else {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (or pass --from-feeds to sample the live feeds)');
    process.exit(1);
  }
  const chosen = BUCKETS[bucket];
  if (!chosen) {
    console.error(`unknown --bucket ${bucket}; try: ${Object.keys(BUCKETS).join(', ')}`);
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  console.log(`\n// bucket "${bucket}": ${chosen.label}`);
  const { rows } = await client.query<Sample>(chosen.sql, [limit]);
  print(rows);
  await client.end();
}
