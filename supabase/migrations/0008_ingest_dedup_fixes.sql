-- Two dedup defects found once Bing and Google were running side by side:
--
-- 1. Outlet names arrive in different shapes ("Thairath.co.th" from Google's
--    <source>, "thairath.co.th" from Bing's link host), so count(distinct
--    source) saw one outlet as two and the story earned a false HIGH badge.
--    Counting is now case-insensitive.
--
-- 2. Search engines sometimes return the same story under a mirror URL
--    (msn.com one run, the publisher the next). The URL check misses it and
--    the trigram lookup can miss it too, so an identical headline created a
--    second story. An exact normalised-title match now attaches to the
--    existing story instead.

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

  insert into public.articles (story_id, source, title, url, summary, confidence, published)
  values (v_story_id, p_source, p_title, p_url, p_summary, p_confidence, p_published)
  on conflict (url) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    update public.stories
       set source_count   = (select count(distinct lower(a.source))
                               from public.articles a where a.story_id = v_story_id),
           last_published = greatest(last_published, p_published),
           first_published = least(first_published, p_published),
           max_confidence = case
             when max_confidence = 'high' or p_confidence = 'high' then 'high'
             else 'medium'
           end
     where id = v_story_id;
  elsif p_story_id is null then
    -- Lost a race on the URL: drop the story we just created (only if it is
    -- still empty) and adopt the winner's story instead.
    delete from public.stories s
     where s.id = v_story_id
       and not exists (select 1 from public.articles a where a.story_id = s.id);
    select a.story_id into v_story_id from public.articles a where a.url = p_url;
  end if;

  return v_story_id;
end;
$$;

revoke all on function public.ingest_article(bigint,text,text,text,text[],int,int,text,text,text,text,text,timestamptz) from public;
grant execute on function public.ingest_article(bigint,text,text,text,text[],int,int,text,text,text,text,text,timestamptz) to service_role;

create index if not exists stories_norm_title_idx on public.stories (norm_title);

-- Recompute the counters the old definition got wrong.
update public.stories s
   set source_count = (select count(distinct lower(a.source))
                         from public.articles a where a.story_id = s.id);
