import { Pool } from 'pg';
import { createSupabaseStore } from '../../../supabase/functions/_shared/store-supabase.ts';
import { CONFIG } from '../../../supabase/functions/_shared/feeds.ts';
import {
  RunInProgressError,
  UNIQUE_VIOLATION,
  type CandidateStory,
  type IngestInput,
  type PendingArticle,
  type Store
} from '../../../supabase/functions/_shared/pipeline.ts';

export { RunInProgressError };
export type { Store };

function ingestArgs(input: IngestInput) {
  return [
    input.storyId,
    input.display_title,
    input.norm_title,
    input.trgm_key,
    input.provinces,
    input.deaths,
    input.injuries,
    input.source,
    input.source_key,
    input.aggregator,
    input.title,
    input.title_key,
    input.url,
    input.summary,
    input.confidence,
    input.published
  ];
}

/** Direct Postgres connection (DATABASE_URL). */
function createPostgresStore(connectionString: string): Store {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  return {
    kind: 'postgres',

    async filterNewUrls(urls) {
      if (urls.length === 0) return new Set();
      const { rows } = await pool.query<{ filter_new_urls: string }>(
        'SELECT filter_new_urls FROM filter_new_urls($1::text[])',
        [urls]
      );
      return new Set(rows.map(row => row.filter_new_urls));
    },

    async findCandidates(trgmKey, windowStart, provinces) {
      const { rows } = await pool.query<CandidateStory>(
        `SELECT id, display_title, provinces, deaths, injuries, last_published
           FROM find_candidate_stories($1, $2, $3, $4::text[])`,
        // null, not [], so the SQL keeps its trigram-only path.
        [trgmKey, windowStart, CONFIG.SIMILARITY_THRESHOLD, provinces.length > 0 ? provinces : null]
      );
      return rows;
    },

    async ingestArticle(input) {
      const { rows } = await pool.query<{ story_id: string; inserted: boolean }>(
        `SELECT story_id, inserted
           FROM ingest_article($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        ingestArgs(input)
      );
      return { storyId: Number(rows[0].story_id), inserted: rows[0].inserted };
    },

    async saveArticleFacts(url, facts) {
      await pool.query('SELECT upsert_article_facts($1, $2::jsonb)', [
        url,
        JSON.stringify(facts)
      ]);
    },

    async listPendingExtraction(limit) {
      const { rows } = await pool.query<PendingArticle>(
        `SELECT id, url, title, summary, source, published
           FROM articles_pending_extraction($1)`,
        [limit]
      );
      return rows;
    },

    async startRun() {
      try {
        const { rows } = await pool.query<{ id: number }>(
          `INSERT INTO ingest_runs (status) VALUES ('running') RETURNING id`
        );
        return rows[0].id;
      } catch (err) {
        if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new RunInProgressError();
        throw err;
      }
    },

    async finishRun(runId, status, counters) {
      await pool.query(
        `UPDATE ingest_runs
            SET status = $1, finished_at = now(),
                fetched = $2, passed = $3, new_stories = $4,
                merged = $5, skipped = $6, errors = $7, detail = $8
          WHERE id = $9`,
        [
          status,
          counters.fetched,
          counters.passed,
          counters.newStories,
          counters.merged,
          counters.skipped,
          counters.errors,
          counters.detail ? JSON.stringify(counters.detail) : null,
          runId
        ]
      );
    }
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
