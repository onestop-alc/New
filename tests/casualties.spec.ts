import { describe, expect, it } from 'vitest';
import { readCasualties } from '../supabase/functions/_shared/casualties.ts';
import { CASUALTY_GOLD } from './fixtures/casualties.ts';

describe('readCasualties', () => {
  for (const testCase of CASUALTY_GOLD) {
    it(`${testCase.id}: ${testCase.title.slice(0, 48)}`, () => {
      const reading = readCasualties({
        title: testCase.title,
        summary: testCase.summary,
        body: testCase.body
      });

      const actual = { deaths: reading.deaths.value, injuries: reading.injuries.value };
      expect(actual, testCase.note ?? '').toEqual({
        deaths: testCase.deaths,
        injuries: testCase.injuries
      });

      // Scope only carries meaning where a figure was extracted.
      const expectedScope = testCase.scope ?? 'incident';
      if (testCase.deaths !== null) expect(reading.deaths.scope).toBe(expectedScope);
      if (testCase.injuries !== null) expect(reading.injuries.scope).toBe(expectedScope);
    });
  }

  it('gives every extracted figure a rule, a snippet and a confidence', () => {
    for (const testCase of CASUALTY_GOLD) {
      const reading = readCasualties({
        title: testCase.title,
        summary: testCase.summary,
        body: testCase.body
      });
      for (const fact of [reading.deaths, reading.injuries]) {
        if (fact.value === null) {
          expect(fact.rule).toBeNull();
          expect(fact.confidence).toBe(0);
          continue;
        }
        expect(fact.rule, testCase.id).toBeTruthy();
        expect(fact.snippet, testCase.id).toBeTruthy();
        expect(fact.confidence, testCase.id).toBeGreaterThan(0);
        expect(fact.field, testCase.id).toBeTruthy();
      }
    }
  });

  it('never returns a negative or absurd headcount', () => {
    for (const testCase of CASUALTY_GOLD) {
      const reading = readCasualties({
        title: testCase.title,
        summary: testCase.summary,
        body: testCase.body
      });
      for (const fact of [reading.deaths, reading.injuries]) {
        if (fact.value === null) continue;
        expect(fact.value, testCase.id).toBeGreaterThanOrEqual(0);
        expect(fact.value, testCase.id).toBeLessThanOrEqual(5000);
      }
    }
  });

  it('has no duplicate fixture ids', () => {
    const seen = new Set<string>();
    for (const testCase of CASUALTY_GOLD) {
      expect(seen.has(testCase.id), `duplicate id ${testCase.id}`).toBe(false);
      seen.add(testCase.id);
    }
  });
});
