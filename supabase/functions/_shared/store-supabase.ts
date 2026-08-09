/**
 * Supabase REST writer, used by the Edge Function and by `npm run ingest`
 * when only SUPABASE_SERVICE_ROLE_KEY is available. Bypasses RLS.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CONFIG } from './feeds.ts';
import {
  RunInProgressError,
  UNIQUE_VIOLATION,
  type CandidateStory,
  type Store
} from './pipeline.ts';

export function createSupabaseStore(url: string, serviceRoleKey: string): Store {
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
