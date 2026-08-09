import {
  DUI_PHRASES,
  ALCOTEST_STRONG,
  ALCOTEST_WEAK,
  CHECKPOINT_STRONG,
  CHECKPOINT_WEAK,
  DRIVING_TERMS,
  ENFORCEMENT_TERMS,
  CRASH_TERMS,
  ALCOHOL_WEAK,
  CAMPAIGN_TERMS,
  NEGATIVE_TERMS,
  PLACE_GUARD,
  EVERGREEN_MARKERS,
  SOFT_SOURCE_BLOCK,
  HARD_SOURCE_BLOCK
} from './feeds.js';

export interface FilterResult {
  passed: boolean;
  confidence: 'high' | 'medium' | 'none';
  reason: string;
}

/**
 * Thai headlines need normalising before substring matching:
 *  - `เเ` (two SARA E) is a near-universal web typo for `แ`, and it silently
 *    breaks every DUI phrase match
 *  - separators split phrases ("สาวเมา ขับรถชน" would miss "เมาขับ")
 * Keyword lists are written unspaced so they compare against this output.
 * Note `toLowerCase` only matters for the Latin fragments (มก.%, source names).
 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/เเ/g, 'แ')
    .replace(/[\s​﻿ \-–—_/·|"'“”‘’!?,()[\]{}]+/g, '')
    .toLowerCase();
}

const normalizedCache = new Map<string[], string[]>();

function normalizedList(list: string[]): string[] {
  let cached = normalizedCache.get(list);
  if (!cached) {
    cached = list.map(normalizeForMatch);
    normalizedCache.set(list, cached);
  }
  return cached;
}

function hit(text: string, list: string[]): string | undefined {
  return normalizedList(list).find(term => text.includes(term));
}

/**
 * Two-axis classifier: alcohol evidence x driving/enforcement context.
 * A single strong DUI/alcotest/checkpoint phrase stands alone; everything else
 * needs corroboration, which is what keeps bar raids, liquor tax and
 * ประชาชน-style substring collisions out of the feed.
 */
export function classifyArticle(title: string, summary: string, source = ''): FilterResult {
  const src = source.toLowerCase();
  if (HARD_SOURCE_BLOCK.some(blocked => src.includes(blocked))) {
    return { passed: false, confidence: 'none', reason: `blocked source: ${source}` };
  }

  let titleText = normalizeForMatch(title);
  let fullText = normalizeForMatch(`${title} ${summary}`);
  // "สุราษฎร์ธานี" contains "สุรา" — strip place names before matching.
  for (const place of PLACE_GUARD) {
    const normalized = normalizeForMatch(place);
    titleText = titleText.split(normalized).join('');
    fullText = fullText.split(normalized).join('');
  }

  const duiTitle = hit(titleText, DUI_PHRASES);
  const duiBody = hit(fullText, DUI_PHRASES);

  // Compare like with like: a negative term in the summary must not veto an
  // article whose DUI evidence is also in the summary.
  const negative = hit(fullText, NEGATIVE_TERMS);
  if (negative && !duiBody) {
    return { passed: false, confidence: 'none', reason: `negative: ${negative}` };
  }

  const alcotestStrong = hit(fullText, ALCOTEST_STRONG);
  const alcotestWeak = hit(fullText, ALCOTEST_WEAK);
  const checkpointStrong = hit(fullText, CHECKPOINT_STRONG);
  const checkpointWeak = hit(fullText, CHECKPOINT_WEAK);
  const driving = hit(fullText, DRIVING_TERMS);
  const enforcement = hit(fullText, ENFORCEMENT_TERMS);
  const crash = hit(fullText, CRASH_TERMS);
  const alcohol = hit(fullText, ALCOHOL_WEAK);
  const campaign = hit(fullText, CAMPAIGN_TERMS);

  let level: 'high' | 'medium';
  let reason: string;

  if (duiTitle) {
    level = 'high'; reason = `dui-title: ${duiTitle}`;
  } else if (alcotestStrong) {
    level = 'high'; reason = `alcotest: ${alcotestStrong}`;
  } else if (checkpointStrong) {
    level = 'high'; reason = `checkpoint: ${checkpointStrong}`;
  } else if (duiBody) {
    level = 'medium'; reason = `dui-body: ${duiBody}`;
  } else if (alcotestWeak && (driving || enforcement || checkpointWeak)) {
    level = 'high'; reason = `alcotest-weak: ${alcotestWeak}`;
  } else if (checkpointWeak && alcohol && (driving || enforcement)) {
    level = 'medium'; reason = `checkpoint-weak: ${checkpointWeak}`;
  } else if (alcohol && driving && (crash || enforcement)) {
    level = 'medium'; reason = `alcohol+driving: ${alcohol}`;
  } else if (campaign && driving) {
    level = 'medium'; reason = `campaign: ${campaign}`;
  } else {
    return { passed: false, confidence: 'none', reason: 'no matching criteria' };
  }

  // Evergreen explainers and social reposts are real but never primary.
  const evergreen = hit(fullText, EVERGREEN_MARKERS);
  const social = SOFT_SOURCE_BLOCK.some(blocked => src.includes(blocked));
  if (level === 'high' && (evergreen || social)) {
    level = 'medium';
    if (evergreen) reason += ` +evergreen: ${evergreen}`;
    if (social) reason += ' +social';
  }

  return { passed: true, confidence: level, reason };
}
