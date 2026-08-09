import { supabase } from './supabase.js';

export interface Story {
  id: number;
  display_title: string;
  provinces: string[] | null;
  deaths: number | null;
  injuries: number | null;
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

export interface Article {
  id: number;
  source: string;
  title: string;
  url: string;
  summary: string;
  published: string;
  confidence: string;
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
    .select(
      'id, display_title, provinces, deaths, injuries, source_count, max_confidence, first_published, last_published, created_at'
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

  const { data: articles, error: articlesError } = await supabase
    .from('articles')
    .select('*')
    .eq('story_id', id)
    .order('published', { ascending: true });

  if (articlesError) throw new Error(articlesError.message);

  return { ...(story as Story), articles: (articles ?? []) as Article[] };
}
