-- Candidate lookup used to filter on `first_published >= window_start`, which
-- ages a story out of consideration a fixed number of days after the crash —
-- regardless of whether coverage is still arriving.
--
-- Follow-up reporting on one crash runs for weeks (bail hearing, charges,
-- funeral). With the old 3-day window those articles were never returned as
-- candidates at all, so isSameStory() never got to judge them: one BMW/tuk-tuk
-- crash became sixteen separate stories and the dashboard counted its three
-- deaths sixteen times.
--
-- Filtering on `last_published` instead keeps a story reachable for as long as
-- outlets keep reporting it, and lets the caller's window mean "still active"
-- rather than "started recently". The merge decision itself is unchanged and
-- still made in isSameStory(), which now demands corroboration (same toll AND
-- same vehicle signature) for any pair more than DEDUP_WINDOW_DAYS apart.
--
-- The limit is raised because a wider window returns more near-misses; without
-- it the genuine match can be pushed off the end of the list by templated
-- headlines that score higher on trigram similarity alone.

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
  where last_published >= window_start
    and similarity(trgm_key, search_key) >= threshold
  order by similarity(trgm_key, search_key) desc
  limit 40;
$$;

revoke all on function public.find_candidate_stories(text, timestamptz, real) from public;
grant execute on function public.find_candidate_stories(text, timestamptz, real) to service_role;
