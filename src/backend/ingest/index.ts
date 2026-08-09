import { fetchAllFeeds, type ArticleInput } from './rss.js';
import { classifyArticle } from './filters.js';
import {
  normalizeTitle,
  extractTrgmKey,
  extractDeaths,
  extractInjuries,
  extractProvinces,
  isSameStory
} from './dedup.js';
import { subDays } from 'date-fns';
import { CONFIG } from './feeds.js';
import { createStore, RunInProgressError, type Store } from './store.js';

export interface IngestionResult {
  fetched: number;
  passed: number;
  newStories: number;
  merged: number;
  skipped: number;
  errors: number;
}

export interface IngestionOptions {
  /** Classify only, never touch the database. */
  dryRun?: boolean;
  /** Include the archive-heavy seasonal queries. */
  seasonal?: boolean;
}

export interface ClassifiedArticle extends ArticleInput {
  confidence: 'high' | 'medium';
  reason: string;
}

export interface DryRunResult extends IngestionResult {
  dryRun: true;
  articles: ClassifiedArticle[];
}

/** Everything derived from an article's text, shared by both code paths. */
function extractFacts(article: ArticleInput) {
  return {
    provinces: extractProvinces(`${article.title} ${article.summary}`),
    deaths: extractDeaths(article.title),
    injuries: extractInjuries(article.title),
    trgmKey: extractTrgmKey(article.title)
  };
}

async function findMatchingStory(
  store: Store,
  article: ArticleInput,
  facts: ReturnType<typeof extractFacts>
): Promise<number | null> {
  const windowStart = subDays(article.pubDate, CONFIG.DEDUP_WINDOW_DAYS);
  const candidates = await store.findCandidates(facts.trgmKey, windowStart);

  const match = candidates.find(candidate =>
    isSameStory(
      article.title, candidate.display_title,
      facts.provinces, candidate.provinces ?? [],
      facts.deaths, candidate.deaths,
      facts.injuries, candidate.injuries
    )
  );

  return match ? match.id : null;
}

export async function runIngestion(
  options: IngestionOptions = {}
): Promise<IngestionResult | DryRunResult | null> {
  const store = options.dryRun ? null : createStore();
  if (!options.dryRun && !store) {
    console.log(
      'Skipping ingestion: set DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
    return null;
  }

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

  console.log(
    `Starting ingestion run (${options.dryRun ? 'dry run' : `writer: ${store!.kind}`})...`
  );

  const result: IngestionResult = {
    fetched: 0,
    passed: 0,
    newStories: 0,
    merged: 0,
    skipped: 0,
    errors: 0
  };
  const classified: ClassifiedArticle[] = [];

  try {
    const articles = await fetchAllFeeds({ seasonal: options.seasonal });
    result.fetched = articles.length;
    console.log(`Fetched ${articles.length} unique articles from feeds.`);

    const relevant: ClassifiedArticle[] = [];
    for (const article of articles) {
      const classification = classifyArticle(article.title, article.summary, article.source);
      if (!classification.passed || classification.confidence === 'none') continue;
      result.passed++;
      relevant.push({ ...article, confidence: classification.confidence, reason: classification.reason });
    }

    if (options.dryRun) {
      classified.push(...relevant);
      relevant.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
      console.log(
        `Dry run: ${result.fetched} fetched, ${result.passed} relevant ` +
        `(${relevant.filter(a => a.confidence === 'high').length} high / ` +
        `${relevant.filter(a => a.confidence === 'medium').length} medium).`
      );
      for (const article of relevant.slice(0, 10)) {
        console.log(
          `  [${article.confidence}] ${article.pubDate.toISOString().slice(0, 10)} ` +
          `${article.title}  — ${article.source} (${article.reason})`
        );
      }
      return { ...result, dryRun: true, articles: classified };
    }

    // One round trip instead of one per article: everything already stored is
    // dropped before the expensive candidate lookups start.
    const newUrls = await store!.filterNewUrls(relevant.map(a => a.link));
    result.skipped = relevant.length - newUrls.size;

    for (const article of relevant) {
      if (!newUrls.has(article.link)) continue;
      try {
        const facts = extractFacts(article);
        const storyId = await findMatchingStory(store!, article, facts);

        await store!.ingestArticle({
          storyId,
          display_title: article.title,
          norm_title: normalizeTitle(article.title),
          trgm_key: facts.trgmKey,
          provinces: facts.provinces,
          deaths: facts.deaths,
          injuries: facts.injuries,
          source: article.source,
          title: article.title,
          url: article.link,
          summary: article.summary,
          confidence: article.confidence,
          published: article.pubDate
        });

        if (storyId) result.merged++;
        else result.newStories++;
      } catch (err) {
        result.errors++;
        console.error(`Error processing article ${article.link}:`, err);
      }
    }

    console.log(
      `Ingestion complete. Relevant: ${result.passed}, new: ${result.newStories}, ` +
      `merged: ${result.merged}, already stored: ${result.skipped}, errors: ${result.errors}`
    );

    if (runId !== null) await store!.finishRun(runId, 'ok', result);
    return result;
  } catch (err) {
    if (runId !== null && store) {
      await store
        .finishRun(runId, 'error', { ...result, detail: { message: String(err) } })
        .catch(logErr => console.error('Failed to record run failure:', logErr));
    }
    throw err;
  }
}
