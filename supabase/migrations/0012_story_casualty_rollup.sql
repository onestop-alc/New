-- One deterministic rule for "how many died", applied on every write instead of
-- only at story creation.
--
-- Not max: an aggregator republishing a national roundup would poison the story.
-- Not most-recent: a follow-up usually just replays the original headline. The
-- order below is what a corroboration system should do — trust the strongest
-- evidence, break ties by how many independent outlets agree, then by recency
-- because a death toll rises as victims die.

create or replace function public.recompute_story_casualties(p_story_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deaths    int;
  v_injuries  int;
  v_dconf     real;
  v_iconf     real;
  v_dsrc      text;
  v_isrc      text;
  v_ctype     text;
  v_provinces text[];
begin
  if exists (
    select 1 from public.stories where id = p_story_id and casualties_locked
  ) then
    return;
  end if;

  with elig as (
    -- Campaign pieces and legal explainers never contribute a casualty figure,
    -- even when they quote a statistic in passing. Aggregate-scope articles
    -- (7-day roundups, national statistics) are excluded for the same reason.
    select a.deaths, a.injuries, a.source_key, a.published, a.extractor,
           a.deaths_confidence, a.injuries_confidence,
           (not a.aggregator) as primary_src
      from public.articles a
     where a.story_id = p_story_id
       and coalesce(a.casualty_scope, 'incident') = 'incident'
       and coalesce(a.content_type, 'crash') not in ('campaign', 'legal_explainer')
       and coalesce(a.extract_confidence, 'high') <> 'low'
  ),
  has_primary as (select bool_or(primary_src) as yes from elig),
  -- Prefer primary outlets; fall back to every eligible article rather than
  -- reporting no figure at all when only republishers covered the story.
  pool as (
    select e.*
      from elig e cross join has_primary h
     where (h.yes and e.primary_src) or h.yes is not true
  ),
  d as (
    select p.deaths as v,
           max(p.deaths_confidence) as conf,
           bool_or(p.extractor = 'llm') as from_llm
      from pool p
     where p.deaths is not null
     group by p.deaths
     order by max(p.deaths_confidence) desc nulls last,
              count(distinct p.source_key) desc,
              max(p.published) desc
     limit 1
  ),
  i as (
    select p.injuries as v,
           max(p.injuries_confidence) as conf,
           bool_or(p.extractor = 'llm') as from_llm
      from pool p
     where p.injuries is not null
     group by p.injuries
     order by max(p.injuries_confidence) desc nulls last,
              count(distinct p.source_key) desc,
              max(p.published) desc
     limit 1
  ),
  ct as (
    select a.content_type as v
      from public.articles a
     where a.story_id = p_story_id and a.content_type is not null
     group by a.content_type
     order by count(*) desc, a.content_type
     limit 1
  ),
  pv as (
    select array_agg(distinct p order by p) as v
      from public.articles a, unnest(a.article_provinces) p
     where a.story_id = p_story_id
  )
  select (select v from d),
         (select conf from d),
         (select case when from_llm then 'llm' else 'regex' end from d),
         (select v from i),
         (select conf from i),
         (select case when from_llm then 'llm' else 'regex' end from i),
         (select v from ct),
         (select v from pv)
    into v_deaths, v_dconf, v_dsrc, v_injuries, v_iconf, v_isrc, v_ctype, v_provinces;

  -- coalesce, never overwrite: an article that arrives without a figure must not
  -- erase one that is already known.
  update public.stories s
     set deaths              = coalesce(s.deaths_manual,   v_deaths,   s.deaths),
         injuries            = coalesce(s.injuries_manual, v_injuries, s.injuries),
         deaths_confidence   = coalesce(v_dconf, s.deaths_confidence),
         injuries_confidence = coalesce(v_iconf, s.injuries_confidence),
         deaths_source       = case
                                 when s.deaths_manual is not null then 'manual'
                                 else coalesce(v_dsrc, s.deaths_source)
                               end,
         injuries_source     = case
                                 when s.injuries_manual is not null then 'manual'
                                 else coalesce(v_isrc, s.injuries_source)
                               end,
         content_type        = coalesce(v_ctype, s.content_type),
         provinces           = coalesce(nullif(v_provinces, '{}'), s.provinces)
   where s.id = p_story_id;
end;
$$;

-- Facts arrive after ingest_article() has returned, so they get their own entry
-- point. One jsonb argument rather than twenty positional ones: adding a field
-- later must not change a signature that both stores build by position.
create or replace function public.upsert_article_facts(p_url text, p_facts jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story_id bigint;
begin
  update public.articles set
    deaths              = nullif(p_facts->>'deaths', '')::int,
    injuries            = nullif(p_facts->>'injuries', '')::int,
    regex_deaths        = nullif(p_facts->>'regex_deaths', '')::int,
    regex_injuries      = nullif(p_facts->>'regex_injuries', '')::int,
    deaths_evidence     = p_facts->>'deaths_evidence',
    injuries_evidence   = p_facts->>'injuries_evidence',
    deaths_confidence   = nullif(p_facts->>'deaths_confidence', '')::real,
    injuries_confidence = nullif(p_facts->>'injuries_confidence', '')::real,
    casualty_scope      = coalesce(p_facts->>'casualty_scope', 'incident'),
    casualty_field      = p_facts->>'casualty_field',
    casualty_snippet    = p_facts->>'casualty_snippet',
    content_type        = p_facts->>'content_type',
    alcohol_involved    = p_facts->>'alcohol_involved',
    article_provinces   = coalesce(
                            array(select jsonb_array_elements_text(p_facts->'article_provinces')),
                            '{}'
                          ),
    extractor           = coalesce(p_facts->>'extractor', 'regex'),
    extractor_model     = p_facts->>'extractor_model',
    extract_confidence  = p_facts->>'extract_confidence',
    extractor_version   = coalesce(nullif(p_facts->>'extractor_version', '')::int, 0),
    extracted_at        = now(),
    extract_payload     = p_facts->'payload'
  where url = p_url
  returning story_id into v_story_id;

  if v_story_id is not null then
    perform public.recompute_story_casualties(v_story_id);
  end if;
  return v_story_id;
end;
$$;

-- Articles a busy run left on regex-only facts. Enrichment picks them up on a
-- later tick, so a blown deadline makes a figure late rather than lost.
create or replace function public.articles_pending_extraction(p_limit int default 20)
returns table (
  id bigint, url text, title text, summary text, source text, published timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.url, a.title, a.summary, a.source, a.published
    from public.articles a
   where a.extractor = 'regex'
   order by a.published desc
   limit p_limit;
$$;

revoke all on function public.recompute_story_casualties(bigint) from public;
revoke all on function public.upsert_article_facts(text, jsonb) from public;
revoke all on function public.articles_pending_extraction(int) from public;
grant execute on function public.recompute_story_casualties(bigint) to service_role;
grant execute on function public.upsert_article_facts(text, jsonb) to service_role;
grant execute on function public.articles_pending_extraction(int) to service_role;
