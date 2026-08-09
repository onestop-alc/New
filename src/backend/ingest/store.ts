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

/** One article plus the story fields to use if it starts a new story. */
export interface IngestInput {
  /** Existing story to attach to, or null to create one. */
  storyId: number | null;
  display_title: string;
  norm_title: string;
  trgm_key: string;
  provinces: string[];
  deaths: number | null;
  injuries: number | null;
  source: string;
  title: string;
  url: string;
  summary: string;
  confidence: string;
  published: Date;
}

export interface RunCounters {
  fetched: number;
  passed: number;
  newStories: number;
  merged: number;
  skipped: number;
  errors: number;
  detail?: unknown;
}

/** Thrown when another ingestion run is already in flight. */
export class RunInProgressError extends Error {
  constructor() {
    super('another ingestion run is already in progress');
    this.name = 'RunInProgressError';
  }
}

const UNIQUE_VIOLATION = '23505';

export interface Store {
  readonly kind: 'postgres' | 'supabase';
  /** Returns only the URLs not already stored — one round trip for the batch. */
  filterNewUrls(urls: string[]): Promise<Set<string>>;
  findCandidates(trgmKey: string, windowStart: Date): Promise<CandidateStory[]>;
  /** Atomic + idempotent: see ingest_article() in 0005_ingest_rpc.sql. */
  ingestArticle(input: IngestInput): Promise<number>;
  startRun(): Promise<number>;
  finishRun(runId: number, status: 'ok' | 'error', counters: RunCounters): Promise<void>;
}

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
    input.title,
    input.url,
    input.summary,
    input.confidence,
    input.published
  ] as const;
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

    async findCandidates(trgmKey, windowStart) {
      const { rows } = await pool.query<CandidateStory>(
        'SELECT id, display_title, provinces, deaths, injuries FROM find_candidate_stories($1, $2, $3)',
        [trgmKey, windowStart, CONFIG.SIMILARITY_THRESHOLD]
      );
      return rows;
    },

    async ingestArticle(input) {
      const { rows } = await pool.query<{ ingest_article: number }>(
        `SELECT ingest_article($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $12, $13)`,
        [...ingestArgs(input)]
      );
      return rows[0].ingest_article;
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

/** Supabase REST with the service_role key (bypasses RLS). */
function createSupabaseStore(url: string, serviceRoleKey: string): Store {
  const client: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const fail = (context: string, error: { message: string } | null) => {
    if (error) throw new Error(`${context}: ${error.message}`);
  };

  return {
    kind: 'supabase',

    async filterNewUrls(urls) {
      if (urls.length === 0) return new Set();
      const { data, error } = await client.rpc('filter_new_urls', { urls });
      fail('filterNewUrls', error);
      return new Set((data ?? []) as string[]);
    },

    async findCandidates(trgmKey, windowStart) {
      const { data, error } = await client.rpc('find_candidate_stories', {
        search_key: trgmKey,
        window_start: windowStart.toISOString(),
        threshold: CONFIG.SIMILARITY_THRESHOLD
      });
      fail('findCandidates', error);
      return (data ?? []) as CandidateStory[];
    },

    async ingestArticle(input) {
      const { data, error } = await client.rpc('ingest_article', {
        p_story_id: input.storyId,
        p_display_title: input.display_title,
        p_norm_title: input.norm_title,
        p_trgm_key: input.trgm_key,
        p_provinces: input.provinces,
        p_deaths: input.deaths,
        p_injuries: input.injuries,
        p_source: input.source,
        p_title: input.title,
        p_url: input.url,
        p_summary: input.summary,
        p_confidence: input.confidence,
        p_published: input.published.toISOString()
      });
      fail('ingestArticle', error);
      return data as number;
    },

    async startRun() {
      const { data, error } = await client
        .from('ingest_runs')
        .insert({ status: 'running' })
        .select('id')
        .single();
      if (error?.code === UNIQUE_VIOLATION) throw new RunInProgressError();
      fail('startRun', error);
      return (data as { id: number }).id;
    },

    async finishRun(runId, status, counters) {
      const { error } = await client
        .from('ingest_runs')
        .update({
          status,
          finished_at: new Date().toISOString(),
          fetched: counters.fetched,
          passed: counters.passed,
          new_stories: counters.newStories,
          merged: counters.merged,
          skipped: counters.skipped,
          errors: counters.errors,
          detail: counters.detail ?? null
        })
        .eq('id', runId);
      fail('finishRun', error);
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
