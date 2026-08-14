import { supabase } from './supabase.js';

export interface Story {
  id: number;
  display_title: string;
  provinces: string[] | null;
  /** null means the reports did not say. 0 means they said nobody died. */
  deaths: number | null;
  injuries: number | null;
  deaths_confidence?: number | null;
  injuries_confidence?: number | null;
  /** regex | llm | manual — which extractor produced the figure on screen. */
  deaths_source?: string | null;
  injuries_source?: string | null;
  /** statistics_roundup stories carry period totals, not one crash. */
  content_type?: string | null;
  source_count: number | null;
  max_confidence: 'high' | 'medium' | null;
  first_published: string;
  last_published: string;
  created_at?: string;
}

/** A story is only badged HIGH once several outlets have reported it. */
export const HIGH_BADGE_MIN_SOURCES = 2;

export function storyConfidence(story: Story): 'high' | 'medium' {
  return story.max_confidence === 'high' &&
    (story.source_count ?? 1) >= HIGH_BADGE_MIN_SOURCES
    ? 'high'
    : 'medium';
}

export type CasualtyState = 'fatal' | 'injury' | 'none' | 'unknown';

/**
 * "The reports did not say" and "the reports said nobody was hurt" are
 * different facts. Rendering `deaths || 0` collapsed them, so every story the
 * extractor could not read was published as a confident zero.
 */
export function casualtyState(
  story: Pick<Story, 'deaths' | 'injuries'>
): CasualtyState {
  if ((story.deaths ?? 0) > 0) return 'fatal';
  if ((story.injuries ?? 0) > 0) return 'injury';
  if (story.deaths === 0 || story.injuries === 0) return 'none';
  return 'unknown';
}

export function casualtyLabel(value: number | null | undefined): string {
  return value === null || value === undefined ? 'ไม่ระบุ' : String(value);
}

/** Period and national totals must never be summed with individual crashes. */
export function isAggregateStory(story: Pick<Story, 'content_type'>): boolean {
  return story.content_type === 'statistics_roundup';
}

export interface CasualtyTotals {
  deaths: number;
  injuries: number;
  /** Stories that stated a figure and are counted in the totals. */
  counted: number;
  /** Stories left out because no figure was reported. */
  unknown: number;
  /** Stories left out because they report a period or national total. */
  aggregate: number;
}

/**
 * Never imputes zero. A story with no reported figure is excluded and counted
 * separately, so the headline number is "the toll across the stories that said"
 * rather than a floor that looks like a fact.
 */
export function casualtyTotals(stories: Story[]): CasualtyTotals {
  const totals: CasualtyTotals = {
    deaths: 0, injuries: 0, counted: 0, unknown: 0, aggregate: 0
  };

  for (const story of stories) {
    if (isAggregateStory(story)) {
      totals.aggregate++;
      continue;
    }
    if (story.deaths === null && story.injuries === null) {
      totals.unknown++;
      continue;
    }
    totals.deaths += story.deaths ?? 0;
    totals.injuries += story.injuries ?? 0;
    totals.counted++;
  }

  return totals;
}

export interface Article {
  id: number;
  source: string;
  title: string;
  url: string;
  summary: string;
  published: string;
  confidence: string;
  deaths?: number | null;
  injuries?: number | null;
  /** The span that evidences the figure — the audit trail shown on hover. */
  casualty_snippet?: string | null;
  casualty_scope?: string | null;
  extractor?: string | null;
}

export type StoryWithArticles = Story & { articles: Article[] };

export interface LastRun {
  /** When the ingestion finished — how fresh the data on screen actually is. */
  finishedAt: Date;
  fetched: number | null;
  newStories: number | null;
}

/**
 * The most recent successful ingestion. ingest_runs is readable by anon
 * (0005_ingest_rpc.sql), so the page can show its own freshness.
 */
export async function fetchLastRun(): Promise<LastRun | null> {
  const { data, error } = await supabase
    .from('ingest_runs')
    .select('started_at, finished_at, fetched, new_stories')
    .eq('status', 'ok')
    .order('finished_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as {
    started_at: string;
    finished_at: string | null;
    fetched: number | null;
    new_stories: number | null;
  };

  return {
    finishedAt: new Date(row.finished_at ?? row.started_at),
    fetched: row.fetched,
    newStories: row.new_stories
  };
}

export async function fetchStories(limit = 100): Promise<Story[]> {
  // Ordered by last_published, not first_published: Google News hands us
  // articles whose publication date is weeks old, so a story discovered today
  // would otherwise sort below the limit and never reach the feed.
  const { data, error } = await supabase
    .from('stories')
    // supabase-js derives the row type from this string literal — keep it one
    // literal, not a concatenation, or the result degrades to GenericStringError.
    .select(
      'id, display_title, provinces, deaths, injuries, deaths_confidence, injuries_confidence, deaths_source, injuries_source, content_type, source_count, max_confidence, first_published, last_published, created_at'
    )
    .order('last_published', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as Story[];
}

export async function fetchStory(id: string): Promise<StoryWithArticles> {
  // stories.id is a bigint; anything else makes Postgres raise 22P02 and the
  // driver message would be rendered straight into the page.
  if (!/^\d+$/.test(id)) throw new Error('ไม่พบข่าวนี้');

  const { data: story, error } = await supabase
    .from('stories')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!story) throw new Error('ไม่พบข่าวนี้');

  // Explicit column list, not '*': 0011 replaced the table-level grant on
  // articles with a column-level one so extract_payload (raw model output)
  // stays off the wire, and '*' now fails with 42501. A new column must be
  // added to both the grant in 0011 and this list.
  const { data: articles, error: articlesError } = await supabase
    .from('articles')
    .select(
      'id, source, title, url, summary, published, confidence, deaths, injuries, casualty_snippet, casualty_scope, extractor'
    )
    .eq('story_id', id)
    .order('published', { ascending: true });

  if (articlesError) throw new Error(articlesError.message);

  return { ...(story as Story), articles: (articles ?? []) as Article[] };
}
