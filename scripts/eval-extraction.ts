/**
 * Scores the regex extractor and the LLM extractor against a labelled gold set.
 *
 *   npx tsx scripts/eval-extraction.ts --gold evals/gold.jsonl --split test
 *   npx tsx scripts/eval-extraction.ts --gold evals/gold.jsonl --regex-only
 *
 * Reports per stratum, never in aggregate: an overall accuracy figure hides the
 * exact defect this work exists to fix. A regex returns null both for "the text
 * does not say" and for "my pattern did not fire", so it scores ~0 on the
 * unknown stratum by construction — that is the number to watch.
 *
 * Ship gate for switching EXTRACTOR_MODE to live:
 *   1. the LLM wins exact-match in ALL THREE strata, for both counts
 *   2. its false-number rate is no worse than the regex's   <- go/no-go
 *   3. unknown recall >= 0.85
 * on the held-out split. Winning on aggregate while losing the zero stratum is
 * not a pass.
 */
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { readCasualties } from '../supabase/functions/_shared/casualties.ts';
import { createLlmExtractor, LLM_DEFAULTS } from '../supabase/functions/_shared/extract-llm.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

const args = process.argv.slice(2);
const value = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const goldPath = value('--gold') ?? 'evals/gold.jsonl';
const split = value('--split') ?? 'test';
const regexOnly = args.includes('--regex-only');

interface GoldCase {
  url: string;
  title: string;
  summary?: string;
  body?: string;
  deaths: number | null;
  injuries: number | null;
  /** 'train' | 'test'; unlabelled rows are treated as test. */
  split?: string;
}

let gold: GoldCase[];
try {
  gold = readFileSync(goldPath, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as GoldCase)
    .filter(row => split === 'all' || (row.split ?? 'test') === split);
} catch (err) {
  console.error(
    `Could not read ${goldPath}: ${String(err)}\n\n` +
    'Build it first:\n' +
    '  npx tsx scripts/compare-extractors.ts --since 7d --disagreements-only'
  );
  process.exit(1);
}

if (gold.length === 0) {
  console.error(`No cases in ${goldPath} for split "${split}".`);
  process.exit(1);
}

type Stratum = 'positive' | 'zero' | 'unknown';
const stratumOf = (v: number | null): Stratum =>
  v === null ? 'unknown' : v === 0 ? 'zero' : 'positive';

interface Observation {
  kind: 'deaths' | 'injuries';
  stratum: Stratum;
  expected: number | null;
  actual: number | null;
}

function score(name: string, observations: Observation[]): void {
  console.log(`\n=== ${name}`);
  const rows: Array<Record<string, string | number>> = [];

  for (const stratum of ['positive', 'zero', 'unknown'] as Stratum[]) {
    for (const kind of ['deaths', 'injuries'] as const) {
      const subset = observations.filter(o => o.stratum === stratum && o.kind === kind);
      if (subset.length === 0) continue;
      const hits = subset.filter(o => o.expected === o.actual).length;
      const mae = stratum === 'positive'
        ? subset.reduce((sum, o) => sum + Math.abs((o.expected ?? 0) - (o.actual ?? 0)), 0) / subset.length
        : null;
      rows.push({
        stratum,
        kind,
        n: subset.length,
        exact: `${((hits / subset.length) * 100).toFixed(1)}%`,
        mae: mae === null ? '-' : mae.toFixed(2)
      });
    }
  }
  console.table(rows);

  const unknowns = observations.filter(o => o.expected === null);
  const invented = unknowns.filter(o => o.actual !== null);
  const unknownRecall = unknowns.length
    ? (unknowns.length - invented.length) / unknowns.length
    : 1;

  console.log(
    `false-number rate: ${invented.length}/${unknowns.length} ` +
    `(${((invented.length / (unknowns.length || 1)) * 100).toFixed(1)}%)   ` +
    `unknown recall: ${unknownRecall.toFixed(3)}`
  );
}

const regexObservations: Observation[] = [];
for (const row of gold) {
  const reading = readCasualties({ title: row.title, summary: row.summary, body: row.body });
  regexObservations.push(
    {
      kind: 'deaths', stratum: stratumOf(row.deaths),
      expected: row.deaths, actual: reading.deaths.value
    },
    {
      kind: 'injuries', stratum: stratumOf(row.injuries),
      expected: row.injuries, actual: reading.injuries.value
    }
  );
}

console.log(`gold set: ${goldPath} · split "${split}" · ${gold.length} cases`);
score('regex', regexObservations);

if (regexOnly) process.exit(0);

const extractor = createLlmExtractor({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  // 'live' so the merge path being evaluated is the one that would ship.
  mode: 'live',
  model: process.env.ANTHROPIC_MODEL || LLM_DEFAULTS.model,
  maxCalls: Number.MAX_SAFE_INTEGER,
  deadlineMs: Number.MAX_SAFE_INTEGER
});

if (!extractor) {
  console.log('\nANTHROPIC_API_KEY is unset — regex scored only.');
  process.exit(0);
}

const llmObservations: Observation[] = [];
let failures = 0;

for (const [index, row] of gold.entries()) {
  process.stdout.write(`\rscoring LLM ${index + 1}/${gold.length}...`);
  const result = await extractor.extract(
    { title: row.title, link: row.url, pubDate: new Date(), source: 'eval', summary: row.summary ?? '' },
    row.body || row.summary || ''
  );

  if (!result) {
    // Counted, not skipped: a validation failure is a real miss on the live
    // path, where the regex reading survives instead.
    failures++;
    llmObservations.push(
      { kind: 'deaths', stratum: stratumOf(row.deaths), expected: row.deaths, actual: null },
      { kind: 'injuries', stratum: stratumOf(row.injuries), expected: row.injuries, actual: null }
    );
    continue;
  }

  llmObservations.push(
    {
      kind: 'deaths', stratum: stratumOf(row.deaths),
      expected: row.deaths, actual: result.deaths.value
    },
    {
      kind: 'injuries', stratum: stratumOf(row.injuries),
      expected: row.injuries, actual: result.injuries.value
    }
  );
}

process.stdout.write('\r');
score(`llm (${extractor.model})`, llmObservations);
console.log(`unusable responses: ${failures}/${gold.length}`);
console.log(
  '\nShip gate: LLM wins exact-match in all three strata for both counts,\n' +
  'false-number rate no worse than regex, unknown recall >= 0.85.'
);
