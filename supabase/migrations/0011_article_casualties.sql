-- Casualty facts move to the article level, where they are actually observed.
--
-- Until now stories.deaths / stories.injuries were written once, by whichever
-- article happened to create the story (0010_ingest_reports_inserted.sql:46-56),
-- and the merge UPDATE never revised them. A later outlet reporting the correct
-- toll was discarded permanently. Recording the figure per article turns N
-- reports into N chances to get it right; 0012 derives the story value from them.
--
-- regex_deaths / regex_injuries are written on every path, forever, so the
-- regex and the LLM can be compared long after the switchover.

alter table public.articles
  add column if not exists deaths             int,
  add column if not exists injuries           int,
  add column if not exists regex_deaths       int,
  add column if not exists regex_injuries     int,
  add column if not exists deaths_evidence    text,
  add column if not exists injuries_evidence  text,
  add column if not exists deaths_confidence  real,
  add column if not exists injuries_confidence real,
  -- 'incident' | 'aggregate'. A national 7-day toll is a real figure but must
  -- never be rolled up onto a single-crash card.
  add column if not exists casualty_scope     text not null default 'incident',
  add column if not exists casualty_field     text,   -- title | summary | body
  -- The span that evidences the figure. This is the only body-derived text that
  -- is ever stored: article bodies are read in memory and thrown away.
  add column if not exists casualty_snippet   text,
  add column if not exists content_type       text,
  add column if not exists alcohol_involved   text,
  add column if not exists article_provinces  text[] not null default '{}',
  add column if not exists extractor          text not null default 'regex',
  add column if not exists extractor_model    text,
  add column if not exists extract_confidence text,
  add column if not exists extracted_at       timestamptz,
  add column if not exists extract_payload    jsonb,
  -- Bump CASUALTY_EXTRACTOR_VERSION in casualties.ts and the backfill picks up
  -- only the rows below it: incremental, resumable, never redoes work.
  add column if not exists extractor_version  int not null default 0;

alter table public.stories
  add column if not exists deaths_confidence   real,
  add column if not exists injuries_confidence real,
  add column if not exists deaths_source       text,   -- regex | llm | manual
  add column if not exists injuries_source     text,
  -- Editorial override. Wins over every derived value.
  add column if not exists deaths_manual       int,
  add column if not exists injuries_manual     int,
  add column if not exists content_type        text,
  -- A story a human has corrected is never recomputed. This is the direct fix
  -- for scripts/backfill-facts.ts silently reverting manual edits.
  add column if not exists casualties_locked   boolean not null default false,
  add column if not exists extractor_version   int not null default 0;

create index if not exists articles_story_deaths_idx
  on public.articles (story_id) where deaths is not null;

-- The re-extraction backlog: whatever a run had no time or budget for.
create index if not exists articles_pending_extraction_idx
  on public.articles (published desc) where extractor = 'regex';

-- 0003_grants.sql granted table-level SELECT on articles to anon. A
-- column-level REVOKE would be a silent no-op against that (Postgres warns
-- "no privileges could be revoked" and the table grant still covers every
-- column, including ones added later). So the table grant is dropped and
-- replaced with an explicit column list.
--
-- casualty_snippet stays public: it is a short quote shown with attribution and
-- an outbound link, the same posture the RSS summary already has.
-- extract_payload does not: it is raw model output and has no business being
-- served to the browser.
revoke select on public.articles from anon, authenticated;

grant select (
  id, story_id, source, source_key, aggregator, title, title_key, url, summary,
  confidence, published, created_at,
  deaths, injuries, regex_deaths, regex_injuries,
  deaths_evidence, injuries_evidence, deaths_confidence, injuries_confidence,
  casualty_scope, casualty_field, casualty_snippet,
  content_type, alcohol_involved, article_provinces,
  extractor, extractor_model, extract_confidence, extracted_at, extractor_version
) on public.articles to anon, authenticated;

-- NOTE: with column-level grants, `select('*')` from the browser now fails with
-- 42501. src/lib/api.ts lists columns explicitly for this reason — any new
-- column must be added to BOTH this grant and that select, or it stays invisible.
