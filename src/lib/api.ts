import { supabase } from './supabase.js';

export interface Story {
  id: string;
  display_title: string;
  provinces: string[];
  deaths: number | null;
  injuries: number | null;
  source_count: number;
  first_published: string;
  created_at?: string;
}

export interface Article {
  id: string;
  source: string;
  title: string;
  url: string;
  summary: string;
  published: string;
  confidence: string;
}

export type StoryWithArticles = Story & { articles: Article[] };

export async function fetchStories(limit = 100): Promise<Story[]> {
  const { data, error } = await supabase
    .from('stories')
    .select(
      'id, display_title, provinces, deaths, injuries, source_count, first_published, created_at'
    )
    .order('first_published', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as Story[];
}

export async function fetchStory(id: string): Promise<StoryWithArticles> {
  const { data: story, error } = await supabase
    .from('stories')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!story) throw new Error('Story not found');

  const { data: articles, error: articlesError } = await supabase
    .from('articles')
    .select('*')
    .eq('story_id', id)
    .order('published', { ascending: true });

  if (articlesError) throw new Error(articlesError.message);

  return { ...(story as Story), articles: (articles ?? []) as Article[] };
}
