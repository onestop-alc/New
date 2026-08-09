/**
 * Deno feed reader for the Edge Function.
 *
 * rss-parser cannot be reused here: it drives node:http/https and offers no
 * AbortSignal, so this uses fetch + fast-xml-parser and keeps the same 15s
 * per-feed timeout the Node path has.
 */
import { XMLParser } from 'fast-xml-parser';
import {
  GOOGLE_NEWS_QUERIES,
  GOOGLE_NEWS_QUERIES_SEASONAL,
  BING_NEWS_QUERIES,
  BING_NEWS_QUERIES_SEASONAL,
  DIRECT_FEEDS,
  CONFIG
} from '../_shared/feeds.ts';
import type { ArticleInput } from '../_shared/pipeline.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  processEntities: true,
  isArray: (_name, jpath) => jpath === 'rss.channel.item' || jpath === 'feed.entry'
});

interface RawItem {
  title?: string | { '#text'?: string };
  link?: string | { '@_href'?: string } | Array<string | { '@_href'?: string }>;
  pubDate?: string;
  published?: string;
  updated?: string;
  description?: string;
  summary?: string;
  source?: string | { '#text'?: string };
  'content:encoded'?: string;
}

/** fast-xml-parser hands back either a string or a { '#text' } node. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) {
    return String((value as { '#text': unknown })['#text'] ?? '');
  }
  return '';
}

function linkOf(item: RawItem): string {
  const raw = Array.isArray(item.link) ? item.link[0] : item.link;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') return raw['@_href'] ?? '';
  return '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CONFIG.MAX_SUMMARY_LENGTH);
}

function parseDate(item: RawItem): Date | null {
  const raw = item.pubDate || item.published || item.updated;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isTooOld(date: Date): boolean {
  return (Date.now() - date.getTime()) / 86_400_000 > CONFIG.MAX_ARTICLE_AGE_DAYS;
}

/**
 * Per-feed failures from the last fetchAllFeeds() call. Edge Function logs are
 * awkward to reach from the CLI, so `?wait=1` returns these in the response.
 */
export const feedErrors: string[] = [];

async function fetchItems(url: string): Promise<RawItem[]> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8'
    },
    signal: AbortSignal.timeout(CONFIG.FEED_TIMEOUT_MS),
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);

  const doc = parser.parse(await res.text());
  return (doc?.rss?.channel?.item ?? doc?.feed?.entry ?? []) as RawItem[];
}

/**
 * Google News answers 503 to every request from Supabase's egress IPs, so it is
 * off by default here and only worth enabling if that ever changes:
 *   npx supabase secrets set ENABLE_GOOGLE_NEWS=1
 */
const GOOGLE_NEWS_ENABLED = Deno.env.get('ENABLE_GOOGLE_NEWS') === '1';

async function fetchGoogleNews(queries: string[]): Promise<ArticleInput[]> {
  if (!GOOGLE_NEWS_ENABLED) return [];
  const articles: ArticleInput[] = [];

  const requests = queries.map(async (query) => {
    const url =
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=th&gl=TH&ceid=TH:th`;
    try {
      for (const item of await fetchItems(url)) {
        const rawTitle = text(item.title);
        const link = linkOf(item);
        if (!rawTitle || !link) continue;

        const pubDate = parseDate(item);
        if (!pubDate || isTooOld(pubDate)) continue;

        // <source> carries the clean outlet name; splitting on " - " alone
        // leaves section prefixes ("ในประเทศ - ...") in the title.
        let title = rawTitle;
        let source = text(item.source).trim();
        const parts = rawTitle.split(' - ');
        if (parts.length > 1) {
          const suffix = parts[parts.length - 1].trim();
          if (!source) source = suffix;
          if (suffix === source) title = parts.slice(0, -1).join(' - ');
        }

        articles.push({
          title: title.trim(),
          link,
          pubDate,
          // Google News descriptions just repeat the headline.
          summary: '',
          source: source || 'Google News'
        });
      }
    } catch (e) {
      feedErrors.push(`google:${query} -> ${String(e)}`);
      console.error(`Failed to fetch Google News for query ${query}:`, e);
    }
  });

  await Promise.allSettled(requests);
  return articles;
}

/**
 * Bing RSS links are click-tracking URLs (bing.com/news/apiclick.aspx?...&url=…)
 * whose tracking ids change every request. Left as-is they defeat URL dedup and
 * make every outlet look like "bing.com", so unwrap the real publisher URL.
 */
function unwrapBingLink(link: string): string {
  try {
    const parsed = new URL(link);
    if (!parsed.hostname.endsWith('bing.com')) return link;
    return parsed.searchParams.get('url') || link;
  } catch {
    return link;
  }
}

/** Bing RSS carries no <source>; the publisher hostname is the next best key. */
function sourceFromUrl(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return 'Bing News';
  }
}

/**
 * Bing is the search source that actually works from here: Google News answers
 * 503 to every request from the Supabase Edge runtime.
 */
async function fetchBingNews(queries: string[]): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];

  const requests = queries.map(async (query) => {
    const url =
      `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=RSS&cc=TH&setlang=th`;
    try {
      for (const item of await fetchItems(url)) {
        const title = text(item.title);
        const rawLink = linkOf(item);
        if (!title || !rawLink) continue;

        const pubDate = parseDate(item);
        if (!pubDate || isTooOld(pubDate)) continue;

        const link = unwrapBingLink(rawLink);
        articles.push({
          title: title.trim(),
          link,
          pubDate,
          source: sourceFromUrl(link),
          summary: stripHtml(text(item.description) || text(item.summary))
        });
      }
    } catch (e) {
      feedErrors.push(`bing:${query} -> ${String(e)}`);
      console.error(`Failed to fetch Bing News for query ${query}:`, e);
    }
  });

  await Promise.allSettled(requests);
  return articles;
}

async function fetchDirectFeeds(): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];

  const requests = DIRECT_FEEDS.map(async (url) => {
    try {
      for (const item of await fetchItems(url)) {
        const title = text(item.title);
        const link = linkOf(item);
        if (!title || !link) continue;

        const pubDate = parseDate(item);
        if (!pubDate || isTooOld(pubDate)) continue;

        articles.push({
          title,
          link,
          pubDate,
          source: new URL(url).hostname.replace(/^www\./, ''),
          summary: stripHtml(text(item.description) || text(item['content:encoded']) || text(item.summary))
        });
      }
    } catch (e) {
      feedErrors.push(`${url} -> ${String(e)}`);
      console.error(`Failed to fetch feed ${url}:`, e);
    }
  });

  await Promise.allSettled(requests);
  return articles;
}

export async function fetchAllFeeds(options: { seasonal?: boolean } = {}): Promise<ArticleInput[]> {
  feedErrors.length = 0;
  const googleQueries = options.seasonal
    ? [...GOOGLE_NEWS_QUERIES, ...GOOGLE_NEWS_QUERIES_SEASONAL]
    : GOOGLE_NEWS_QUERIES;
  const bingQueries = options.seasonal
    ? [...BING_NEWS_QUERIES, ...BING_NEWS_QUERIES_SEASONAL]
    : BING_NEWS_QUERIES;

  const [googleNews, bingNews, direct] = await Promise.all([
    fetchGoogleNews(googleQueries),
    fetchBingNews(bingQueries),
    fetchDirectFeeds()
  ]);

  const seenUrls = new Set<string>();
  const unique: ArticleInput[] = [];
  for (const article of [...googleNews, ...bingNews, ...direct]) {
    if (seenUrls.has(article.link)) continue;
    seenUrls.add(article.link);
    unique.push(article);
  }
  return unique;
}
