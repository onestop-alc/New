/**
 * Scheduled news ingestion, triggered by pg_cron via pg_net every 30 minutes.
 *
 * Auth: a shared secret header, NOT the JWT gate. verify_jwt accepts any token
 * signed with the project's JWT secret — including the anon key, which ships
 * inside the browser bundle — so it would leave this endpoint open to anyone
 * reading the site source.
 */
import { runPipeline } from '../_shared/pipeline.ts';
import { createSupabaseStore } from '../_shared/store-supabase.ts';
import { fetchAllFeeds, feedErrors } from './rss.ts';

const TRIGGER_SECRET = Deno.env.get('INGEST_TRIGGER_SECRET');
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req: Request) => {
  if (!TRIGGER_SECRET) {
    console.error('INGEST_TRIGGER_SECRET is not configured');
    return new Response('not configured', { status: 500 });
  }
  if (req.headers.get('x-ingest-secret') !== TRIGGER_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const url = new URL(req.url);
  const seasonal = url.searchParams.get('seasonal') === '1';
  // ?wait=1 runs synchronously and returns the counters — useful for a manual
  // curl. The cron call returns immediately and lets the work finish in the
  // background instead.
  const wait = url.searchParams.get('wait') === '1';

  const store = createSupabaseStore(SUPABASE_URL, SERVICE_ROLE_KEY);
  const work = runPipeline({ store, fetchArticles: () => fetchAllFeeds({ seasonal }) });

  if (wait) {
    try {
      const result = await work;
      return Response.json({ ok: true, result, feedErrors });
    } catch (err) {
      console.error('Ingestion failed:', err);
      return Response.json({ ok: false, error: String(err) }, { status: 500 });
    }
  }

  // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime.
  EdgeRuntime.waitUntil(work.catch((err: unknown) => console.error('Ingestion failed:', err)));
  return Response.json({ accepted: true }, { status: 202 });
});
