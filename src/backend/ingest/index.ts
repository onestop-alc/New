import { fetchAllFeeds } from './rss.js';
import { createStore } from './store.js';
import {
  runPipeline,
  type DryRunResult,
  type IngestionResult
} from '../../../supabase/functions/_shared/pipeline.ts';
import { buildIngestExtras } from '../../../supabase/functions/_shared/runtime-config.ts';

export type { IngestionResult, DryRunResult };

export interface IngestionOptions {
  /** Classify only, never touch the database. */
  dryRun?: boolean;
  /** Include the archive-heavy seasonal queries. */
  seasonal?: boolean;
}

/**
 * Node entry point. The Supabase Edge Function calls runPipeline() directly
 * with its own fetcher and the Supabase store — see supabase/functions/ingest.
 */
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

  const extras = buildIngestExtras(key => process.env[key]);

  return runPipeline({
    store,
    fetchArticles: () => fetchAllFeeds({ seasonal: options.seasonal }),
    ...extras
  });
}
