/**
 * Fact enrichment: the one place an article's casualty figures are produced.
 *
 * The regex reading is computed for every article first and is never discarded,
 * so a missing API key, a rate limit, a refusal or a timeout degrades to today's
 * behaviour instead of failing the run. The LLM, when configured, only ever
 * improves on that baseline — and in shadow mode it does not even do that: both
 * numbers are written and the regex stays authoritative.
 */
import { readCasualties, CASUALTY_EXTRACTOR_VERSION } from './casualties.ts';
import { extractProvinces, extractTrgmKey } from './dedup.ts';
import { CONFIG } from './feeds.ts';
import type { ArticleInput, RunCounters } from './pipeline.ts';
import type { BodyFetcher, BodyResult } from './article-text.ts';

export type ExtractorMode = 'off' | 'shadow' | 'live';

export interface ArticleFacts {
  deaths: number | null;
  injuries: number | null;
  /** Always the regex reading, whatever produced `deaths`. Drift monitoring. */
  regex_deaths: number | null;
  regex_injuries: number | null;
  deaths_evidence: string | null;
  injuries_evidence: string | null;
  deaths_confidence: number | null;
  injuries_confidence: number | null;
  casualty_scope: 'incident' | 'aggregate';
  casualty_field: string | null;
  casualty_snippet: string | null;
  content_type: string | null;
  alcohol_involved: string | null;
  article_provinces: string[];
  extractor: 'regex' | 'llm' | 'manual';
  extractor_model: string | null;
  extract_confidence: string | null;
  extractor_version: number;
  /** Validated model output, including basis and quote. Null for regex. */
  payload: unknown | null;
}

export interface ArticleEnrichment {
  provinces: string[];
  trgmKey: string;
  deaths: number | null;
  injuries: number | null;
  facts: ArticleFacts;
}

/** What an LLM extractor must provide. Implemented by extract-llm.ts. */
export interface FactExtractor {
  readonly mode: ExtractorMode;
  readonly model: string;
  /** Hard ceiling on calls per run, for cost. */
  readonly maxCalls: number;
  /** Wall-clock budget for the whole enrichment phase, in ms. */
  readonly deadlineMs: number;
  /** Returns null when the result did not validate — caller keeps the regex. */
  extract(article: ArticleInput, bodyText: string): Promise<LlmExtraction | null>;
}

export interface LlmCount {
  value: number | null;
  basis: 'stated' | 'inferred' | 'not_mentioned';
  quote: string | null;
}

export interface LlmExtraction {
  content_type: string;
  alcohol_involved: string;
  deaths: LlmCount;
  injuries: LlmCount;
  provinces: string[];
  vehicles: string[];
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
}

/** The deterministic baseline. Also used by the backfill script. */
export function regexFacts(
  article: Pick<ArticleInput, 'title' | 'summary'>,
  body?: string
): ArticleEnrichment {
  const reading = readCasualties({
    title: article.title,
    summary: article.summary,
    body
  });

  // Provinces stay on title+summary. Article bodies routinely name the province
  // of a quoted official, which is not where the crash happened.
  const provinces = extractProvinces(`${article.title} ${article.summary}`);

  return {
    provinces,
    trgmKey: extractTrgmKey(article.title),
    deaths: reading.deaths.value,
    injuries: reading.injuries.value,
    facts: {
      deaths: reading.deaths.value,
      injuries: reading.injuries.value,
      regex_deaths: reading.deaths.value,
      regex_injuries: reading.injuries.value,
      deaths_evidence: reading.deaths.evidence,
      injuries_evidence: reading.injuries.evidence,
      deaths_confidence: reading.deaths.value === null ? null : reading.deaths.confidence,
      injuries_confidence: reading.injuries.value === null ? null : reading.injuries.confidence,
      casualty_scope: reading.deaths.scope,
      casualty_field: reading.deaths.field ?? reading.injuries.field,
      casualty_snippet: reading.deaths.snippet ?? reading.injuries.snippet,
      content_type: null,
      alcohol_involved: null,
      article_provinces: provinces,
      extractor: 'regex',
      extractor_model: null,
      extract_confidence: null,
      extractor_version: CASUALTY_EXTRACTOR_VERSION,
      payload: null
    }
  };
}

