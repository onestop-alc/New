-- Candidate lookup used by the ingestion job.
-- Takes an explicit similarity threshold so it does not depend on the
-- session-level pg_trgm.similarity_threshold setting (PostgREST reuses pooled
-- sessions, so `SET` is not reliable there).
drop function if exists public.find_candidate_stories(text, timestamptz, timestamptz);

create or replace function public.find_candidate_stories(
  search_key text,
  window_start timestamptz,
  threshold real default 0.35
)
returns setof public.stories
language sql
stable
as $$
  select *
  from public.stories
  where first_published >= window_start
    and similarity(trgm_key, search_key) >= threshold
  order by similarity(trgm_key, search_key) desc
  limit 20;
$$;

-- Only the writer (service_role) needs this.
revoke all on function public.find_candidate_stories(text, timestamptz, real) from public;
grant execute on function public.find_candidate_stories(text, timestamptz, real) to service_role;
