-- Runs the ingest Edge Function every 30 minutes from inside the database.
--
-- Prerequisites (see scripts/setup-cron.ts, which does both):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url', '...');
--   select vault.create_secret('<hex>', 'ingest_trigger_secret', '...');
-- The same hex must be set as the function secret INGEST_TRIGGER_SECRET:
--   npx supabase secrets set INGEST_TRIGGER_SECRET=<hex>
--
-- No API key is sent: the function is deployed with verify_jwt = false and
-- authenticates on the shared secret header instead, because the anon key that
-- verify_jwt would accept is public in the browser bundle.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('ingest-news-every-30-min')
where exists (select 1 from cron.job where jobname = 'ingest-news-every-30-min');

select cron.schedule(
  'ingest-news-every-30-min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/ingest',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_trigger_secret')
    ),
    body := jsonb_build_object('trigger', 'cron'),
    -- pg_net is fire-and-forget: the function answers 202 immediately and
    -- finishes the work in the background, so this only bounds the handshake.
    timeout_milliseconds := 10000
  );
  $$
);

-- The function can be killed mid-run (wall-clock limit, worker recycle), which
-- would leave a 'running' row and the unique index would block every later run.
select cron.unschedule('ingest-sweep-stale')
where exists (select 1 from cron.job where jobname = 'ingest-sweep-stale');

select cron.schedule(
  'ingest-sweep-stale',
  '*/10 * * * *',
  $$
  update public.ingest_runs
     set status = 'timeout', finished_at = now()
   where status = 'running' and started_at < now() - interval '20 minutes';
  $$
);
