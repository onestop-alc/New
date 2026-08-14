/**
 * Runtime-agnostic ingestion pipeline.
 *
 * Node (npm run ingest) and the Supabase Edge Function share this file: only
 * the feed fetcher, the body fetcher and the storage backend differ, so all
 * three are injected. Keep this module free of Node- and Deno-specific APIs.
 */
import { classifyArticle, normalizeForMatch } from './filters.ts';
import { normalizeTitle, isSameStory } from './dedup.ts';
import { CONFIG } from './feeds.ts';
import { canonicalSource } from './sources.ts';
import {
  enrichArticles,
  type ArticleEnrichment,
  type ArticleFacts,
  type FactExtractor
} from './enrich.ts';
import type { BodyFetcher } from './article-text.ts';

export type { ArticleEnrichment, ArticleFacts, FactExtractor };

export interface ArticleInput {
  title: string;
  link: string;
  pubDate: Date;
  source: string;
  summary: string;
}

export interface CandidateStory {
  id: number;
  display_title: string;
  provinces: string[] | null;
  deaths: number | null;
  injuries: number | null;
  /** Bounds a merge between two reports that disagree on the toll. */
  last_published?: string | null;
}

/** One article plus the story fields to use if it starts a new story. */
export interface IngestInput {
  /** Existing story to attach to, or null to create one. */
  storyId: number | null;
  display_title: string;
  norm_title: string;
  trgm_key: string;
  provinces: string[];
  /**
   * Seed values for a newly created story. The authoritative story-level figure
   * is recomputed from every member article by recompute_story_casualties().
   */
  deaths: number | null;
  injuries: number | null;
  source: string;
  /** Stable outlet key — see canonicalSource() in sources.ts. */
  source_key: string;
  /** True when the outlet only republishes; excluded from source_count. */
  aggregator: boolean;
  title: string;
  /** normalizeForMatch(title): catches the same article under another URL. */
  title_key: string;
  url: string;
  summary: string;
  confidence: string;
  published: Date;
}

export interface PendingArticle {
  id: number;
  url: string;
  title: string;
  summary: string;
  source: string;
  published: Date;
}

export interface RunCounters {
  fetched: number;
  passed: number;
  newStories: number;
  merged: number;
  skipped: number;
  errors: number;
  /** Body fetches attempted this run. */
  bodiesFetched?: number;
  /** LLM extraction calls that returned a usable result. */
  llmOk?: number;
  llmErrors?: number;
  detail?: unknown;
}

export interface Store {
  readonly kind: 'postgres' | 'supabase';
  /** Returns only the URLs not already stored — one round trip for the batch. */
  filterNewUrls(urls: string[]): Promise<Set<string>>;
  findCandidates(trgmKey: string, windowStart: Date): Promise<CandidateStory[]>;
  /**
   * Atomic + idempotent (see ingest_article()). `inserted` is false when the
   * article was already stored, possibly under a different URL.
   */
  ingestArticle(input: IngestInput): Promise<{ storyId: number; inserted: boolean }>;
  /**
   * Writes the article-level casualty facts and re-derives the story figure
   * from every member article. Safe to call repeatedly for the same URL.
   */
  saveArticleFacts(url: string, facts: ArticleFacts): Promise<void>;
  /** Articles still carrying regex-only facts, newest first. */
  listPendingExtraction(limit: number): Promise<PendingArticle[]>;
  startRun(): Promise<number>;
  finishRun(runId: number, status: 'ok' | 'error', counters: RunCounters): Promise<void>;
}

/** Thrown when another ingestion run is already in flight. */
export class RunInProgressError extends Error {
  constructor() {
    super('another ingestion run is already in progress');
    this.name = 'RunInProgressError';
  }
}

export const UNIQUE_VIOLATION = '23505';

export interface IngestionResult {
  fetched: number;
  passed: number;
  newStories: number;
  merged: number;
  skipped: number;
  errors: number;
  bodiesFetched?: number;
  llmOk?: number;
  llmErrors?: number;
}

export interface ClassifiedArticle extends ArticleInput {
  confidence: 'high' | 'medium';
  reason: string;
}

export interface DryRunResult extends IngestionResult {
  dryRun: true;
  articles: Array<ClassifiedArticle & { facts: ArticleEnrichment }>;
}

export interface PipelineDeps {
  /** null runs the classifier only (dry run). */
  store: Store | null;
  fetchArticles: () => Promise<ArticleInput[]>;
  /**
   * Optional publisher-page reader. Absent means title+summary only. Bodies are
   * held in memory for the duration of the run and never persisted.
   */
  fetchBody?: BodyFetcher;
  /** Optional LLM extractor. Absent or null leaves the regex facts in place. */
  extractor?: FactExtractor | null;
}

async function findMatchingStory(
  store: Store,
  article: ArticleInput,
  facts: ArticleEnrichment
): Promise<number | null> {
  const windowStart = new Date(
    article.pubDate.getTime() - CONFIG.DEDUP_WINDOW_DAYS * 86_400_000
  );
  const candidates = await store.findCandidates(facts.trgmKey, windowStart);

  const match = candidates.find(candidate =>
    isSameStory(
      {
        title: article.title,
        provinces: facts.provinces,
        deaths: facts.deaths,
        injuries: facts.injuries,
        published: article.pubDate
      },
      {
        title: candidate.display_title,
        provinces: candidate.provinces ?? [],
        deaths: candidate.deaths,
        injuries: candidate.injuries,
        published: candidate.last_published ? new Date(candidate.last_published) : null
      }
    )
  );

  return match ? match.id : null;
}

