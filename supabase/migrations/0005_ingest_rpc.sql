-- Ingestion write path: batched existence check, one atomic upsert per
-- article, and a run log that doubles as a concurrency lock.

-- ---------------------------------------------------------------------------
-- 1. One round trip instead of one per article.
-- ---------------------------------------------------------------------------
create or replace function public.filter_new_urls(urls text[])
returns setof text
language sql
stable
as $$
  select u
  from unnest(urls) as u
  where not exists (select 1 from public.articles a where a.url = u);
$$;

revoke all on function public.filter_new_urls(text[]) from public;
grant execute on function public.filter_new_urls(text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 1b. Story-level confidence, so the UI badge reflects the articles behind it
--     instead of being hard-coded.
-- ---------------------------------------------------------------------------
alter table public.stories add column if not exists max_confidence text;

-- ---------------------------------------------------------------------------
-- 2. Atomic, idempotent article ingest.
--    source_count is recomputed from the articles table rather than
--    incremented, so a retry (cron re-fire, overlapping manual run) can never
--    inflate it, and a failed article insert can never leave an orphan story.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_article(
  p_story_id bigint,
  p_display_title text,
  p_norm_title text,
  p_trgm_key text,
  p_provinces text[],
  p_deaths int,
  p_injuries int,
  p_source text,
  p_title text,
  p_url text,
  p_summary text,
  p_confidence text,
  p_published timestamptz
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story_id bigint;
  v_rows int;
begin
  if p_story_id is null then
    insert into public.stories (
      display_title, norm_title, trgm_key, provinces, deaths, injuries,
      first_published, last_published, source_count
    )
    values (
      p_display_title, p_norm_title, p_trgm_key, p_provinces, p_deaths, p_injuries,
      p_published, p_published, 0
    )
    returning id into v_story_id;
  else
    v_story_id := p_story_id;
  end if;

  insert into public.articles (story_id, source, title, url, summary, confidence, published)
  values (v_story_id, p_source, p_title, p_url, p_summary, p_confidence, p_published)
  on conflict (url) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    update public.stories
       set source_count   = (select count(distinct a.source) from public.articles a where a.story_id = v_story_id),
           last_published = greatest(last_published, p_published),
           first_published = least(first_published, p_published),
           max_confidence = case
             when max_confidence = 'high' or p_confidence = 'high' then 'high'
             else 'medium'
           end
     where id = v_story_id;
  elsif p_story_id is null then
    -- Lost a race on the URL: drop the story we just created and adopt the
    -- winner's story instead.
    delete from public.stories where id = v_story_id;
    select a.story_id into v_story_id from public.articles a where a.url = p_url;
  end if;

  return v_story_id;
end;
$$;

revoke all on function public.ingest_article(bigint,text,text,text,text[],int,int,text,text,text,text,text,timestamptz) from public;
grant execute on function public.ingest_article(bigint,text,text,text,text[],int,int,text,text,text,text,text,timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Candidate lookup that can actually use the trigram index.
--    `similarity() >= threshold` alone is a filter expression; the `%`
--    operator is what consults stories_trgm_key_idx. Keep both: the operator
--    narrows via the index, the explicit comparison is authoritative.
-- ---------------------------------------------------------------------------
create or replace function public.find_candidate_stories(
  search_key text,
  window_start timestamptz,
  threshold real default 0.35
)
returns setof public.stories
language plpgsql
stable
as $$
begin
  perform set_limit(threshold);
  return query
    select *
    from public.stories s
    where s.first_published >= window_start
      and s.trgm_key % search_key
      and similarity(s.trgm_key, search_key) >= threshold
    order by similarity(s.trgm_key, search_key) desc
    limit 20;
end;
$$;

revoke all on function public.find_candidate_stories(text, timestamptz, real) from public;
grant execute on function public.find_candidate_stories(text, timestamptz, real) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Run log. The partial unique index means a second concurrent run fails
--    with 23505 instead of double-ingesting.
-- ---------------------------------------------------------------------------
create table if not exists public.ingest_runs (
  id bigint generated by default as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',   -- running | ok | error | timeout
  fetched int,
  passed int,
  new_stories int,
  merged int,
  skipped int,
  errors int,
  detail jsonb
);

create unique index if not exists ingest_runs_one_running
  on public.ingest_runs ((status)) where status = 'running';
create index if not exists ingest_runs_started_idx
  on public.ingest_runs (started_at desc);

alter table public.ingest_runs enable row level security;

drop policy if exists "Allow public read-only access to ingest_runs" on public.ingest_runs;
create policy "Allow public read-only access to ingest_runs"
  on public.ingest_runs for select
  using (true);

grant select on public.ingest_runs to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The feed orders by last_published (a story found today can have a
--    weeks-old first_published), so that column needs an index too.
-- ---------------------------------------------------------------------------
create index if not exists stories_last_published_idx
  on public.stories (last_published desc);
