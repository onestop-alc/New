-- source_count was counting the same outlet twice and counting republishers as
-- independent reporting, which made single-source stories show the HIGH badge.
--
-- Root causes (all observed in the data):
--   1. Google News gives a display name ("The Bangkok Insight", "ข่าวสด") while
--      Bing only gives a link, from which we derive a hostname
--      ("thebangkokinsight.com", "khaosod.co.th") — one outlet, two names.
--   2. The same article arrives under two URLs, so the url unique index missed
--      it and the story got a duplicate row.
--   3. msn.com / LINE Today / TrueID republish other outlets' articles.
--
-- articles now carries a canonical outlet key, an aggregator flag and a
-- normalised title, all produced by supabase/functions/_shared/sources.ts and
-- filters.ts so Node and the Edge Function agree.
--
-- NOTE: run scripts/backfill-sources.ts after this migration — it fills the new
-- columns, removes the duplicate rows and creates the unique index that cannot
-- be created while duplicates exist.

alter table public.articles add column if not exists source_key text;
alter table public.articles add column if not exists title_key text;
alter table public.articles add column if not exists aggregator boolean not null default false;

create index if not exists articles_source_key_idx on public.articles (story_id, source_key);

create or replace function public.ingest_article(
  p_story_id bigint,
  p_display_title text,
  p_norm_title text,
  p_trgm_key text,
  p_provinces text[],
  p_deaths int,
  p_injuries int,
  p_source text,
  p_source_key text,
  p_aggregator boolean,
  p_title text,
  p_title_key text,
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
  v_story_id := p_story_id;

  -- Same headline, different URL: same story.
  if v_story_id is null then
    select id into v_story_id
      from public.stories
     where norm_title = p_norm_title
     order by id
     limit 1;
  end if;

  if v_story_id is null then
    insert into public.stories (
      display_title, norm_title, trgm_key, provinces, deaths, injuries,
      first_published, last_published, source_count
    )
    values (
      p_display_title, p_norm_title, p_trgm_key, p_provinces, p_deaths, p_injuries,
      p_published, p_published, 0
    )
    returning id into v_story_id;
  end if;

  -- No conflict target: this must swallow a duplicate url AND a duplicate
  -- (story_id, title_key), which is the same article under another link.
  insert into public.articles (
    story_id, source, source_key, aggregator, title, title_key,
    url, summary, confidence, published
  )
  values (
    v_story_id, p_source, p_source_key, p_aggregator, p_title, p_title_key,
    p_url, p_summary, p_confidence, p_published
  )
  on conflict do nothing;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    update public.stories
       set source_count = greatest(
             (select count(distinct a.source_key)
                from public.articles a
               where a.story_id = v_story_id and not a.aggregator),
             1),
           last_published = greatest(last_published, p_published),
           first_published = least(first_published, p_published),
           max_confidence = case
             when max_confidence = 'high' or p_confidence = 'high' then 'high'
             else 'medium'
           end
     where id = v_story_id;
  elsif p_story_id is null then
    -- Lost a race, or this article is already filed under another story: drop
    -- the story we just created if it is still empty and adopt the existing one.
    delete from public.stories s
     where s.id = v_story_id
       and not exists (select 1 from public.articles a where a.story_id = s.id);

    select a.story_id into v_story_id
      from public.articles a where a.url = p_url limit 1;
    if v_story_id is null then
      select a.story_id into v_story_id
        from public.articles a where a.title_key = p_title_key order by a.id limit 1;
    end if;
  end if;

  return v_story_id;
end;
$$;

-- The 13-argument version is replaced by the 16-argument one above.
drop function if exists public.ingest_article(
  bigint, text, text, text, text[], int, int, text, text, text, text, text, timestamptz);

revoke all on function public.ingest_article(
  bigint,text,text,text,text[],int,int,text,text,boolean,text,text,text,text,text,timestamptz) from public;
grant execute on function public.ingest_article(
  bigint,text,text,text,text[],int,int,text,text,boolean,text,text,text,text,text,timestamptz) to service_role;