/** Bodies are only worth fetching when title+summary left the toll uncertain. */
function needsBody(enrichment: ArticleEnrichment): boolean {
  const confidence = enrichment.facts.deaths_confidence;
  return enrichment.deaths === null || (confidence ?? 0) < CONFIG.BODY_FETCH_MIN_CONFIDENCE;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

export interface EnrichDeps {
  fetchBody?: BodyFetcher;
  extractor?: FactExtractor | null;
}

/**
 * Every article in the queue gets an entry, always. The returned map is safe to
 * index without a null check.
 */
export async function enrichArticles(
  queue: ArticleInput[],
  deps: EnrichDeps,
  counters: RunCounters
): Promise<Map<string, ArticleEnrichment>> {
  const out = new Map<string, ArticleEnrichment>();
  for (const article of queue) out.set(article.link, regexFacts(article));

  const { fetchBody, extractor } = deps;
  // Whether either is enabled is decided once, in runtime-config.ts: a fetcher
  // or extractor that reaches here is one the operator turned on.
  const wantsBody = Boolean(fetchBody);
  const wantsLlm = Boolean(extractor) && extractor!.mode !== 'off';
  if (!wantsBody && !wantsLlm) return out;

  const deadline = Date.now() + (extractor?.deadlineMs ?? CONFIG.BODY_FETCH_BUDGET_MS);
  let bodyBudget = CONFIG.BODY_FETCH_MAX_PER_RUN;
  let llmBudget = extractor?.maxCalls ?? 0;
  // A dead API would otherwise burn the whole deadline on timeouts and starve
  // the write phase.
  let consecutiveLlmFailures = 0;

  const bodies = new Map<string, BodyResult>();

  await mapWithConcurrency(queue, CONFIG.BODY_FETCH_CONCURRENCY, async article => {
    if (Date.now() > deadline) return;
    const base = out.get(article.link)!;

    let body: BodyResult | null = null;
    if (wantsBody && bodyBudget > 0 && needsBody(base)) {
      bodyBudget--;
      body = await fetchBody!(article.link);
      if (body) {
        bodies.set(article.link, body);
        counters.bodiesFetched = (counters.bodiesFetched ?? 0) + 1;
        // Re-read with the body in play; regexFacts is cheap and pure.
        out.set(article.link, regexFacts(article, body.text));
      }
    }

    if (!wantsLlm || llmBudget <= 0 || consecutiveLlmFailures >= 3) return;
    if (Date.now() > deadline) return;
    llmBudget--;

    const text = body?.text || article.summary || '';
    try {
      const llm = await extractor!.extract(article, text);
      if (!llm) {
        consecutiveLlmFailures++;
        return;
      }
      consecutiveLlmFailures = 0;
      counters.llmOk = (counters.llmOk ?? 0) + 1;
      out.set(
        article.link,
        mergeLlmFacts(out.get(article.link)!, llm, extractor!)
      );
    } catch (err) {
      consecutiveLlmFailures++;
      counters.llmErrors = (counters.llmErrors ?? 0) + 1;
      console.error(`LLM extraction failed for ${article.link}:`, err);
    }
  });

  return out;
}

const CONFIDENCE_SCORE: Record<string, number> = { high: 0.95, medium: 0.75, low: 0.4 };

/**
 * In shadow mode the LLM output is recorded but the regex figure stays on the
 * article, so nothing user-visible changes while the two are being compared.
 */
export function mergeLlmFacts(
  base: ArticleEnrichment,
  llm: LlmExtraction,
  extractor: Pick<FactExtractor, 'mode' | 'model'>
): ArticleEnrichment {
  const aggregate = llm.content_type === 'statistics_roundup';
  const facts: ArticleFacts = {
    ...base.facts,
    content_type: llm.content_type,
    alcohol_involved: llm.alcohol_involved,
    extractor_model: extractor.model,
    extract_confidence: llm.confidence,
    payload: llm
  };

  if (extractor.mode !== 'live') {
    return { ...base, facts };
  }

  const score = CONFIDENCE_SCORE[llm.confidence] ?? 0.5;
  const provinces = llm.provinces.length ? llm.provinces : base.provinces;

  return {
    ...base,
    provinces,
    deaths: llm.deaths.value,
    injuries: llm.injuries.value,
    facts: {
      ...facts,
      deaths: llm.deaths.value,
      injuries: llm.injuries.value,
      deaths_evidence: llm.deaths.basis,
      injuries_evidence: llm.injuries.basis,
      deaths_confidence: llm.deaths.value === null ? null : score,
      injuries_confidence: llm.injuries.value === null ? null : score,
      casualty_scope: aggregate ? 'aggregate' : base.facts.casualty_scope,
      casualty_snippet: llm.deaths.quote ?? llm.injuries.quote ?? base.facts.casualty_snippet,
      article_provinces: provinces,
      extractor: 'llm'
    }
  };
}
