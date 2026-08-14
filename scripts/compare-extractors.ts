/**
 * Dumps the articles where the regex and the LLM disagree, as a review sheet.
 *
 *   npx tsx scripts/compare-extractors.ts --since 7d --disagreements-only
 *   npx tsx scripts/compare-extractors.ts --since 7d --format jsonl > evals/raw.jsonl
 *
 * This is how the LLM gold set gets built: run EXTRACTOR_MODE=shadow for a week,
 * then adjudicate the disagreements. They are a few dozen cases rather than a
 * few hundred, and they sit exactly where the decision lives — a uniformly
 * sampled set spends most of its labelling budget on cases both extractors
 * already agree on.
 *
 * Sample some agreements too (--sample-agreements) so the resulting set is not
 * adversarially biased toward the hard cases.
 */
import { Client } from 'pg';
import dotenv from 'dotenv';

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

const since = value('--since') ?? '7d';
const disagreementsOnly = args.includes('--disagreements-only');
const format = value('--format') ?? 'text';
const sampleAgreements = Number(value('--sample-agreements') ?? 0);

const days = Number(since.replace(/d$/, '')) || 7;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await client.connect();

interface Row {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  regex_deaths: number | null;
  regex_injuries: number | null;
  llm_deaths: number | null;
  llm_injuries: number | null;
  llm_quote: string | null;
  content_type: string | null;
  extract_confidence: string | null;
}

// In shadow mode articles.deaths stays the regex value while extract_payload
// carries the model output, so both readings are on the same row.
const SELECT = `
  SELECT a.id, a.url, a.title, a.summary,
         a.regex_deaths, a.regex_injuries,
         nullif(a.extract_payload->'deaths'->>'value', '')::int    AS llm_deaths,
         nullif(a.extract_payload->'injuries'->>'value', '')::int  AS llm_injuries,
         a.extract_payload->'deaths'->>'quote'                     AS llm_quote,
         a.content_type, a.extract_confidence
    FROM articles a
   WHERE a.extract_payload IS NOT NULL
     AND a.published >= now() - ($1 || ' days')::interval`;

const { rows } = await client.query<Row>(`${SELECT} ORDER BY a.published DESC`, [days]);

const disagree = rows.filter(
  r => r.regex_deaths !== r.llm_deaths || r.regex_injuries !== r.llm_injuries
);
const agree = rows.filter(
  r => r.regex_deaths === r.llm_deaths && r.regex_injuries === r.llm_injuries
);

// Deterministic sample: take every Nth agreement rather than a random draw, so
// re-running the command produces the same review sheet.
const step = sampleAgreements > 0 ? Math.max(1, Math.floor(agree.length / sampleAgreements)) : 0;
const sampled = step ? agree.filter((_, i) => i % step === 0).slice(0, sampleAgreements) : [];

const selected = disagreementsOnly ? disagree : [...disagree, ...sampled];

if (format === 'jsonl') {
  for (const row of selected) console.log(JSON.stringify(row));
} else {
  console.log(
    `last ${days} days: ${rows.length} articles with an LLM reading — ` +
    `${disagree.length} disagree (${((disagree.length / (rows.length || 1)) * 100).toFixed(1)}%), ` +
    `${agree.length} agree` +
    (sampled.length ? `, ${sampled.length} agreements sampled` : '')
  );

  for (const row of selected) {
    const mark = disagree.includes(row) ? '≠' : '=';
    console.log(
      `\n${mark} ${row.title}\n` +
      `  regex  dead=${row.regex_deaths} hurt=${row.regex_injuries}\n` +
      `  llm    dead=${row.llm_deaths} hurt=${row.llm_injuries} ` +
      `(${row.content_type ?? '?'}, ${row.extract_confidence ?? '?'})\n` +
      (row.llm_quote ? `  quote  “${row.llm_quote}”\n` : '') +
      `  ${row.url}`
    );
  }

  console.log(
    '\nAdjudicate each ≠ case, then commit the verdicts to evals/gold.jsonl as\n' +
    '{url, title, summary, deaths, injuries} and hold back 30% as a test split.'
  );
}

await client.end();
