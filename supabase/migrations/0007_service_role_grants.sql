-- The ingest Edge Function connects as service_role over PostgREST. RLS is
-- bypassed for that role, but table-level privileges are not: without these
-- grants every write fails with 42501 "permission denied".
--
-- ingest_article() is security definer so it runs as the owner, but
-- filter_new_urls() and find_candidate_stories() are plain stable functions
-- and read as the caller, and ingest_runs is written directly.

grant usage on schema public to service_role;

grant select, insert, update on public.stories to service_role;
grant select, insert, update on public.articles to service_role;
grant select, insert, update on public.ingest_runs to service_role;

-- Identity columns draw from sequences.
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
