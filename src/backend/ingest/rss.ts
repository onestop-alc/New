import Parser from 'rss-parser';
import {
  GOOGLE_NEWS_QUERIES,
  GOOGLE_NEWS_QUERIES_SEASONAL,
  BING_NEWS_QUERIES,
  BING_NEWS_QUERIES_SEASONAL,
  DIRECT_FEEDS,
  CONFIG
} from '../../../supabase/functions/_shared/feeds.ts';
import type { ArticleInput } from '../../../supabase/functions/_shared/pipeline.ts';
import sanitizeHtml from 'sanitize-html';

type GoogleNewsItem = { sourceName?: string | { '#text'?: string } };

// Several Thai news feeds stall instead of refusing the connection, so every
// request needs a hard timeout or a single feed can hang the whole run.
// A browser UA matters too: khaosod.co.th/feed 403s a bot UA.
const parser: Parser<Record<string, unknown>, GoogleNewsItem> = new Parser({
  timeout: CONFIG.FEED_TIMEOUT_MS,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8'
  },
  customFields: { item: [['source', 'sourceName']] }
});

export type { ArticleInput };

function cleanHtml(html: string | undefined): string {
  if (!html) return '';
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  return text.substring(0, CONFIG.MAX_SUMMARY_LENGTH).trim();
}

/** rss-parser normalises dates into isoDate; pubDate is whatever the feed sent. */
function parseDate(item: { isoDate?: string; pubDate?: string }): Date | null {
  const raw = item.isoDate || item.pubDate;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Bing RSS links are click-tracking URLs (bing.com/news/apiclick.aspx?...&url=…)
 * whose tracking ids change every request. Left as-is they defeat URL dedup and
 * make every outlet look like "bing.com", so unwrap the real publisher URL.
 */
export function unwrapBingLink(link: string): string {
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

function isTooOld(date: Date): boolean {
  const ageDays = (Date.now() - date.getTime()) / 86_400_000;
  return ageDays > CONFIG.MAX_ARTICLE_AGE_DAYS;
}

export async function fetchGoogleNews(queries: string[] = GOOGLE_NEWS_QUERIES): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];

  const requests = queries.map(async (query) => {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=th&gl=TH&ceid=TH:th`;
      const feed = await parser.parseURL(url);

      for (const item of feed.items) {
        if (!item.title || !item.link) continue;
        const pubDate = parseDate(item);
        if (!pubDate || isTooOld(pubDate)) continue;

        // The <source> element carries the clean outlet name. Falling back to
        // splitting on " - " keeps section prefixes ("ในประเทศ - ...") in the title.
        const rawSource = item.sourceName;
        const sourceTag = typeof rawSource === 'string' ? rawSource : rawSource?.['#text'];
        let title = item.title;
        let source = sourceTag?.trim() || '';

        const parts = item.title.split(' - ');
        if (parts.length > 1) {
          const suffix = parts[parts.length - 1].trim();
          if (!source) source = suffix;
          if (suffix === source) title = parts.slice(0, -1).join(' - ');
        }

        articles.push({
          title: title.trim(),
          link: item.link,
          pubDate,
          // Google News <description> is just the headline wrapped in a link,
          // so a summary here would repeat the title on the story page.
          summary: '',
          source: source || 'Google News'
        });
      }
    } catch (e) {
      console.error(`Failed to fetch Google News for query ${query}:`, e);
    }
  });

  await Promise.allSettled(requests);
  return articles;
}

/** Bing keeps working from datacenter IPs, where Google News answers 503. */
export async function fetchBingNews(queries: string[] = BING_NEWS_QUERIES): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];

  const requests = queries.map(async (query) => {
    try {
      const url =
        `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=RSS&cc=TH&setlang=th`;
      const feed = await parser.parseURL(url);

      for (const item of feed.items) {
        if (!item.title || !item.link) continue;
        const pubDate = parseDate(item);
        if (!pubDate || isTooOld(pubDate)) continue;

        const link = unwrapBingLink(item.link);
        articles.push({
          title: item.title.trim(),
          link,
          pubDate,
          source: sourceFromUrl(link),
          summary: cleanHtml(item.contentSnippet || item.content || item.summary)
        });
      }
    } catch (e) {
      console.error(`Failed to fetch Bing News for query ${query}:`, e);
    }
  });

  await Promise.allSettled(requests);
  return articles;
}

export async function fetchDirectFeeds(): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];

  const requests = DIRECT_FEEDS.map(async (url) => {
    try {
      const feed = await parser.parseURL(url);
      const source = feed.title || 'Unknown Source';
      for (const item of feed.items) {
        if (!item.title || !item.link) continue;
        const pubDate = parseDate(item);
        if (!pubDate || isTooOld(pubDate)) continue;

        articles.push({
          title: item.title,
          link: item.link,
          pubDate,
          source,
          summary: cleanHtml(item.contentSnippet || item.content || item.summary)
        });
      }
    } catch (e) {
      console.error(`Failed to fetch feed ${url}:`, e);
    }
  });

  await Promise.allSettled(requests);
  return articles;
}

export async function fetchAllFeeds(options: { seasonal?: boolean } = {}): Promise<ArticleInput[]> {
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

  // Basic URL deduplication before further processing
  const seenUrls = new Set<string>();
  const unique: ArticleInput[] = [];

  for (const article of [...googleNews, ...bingNews, ...direct]) {
    if (!seenUrls.has(article.link)) {
      seenUrls.add(article.link);
      unique.push(article);
    }
  }

  return unique;
}
