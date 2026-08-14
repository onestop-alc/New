import { describe, expect, it } from 'vitest';
import {
  casualtyLabel,
  casualtyState,
  casualtyTotals,
  isAggregateStory,
  type Story
} from '../src/lib/api.ts';

function story(partial: Partial<Story>): Story {
  return {
    id: 1,
    display_title: 'เมาแล้วขับชน',
    provinces: ['ชลบุรี'],
    deaths: null,
    injuries: null,
    source_count: 1,
    max_confidence: 'medium',
    first_published: '2026-08-12T10:00:00Z',
    last_published: '2026-08-12T10:00:00Z',
    ...partial
  };
}

describe('casualtyState', () => {
  it('separates unknown from a reported zero', () => {
    expect(casualtyState({ deaths: null, injuries: null })).toBe('unknown');
    expect(casualtyState({ deaths: 0, injuries: 0 })).toBe('none');
  });

  it('treats a zero on one side as a reported outcome', () => {
    // "ไม่มีผู้เสียชีวิต" with no injury figure is still a statement, not silence.
    expect(casualtyState({ deaths: 0, injuries: null })).toBe('none');
    expect(casualtyState({ deaths: null, injuries: 0 })).toBe('none');
  });

  it('ranks deaths above injuries', () => {
    expect(casualtyState({ deaths: 2, injuries: 5 })).toBe('fatal');
    expect(casualtyState({ deaths: 0, injuries: 5 })).toBe('injury');
    expect(casualtyState({ deaths: null, injuries: 3 })).toBe('injury');
  });
});

describe('casualtyLabel', () => {
  it('renders unknown as ไม่ระบุ and zero as 0', () => {
    expect(casualtyLabel(null)).toBe('ไม่ระบุ');
    expect(casualtyLabel(undefined)).toBe('ไม่ระบุ');
    expect(casualtyLabel(0)).toBe('0');
    expect(casualtyLabel(3)).toBe('3');
  });
});

describe('isAggregateStory', () => {
  it('only flags period/national roundups', () => {
    expect(isAggregateStory({ content_type: 'statistics_roundup' })).toBe(true);
    expect(isAggregateStory({ content_type: 'crash' })).toBe(false);
    expect(isAggregateStory({ content_type: null })).toBe(false);
    expect(isAggregateStory({})).toBe(false);
  });
});

describe('casualtyTotals', () => {
  it('never imputes zero for a story that reported nothing', () => {
    const totals = casualtyTotals([
      story({ deaths: 2, injuries: 1 }),
      story({ deaths: null, injuries: null }),
      story({ deaths: 3, injuries: null })
    ]);
    expect(totals).toEqual({
      deaths: 5, injuries: 1, counted: 2, unknown: 1, aggregate: 0
    });
  });

  it('counts a reported zero as a data point, not an absence', () => {
    const totals = casualtyTotals([
      story({ deaths: 0, injuries: 4 }),
      story({ deaths: null, injuries: null })
    ]);
    expect(totals.counted).toBe(1);
    expect(totals.unknown).toBe(1);
    expect(totals.injuries).toBe(4);
  });

  it('excludes period roundups so a national toll never joins the sum', () => {
    const totals = casualtyTotals([
      story({ deaths: 2, injuries: 1 }),
      story({ deaths: 264, injuries: 1200, content_type: 'statistics_roundup' })
    ]);
    expect(totals).toEqual({
      deaths: 2, injuries: 1, counted: 1, unknown: 0, aggregate: 1
    });
  });

  it('handles an empty feed', () => {
    expect(casualtyTotals([])).toEqual({
      deaths: 0, injuries: 0, counted: 0, unknown: 0, aggregate: 0
    });
  });
});
