-- Candidate lookup returned a story only when its trigram key was at least 35%
-- similar to the incoming article's. That gate decides what isSameStory() is
-- ever allowed to see, and it silently drops the pairs that matter most.
--
-- Measured on the live table: "ดับ 3 ศพ! เก๋งหรูพุ่งชนสามล้อ" and
-- "เปิดวงจรปิดนาที BMW ชนตุ๊กตุ๊ก" are the same crash and score well under
-- 0.35 against each other, because an outlet that rewrites a headline from
-- scratch keeps almost no trigrams. The pair was never compared at all — no
-- merge rule, however good, could have joined them.
--
-- Adding the province as a second way in fixes that: a story from the same
-- province inside the same activity window is cheap to return and is exactly
-- the population a rewritten headline hides in. The merge decision itself is
-- unchanged and still made entirely in isSameStory(), which now weighs shared
-- entities (landmark, age, marque, office) and demands at least one rare one
-- before it will merge on anything but text.
--
-- `search_provinces` is nullable so a caller that has no province extracted
-- keeps the old trigram-only behaviour rather than scanning the window.

create index if not exists stories_provinces_gin
  on public.stories using gin (provinces);

-- 0014's three-argument function cannot be replaced in place: adding a
-- defaulted fourth argument creates an overload instead, and a three-argument
-- call would then be ambiguous between the two.
drop function if exists public.find_candidate_stories(text, timestamptz, real);

create or replace function public.find_candidate_stories(
  search_key text,
  window_start timestamptz,
  threshold real default 0.35,
  search_provinces text[] default null
)
returns setof public.stories
language sql
stable
as $$
  select s.*
  from public.stories s
  where s.last_published >= window_start
    and (
      similarity(s.trgm_key, search_key) >= threshold
      or (
        search_provinces is not null
        and array_length(search_provinces, 1) > 0
        and s.provinces && search_provinces
      )
    )
  -- Trigram order still puts the textually closest candidates first, so a
  -- province match can only ever be appended to the list, never displace a
  -- stronger one. The limit is raised because the province arm widens it.
  order by similarity(s.trgm_key, search_key) desc
  limit 60;
$$;

revoke all on function public.find_candidate_stories(text, timestamptz, real, text[]) from public;
grant execute on function public.find_candidate_stories(text, timestamptz, real, text[]) to service_role;
