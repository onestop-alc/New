import { describe, expect, it } from 'vitest';
import { readCasualties } from '../supabase/functions/_shared/casualties.ts';
import { CASUALTY_GOLD, isFalsePositiveCase, type CasualtyCase } from './fixtures/casualties.ts';

/**
 * The ratchet.
 *
 * Aggregate accuracy hides the exact bug this rewrite exists to fix, so the
 * numbers are reported per stratum and each has its own floor:
 *
 *   positive  truth is a headcount   — exact match, plus MAE so 3-vs-4 scores
 *                                      better than 3-vs-30
 *   zero      truth is an explicit 0 — exact match
 *   unknown   the text does not say  — fraction correctly left null
 *
 * `falseNumbers` is the go/no-go gate: a figure emitted where the truth is
 * unknown. That is the class the old `ดับ`-inside-`อันดับ` bug produced, and it
 * is worse than a miss because it lands a fabricated toll on a public dashboard.
 *
 * Raising a floor after a genuine improvement is the intended workflow.
 * Lowering one to make a build pass is not.
 */
const BASELINE = {
  exact: 1.0,
  positiveExact: 1.0,
  zeroExact: 1.0,
  unknownExact: 1.0,
  falseNumbers: 0,
  maxMae: 0
};

type Stratum = 'positive' | 'zero' | 'unknown';

function stratumOf(value: number | null): Stratum {
  if (value === null) return 'unknown';
  return value === 0 ? 'zero' : 'positive';
}

interface Observation {
  id: string;
  kind: 'deaths' | 'injuries';
  expected: number | null;
  actual: number | null;
  stratum: Stratum;
}

function observe(testCase: CasualtyCase): Observation[] {
  const reading = readCasualties({
    title: testCase.title,
    summary: testCase.summary,
    body: testCase.body
  });
  return [
    {
      id: testCase.id, kind: 'deaths' as const,
      expected: testCase.deaths, actual: reading.deaths.value,
      stratum: stratumOf(testCase.deaths)
    },
    {
      id: testCase.id, kind: 'injuries' as const,
      expected: testCase.injuries, actual: reading.injuries.value,
      stratum: stratumOf(testCase.injuries)
    }
  ];
}

const OBSERVATIONS = CASUALTY_GOLD.flatMap(observe);

function rate(subset: Observation[]): number {
  if (subset.length === 0) return 1;
  const hits = subset.filter(o => o.expected === o.actual).length;
  return hits / subset.length;
}

function table(): string {
  const rows: string[] = [];
  for (const stratum of ['positive', 'zero', 'unknown'] as Stratum[]) {
    for (const kind of ['deaths', 'injuries'] as const) {
      const subset = OBSERVATIONS.filter(o => o.stratum === stratum && o.kind === kind);
      rows.push(
        `  ${stratum.padEnd(9)} ${kind.padEnd(9)} n=${String(subset.length).padStart(3)} ` +
        `exact=${(rate(subset) * 100).toFixed(1)}%`
      );
    }
  }
  return rows.join('\n');
}

function regressions(): string {
  const misses = OBSERVATIONS.filter(o => o.expected !== o.actual);
  if (misses.length === 0) return 'none';
  return misses
    .map(o => `  ${o.id} ${o.kind}: expected ${o.expected} got ${o.actual}`)
    .join('\n');
}

describe('casualty extraction accuracy', () => {
  it('reports the per-stratum table', () => {
    console.log(`\ncasualty extraction — ${CASUALTY_GOLD.length} gold cases\n${table()}`);
    console.log(`\nregressions:\n${regressions()}\n`);
    expect(OBSERVATIONS.length).toBe(CASUALTY_GOLD.length * 2);
  });

  it(`overall exact match >= ${BASELINE.exact}`, () => {
    expect(rate(OBSERVATIONS), regressions()).toBeGreaterThanOrEqual(BASELINE.exact);
  });

  it(`positive stratum exact match >= ${BASELINE.positiveExact}`, () => {
    const subset = OBSERVATIONS.filter(o => o.stratum === 'positive');
    expect(subset.length).toBeGreaterThan(40);
    expect(rate(subset), regressions()).toBeGreaterThanOrEqual(BASELINE.positiveExact);
  });

  it(`zero stratum exact match >= ${BASELINE.zeroExact}`, () => {
    const subset = OBSERVATIONS.filter(o => o.stratum === 'zero');
    expect(subset.length).toBeGreaterThan(8);
    expect(rate(subset), regressions()).toBeGreaterThanOrEqual(BASELINE.zeroExact);
  });

  it(`unknown stratum exact match >= ${BASELINE.unknownExact}`, () => {
    const subset = OBSERVATIONS.filter(o => o.stratum === 'unknown');
    expect(subset.length).toBeGreaterThan(40);
    expect(rate(subset), regressions()).toBeGreaterThanOrEqual(BASELINE.unknownExact);
  });

  it(`emits at most ${BASELINE.falseNumbers} figures where the truth is unknown`, () => {
    const invented = OBSERVATIONS.filter(o => o.expected === null && o.actual !== null);
    expect(
      invented.length,
      invented.map(o => `  ${o.id} ${o.kind}: invented ${o.actual}`).join('\n')
    ).toBeLessThanOrEqual(BASELINE.falseNumbers);
  });

  it(`mean absolute error on the positive stratum <= ${BASELINE.maxMae}`, () => {
    const subset = OBSERVATIONS.filter(o => o.stratum === 'positive');
    const total = subset.reduce(
      (sum, o) => sum + Math.abs((o.expected ?? 0) - (o.actual ?? 0)),
      0
    );
    expect(total / subset.length).toBeLessThanOrEqual(BASELINE.maxMae);
  });

  it('never reports a figure on a case built to have none', () => {
    const offenders = CASUALTY_GOLD.filter(isFalsePositiveCase).filter(testCase => {
      const reading = readCasualties({
        title: testCase.title,
        summary: testCase.summary,
        body: testCase.body
      });
      return reading.deaths.value !== null || reading.injuries.value !== null;
    });
    expect(offenders.map(o => o.id)).toEqual([]);
  });
});
