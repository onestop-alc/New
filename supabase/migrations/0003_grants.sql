-- RLS policies alone are not enough: the anon/authenticated roles also need
-- table-level privileges, otherwise PostgREST returns 42501 "permission denied".
grant usage on schema public to anon, authenticated;

grant select on public.stories to anon, authenticated;
grant select on public.articles to anon, authenticated;

-- Newly created tables in public get read access automatically.
alter default privileges in schema public grant select on tables to anon, authenticated;
