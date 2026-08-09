import { Pool } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CONFIG } from './feeds.js';

export interface CandidateStory {
  id: number;
  display_title: string;
  provinces: string[];
  deaths: number | null;
  injuries: number | null;
}

export interface StoryInput {
  display_title: string;
  norm_title: string;
  trgm_key: string;
  provinces: string[];
  deaths: number | null;
  injuries: number | null;
  first_published: Date;
}

export interface ArticleRow {
  story_id: number;
  source: string;
  title: string;
  url: string;
  summary: string;
  confidence: string;
  published: Date;
}

export interface Store {
  readonly kind: 'postgres' | 'supabase';
  articleExists(url: string): Promise<boolean>;
  findCandidates(trgmKey: string, windowStart: Date): Promise<CandidateStory[]>;
  insertStory(story: StoryInput): Promise<number>;
  bumpStory(storyId: number, published: Date): Promise<void>;
  insertArticle(article: ArticleRow): Promise<void>;
}

/** Direct Postgres connection (DATABASE_URL). */
function createPostgresStore(connectionString: string): Store {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  return {
    kind: 'postgres',

    async articleExists(url) {
      const { rows } = await pool.query('SELECT 1 FROM articles WHERE url = $1', [url]);
      return rows.length > 0;
    },

    async findCandidates(trgmKey, windowStart) {
      const { rows } = await pool.query(
        `SELECT id, display_title, provinces, deaths, injuries
         FROM stories
         WHERE first_published >= $1
           AND similarity(trgm_key, $2) >= $3
         ORDER BY similarity(trgm_key, $2) DESC
         LIMIT 20`,
        [windowStart, trgmKey, CONFIG.SIMILARITY_THRESHOLD]
      );
      return rows;
    },

    async insertStory(story) {
      const { rows } = await pool.query(
        `INSERT INTO stories (display_title, norm_title, trgm_key, provinces, deaths, injuries, first_published, last_published)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING id`,
        [
          story.display_title,
          story.norm_title,
          story.trgm_key,
          story.provinces,
          story.deaths,
          story.injuries,
          story.first_published,
        ]
      );
      return rows[0].id;
    },

    async bumpStory(storyId, published) {
      await pool.query(
        `UPDATE stories
         SET source_count = source_count + 1,
             last_published = GREATEST(last_published, $1)
         WHERE id = $2`,
        [published, storyId]
      );
    },

    async insertArticle(article) {
      await pool.query(
        `INSERT INTO articles (story_id, source, title, url, summary, confidence, published)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (url) DO NOTHING`,
        [
          article.story_id,
          article.source,
          article.title,
          article.url,
          article.summary,
          article.confidence,
          article.published,
        ]
      );
    },
  };
}

/** Supabase REST with the service_role key (bypasses RLS). */
function createSupabaseStore(url: string, serviceRoleKey: string): Store {
  const client: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const fail = (context: string, error: { message: string } | null) => {
    if (error) throw new Error(`${context}: ${error.message}`);
  };

  return {
    kind: 'supabase',

    async articleExists(articleUrl) {
      const { data, error } = await client
        .from('articles')
        .select('id')
        .eq('url', articleUrl)
        .limit(1);
      fail('articleExists', error);
      return (data?.length ?? 0) > 0;
    },

    async findCandidates(trgmKey, windowStart) {
      const { data, error } = await client.rpc('find_candidate_stories', {
        search_key: trgmKey,
        window_start: windowStart.toISOString(),
        threshold: CONFIG.SIMILARITY_THRESHOLD,
      });
      fail('findCandidates', error);
      return (data ?? []) as CandidateStory[];
    },

    async insertStory(story) {
      const published = story.first_published.toISOString();
      const { data, error } = await client
        .from('stories')
        .insert({
          display_title: story.display_title,
          norm_title: story.norm_title,
          trgm_key: story.trgm_key,
          provinces: story.provinces,
          deaths: story.deaths,
          injuries: story.injuries,
          first_published: published,
          last_published: published,
        })
        .select('id')
        .single();
      fail('insertStory', error);
      return (data as { id: number }).id;
    },

    async bumpStory(storyId, published) {
      const { data, error } = await client
        .from('stories')
        .select('source_count, last_published')
        .eq('id', storyId)
        .single();
      fail('bumpStory/read', error);

      const current = data as { source_count: number; last_published: string };
      const last =
        new Date(current.last_published) > published
          ? current.last_published
          : published.toISOString();

      const { error: updateError } = await client
        .from('stories')
        .update({ source_count: (current.source_count ?? 0) + 1, last_published: last })
        .eq('id', storyId);
      fail('bumpStory/update', updateError);
    },

    async insertArticle(article) {
      const { error } = await client.from('articles').upsert(
        {
          story_id: article.story_id,
          source: article.source,
          title: article.title,
          url: article.url,
          summary: article.summary,
          confidence: article.confidence,
          published: article.published.toISOString(),
        },
        { onConflict: 'url', ignoreDuplicates: true }
      );
      fail('insertArticle', error);
    },
  };
}

/**
 * Picks a writer backend from the environment:
 *   DATABASE_URL                → direct Postgres
 *   SUPABASE_SERVICE_ROLE_KEY   → Supabase REST
 * Returns null when neither is configured, so ingestion can be skipped.
 */
export function createStore(): Store | null {
  if (process.env.DATABASE_URL) {
    return createPostgresStore(process.env.DATABASE_URL);
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceRoleKey) {
    return createSupabaseStore(url, serviceRoleKey);
  }

  return null;
}
