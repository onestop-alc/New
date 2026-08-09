import { fetchAllFeeds } from './rss.js';
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
import { createStore } from './store.js';

export interface IngestionResult {
  fetched: number;
  passed: number;
  newStories: number;
  merged: number;
  skipped: number;
  errors: number;
}

export async function runIngestion(): Promise<IngestionResult | null> {
  const store = createStore();
  if (!store) {
    console.log(
      'Skipping ingestion: set DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
    return null;
  }

  console.log(`Starting ingestion run (writer: ${store.kind})...`);

  const articles = await fetchAllFeeds();
  console.log(`Fetched ${articles.length} unique articles from feeds.`);

  const result: IngestionResult = {
    fetched: articles.length,
    passed: 0,
    newStories: 0,
    merged: 0,
    skipped: 0,
    errors: 0
  };

  for (const article of articles) {
    try {
      const classification = classifyArticle(article.title, article.summary);
      if (!classification.passed) continue;
      result.passed++;

      if (await store.articleExists(article.link)) {
        result.skipped++;
        continue;
      }

      const provinces = extractProvinces(`${article.title} ${article.summary}`);
      const deaths = extractDeaths(article.title);
      const injuries = extractInjuries(article.title);
      const trgmKey = extractTrgmKey(article.title);

      const windowStart = subDays(article.pubDate, CONFIG.DEDUP_WINDOW_DAYS);
      const candidates = await store.findCandidates(trgmKey, windowStart);

      const match = candidates.find(candidate =>
        isSameStory(
          article.title, candidate.display_title,
          provinces, candidate.provinces,
          deaths, candidate.deaths,
          injuries, candidate.injuries
        )
      );

      let storyId: number;
      if (match) {
        await store.bumpStory(match.id, article.pubDate);
        storyId = match.id;
        result.merged++;
      } else {
        storyId = await store.insertStory({
          display_title: article.title,
          norm_title: normalizeTitle(article.title),
          trgm_key: trgmKey,
          provinces,
          deaths,
          injuries,
          first_published: article.pubDate
        });
        result.newStories++;
      }

      await store.insertArticle({
        story_id: storyId,
        source: article.source,
        title: article.title,
        url: article.link,
        summary: article.summary,
        confidence: classification.confidence,
        published: article.pubDate
      });
    } catch (err) {
      result.errors++;
      console.error(`Error processing article ${article.link}:`, err);
    }
  }

  console.log(
    `Ingestion complete. Matched filters: ${result.passed}, new: ${result.newStories}, ` +
    `merged: ${result.merged}, already stored: ${result.skipped}, errors: ${result.errors}`
  );
  return result;
}
