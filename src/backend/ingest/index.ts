import { Pool } from 'pg';
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

let pool: Pool | null = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

export async function runIngestion() {
  console.log("Starting ingestion run...");
  if (!process.env.DATABASE_URL) {
    console.log("Skipping ingestion: DATABASE_URL not configured.");
    return;
  }
  
  const db = getPool();
  const articles = await fetchAllFeeds();
  console.log(`Fetched ${articles.length} unique articles from feeds.`);

  let newStoriesCount = 0;
  let mergedStoriesCount = 0;

  for (const article of articles) {
    try {
      // 1. Filter
      const classification = classifyArticle(article.title, article.summary);
      if (!classification.passed) {
        continue; // Skip
      }

      const normTitle = normalizeTitle(article.title);
      const trgmKey = extractTrgmKey(article.title);
      const provinces = extractProvinces(`${article.title} ${article.summary}`);
      const deaths = extractDeaths(article.title);
      const injuries = extractInjuries(article.title);

      // 2. Dedup (Check if URL already exists first for idempotency)
      const existingArticle = await db.query('SELECT id FROM articles WHERE url = $1', [article.link]);
      if (existingArticle.rows.length > 0) {
        continue; // Already processed
      }

      // Find candidate stories within the time window
      const windowStart = subDays(article.pubDate, CONFIG.DEDUP_WINDOW_DAYS);
      const windowEnd = new Date();
      
      // We use our custom function if available, or just a raw query
      // The trgm % operator uses similarity threshold. We set it first.
      await db.query(`SET pg_trgm.similarity_threshold = ${CONFIG.SIMILARITY_THRESHOLD}`);
      
      const candidatesRes = await db.query(`
        SELECT id, display_title, provinces, deaths, injuries 
        FROM stories 
        WHERE first_published >= $1 
          AND trgm_key % $2
        ORDER BY similarity(trgm_key, $2) DESC
      `, [windowStart, trgmKey]);

      let matchedStoryId = null;

      for (const candidate of candidatesRes.rows) {
        const isSame = isSameStory(
          article.title, candidate.display_title,
          provinces, candidate.provinces,
          deaths, candidate.deaths,
          injuries, candidate.injuries
        );
        if (isSame) {
          matchedStoryId = candidate.id;
          break;
        }
      }

      // 3. Insert or Update
      if (matchedStoryId) {
        // Merge into existing story
        await db.query(`
          UPDATE stories 
          SET source_count = source_count + 1,
              last_published = GREATEST(last_published, $1)
          WHERE id = $2
        `, [article.pubDate, matchedStoryId]);

        await db.query(`
          INSERT INTO articles (story_id, source, title, url, summary, confidence, published)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [matchedStoryId, article.source, article.title, article.link, article.summary, classification.confidence, article.pubDate]);
        
        mergedStoriesCount++;
      } else {
        // Create new story
        const insertStoryRes = await db.query(`
          INSERT INTO stories (display_title, norm_title, trgm_key, provinces, deaths, injuries, first_published, last_published)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [article.title, normTitle, trgmKey, provinces, deaths, injuries, article.pubDate, article.pubDate]);
        
        const newStoryId = insertStoryRes.rows[0].id;
        
        await db.query(`
          INSERT INTO articles (story_id, source, title, url, summary, confidence, published)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [newStoryId, article.source, article.title, article.link, article.summary, classification.confidence, article.pubDate]);
        
        newStoriesCount++;
      }
    } catch (err) {
      console.error(`Error processing article ${article.link}:`, err);
    }
  }

  console.log(`Ingestion complete. New stories: ${newStoriesCount}, Merged: ${mergedStoriesCount}`);
}
