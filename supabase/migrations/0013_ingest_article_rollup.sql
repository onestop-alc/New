-- ingest_article() wrote deaths/injuries only when it created the story, and the
-- merge UPDATE (0010_ingest_reports_inserted.sql:72-84) touched only
-- source_count / last_published / first_published / max_confidence. So the first
-- article to arrive fixed the toll forever, and a later outlet reporting the
-- correct figure was discarded.
--
-- The signature is deliberately unchanged: both stores build these 16 arguments
-- by position. The only difference is the rollup call, which now runs on merges
-- as well as on creation.

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
) returns table (story_id bigint, inserted boolean)
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
    url, summary, confidence, published,
    -- Seeded here so a story always has a figure even if saveArticleFacts()
    -- never runs; upsert_article_facts() then supplies the provenance.
    deaths, injuries, regex_deaths, regex_injuries
  )
  values (
    v_story_id, p_source, p_source_key, p_aggregator, p_title, p_title_key,
    p_url, p_summary, p_confidence, p_published,
    p_deaths, p_injuries, p_deaths, p_injuries
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

    -- The fix. Runs on merges too, so the story figure is always derived from
    -- every member article rather than frozen at whatever the first one said.
    perform public.recompute_story_casualties(v_story_id);
  else
    -- Nothing stored: drop the story we may have just created if it is still
    -- empty, and report the story that already owns this article.
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

  return query select v_story_id, v_rows > 0;
end;
$$;

revoke all on function public.ingest_article(
  bigint,text,text,text,text[],int,int,text,text,boolean,text,text,text,text,text,timestamptz) from public;
grant execute on function public.ingest_article(
  bigint,text,text,text,text[],int,int,text,text,boolean,text,text,text,text,text,timestamptz) to service_role;