export async function runPipeline(
  deps: PipelineDeps
): Promise<IngestionResult | DryRunResult | null> {
  const { store } = deps;

  let runId: number | null = null;
  if (store) {
    try {
      runId = await store.startRun();
    } catch (err) {
      if (err instanceof RunInProgressError) {
        console.log('Skipping ingestion: a previous run is still active.');
        return null;
      }
      throw err;
    }
  }

  console.log(`Starting ingestion run (${store ? `writer: ${store.kind}` : 'dry run'})...`);

  const result: IngestionResult = {
    fetched: 0,
    passed: 0,
    newStories: 0,
    merged: 0,
    skipped: 0,
    errors: 0
  };

  try {
    const articles = await deps.fetchArticles();
    result.fetched = articles.length;
    console.log(`Fetched ${articles.length} unique articles from feeds.`);

    const relevant: ClassifiedArticle[] = [];
    // The same article reaches us under different URLs (Google News wraps
    // publisher links, Bing hands back the original), so dedupe on the headline
    // too or one story ends up with two "sources".
    const seenTitles = new Set<string>();
    for (const article of articles) {
      const classification = classifyArticle(article.title, article.summary, article.source);
      if (!classification.passed || classification.confidence === 'none') continue;

      const titleKey = normalizeForMatch(article.title);
      if (seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);

      result.passed++;
      relevant.push({
        ...article,
        confidence: classification.confidence,
        reason: classification.reason
      });
    }

    if (!store) {
      relevant.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
      const dryFacts = await enrichArticles(relevant, deps, result);
      console.log(
        `Dry run: ${result.fetched} fetched, ${result.passed} relevant ` +
        `(${relevant.filter(a => a.confidence === 'high').length} high / ` +
        `${relevant.filter(a => a.confidence === 'medium').length} medium).`
      );
      for (const article of relevant.slice(0, 20)) {
        const facts = dryFacts.get(article.link)!;
        console.log(
          `  [${article.confidence}] ${article.pubDate.toISOString().slice(0, 10)} ` +
          `dead=${fmt(facts.deaths)} hurt=${fmt(facts.injuries)} ` +
          `${facts.facts.casualty_scope === 'aggregate' ? '(aggregate) ' : ''}` +
          `${article.title}  — ${article.source} (${article.reason})`
        );
      }
      return {
        ...result,
        dryRun: true,
        articles: relevant.map(a => ({ ...a, facts: dryFacts.get(a.link)! }))
      };
    }

    // One round trip instead of one per article: everything already stored is
    // dropped before the expensive candidate lookups start.
    const newUrls = await store.filterNewUrls(relevant.map(a => a.link));
    result.skipped = relevant.length - newUrls.size;

    const queue = relevant.filter(article => newUrls.has(article.link));
    // Body fetch and LLM extraction happen here, after filterNewUrls, so their
    // cost scales with genuinely new articles rather than with everything the
    // classifier passed — the same headline resurfaces in Bing for days.
    const enriched = await enrichArticles(queue, deps, result);

    for (const article of queue) {
      try {
        const facts = enriched.get(article.link)!;
        const storyId = await findMatchingStory(store, article, facts);
        const outlet = canonicalSource(article.source);

        const outcome = await store.ingestArticle({
          storyId,
          display_title: article.title,
          norm_title: normalizeTitle(article.title),
          trgm_key: facts.trgmKey,
          provinces: facts.provinces,
          deaths: facts.deaths,
          injuries: facts.injuries,
          source: article.source,
          source_key: outlet.key,
          aggregator: outlet.aggregator,
          title: article.title,
          title_key: normalizeForMatch(article.title),
          url: article.link,
          summary: article.summary,
          confidence: article.confidence,
          published: article.pubDate
        });

        if (!outcome.inserted) result.skipped++;      // same article, other URL
        else if (storyId) result.merged++;
        else result.newStories++;

        // Runs on merges too. In 0010 the story kept whatever the first article
        // said, so a later, better count from another outlet was discarded.
        if (outcome.inserted) {
          await store.saveArticleFacts(article.link, facts.facts);
        }
      } catch (err) {
        result.errors++;
        console.error(`Error processing article ${article.link}:`, err);
      }
    }

    console.log(
      `Ingestion complete. Relevant: ${result.passed}, new: ${result.newStories}, ` +
      `merged: ${result.merged}, already stored: ${result.skipped}, errors: ${result.errors}`
    );

    if (runId !== null) await store.finishRun(runId, 'ok', result);
    return result;
  } catch (err) {
    if (runId !== null) {
      await store!
        .finishRun(runId, 'error', { ...result, detail: { message: String(err) } })
        .catch(logErr => console.error('Failed to record run failure:', logErr));
    }
    throw err;
  }
}

function fmt(value: number | null): string {
  return value === null ? '?' : String(value);
}
