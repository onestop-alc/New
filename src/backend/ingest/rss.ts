import Parser from 'rss-parser';
import { GOOGLE_NEWS_QUERIES, DIRECT_FEEDS } from './feeds.js';
import sanitizeHtml from 'sanitize-html';

const parser = new Parser();

export interface ArticleInput {
  title: string;
  link: string;
  pubDate: Date;
  source: string;
  summary: string;
}

function cleanHtml(html: string | undefined): string {
  if (!html) return '';
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  return text.substring(0, 300).trim(); // Limit to 300 chars
}

export async function fetchGoogleNews(): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];
  
  for (const query of GOOGLE_NEWS_QUERIES) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=th&gl=TH&ceid=TH:th`;
      const feed = await parser.parseURL(url);
      
      for (const item of feed.items) {
        if (!item.title || !item.link || !item.pubDate) continue;
        // Google news title format: "Article Title - Source Name"
        const titleParts = item.title.split(' - ');
        const source = titleParts.length > 1 ? titleParts.pop()! : 'Google News';
        const title = titleParts.join(' - ');
        
        articles.push({
          title,
          link: item.link,
          pubDate: new Date(item.pubDate),
          source,
          summary: cleanHtml(item.contentSnippet || item.content || item.summary)
        });
      }
    } catch (e) {
      console.error(`Failed to fetch Google News for query ${query}:`, e);
    }
  }
  return articles;
}

export async function fetchDirectFeeds(): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];
  
  const promises = DIRECT_FEEDS.map(async (url) => {
    try {
      const feed = await parser.parseURL(url);
      const source = feed.title || 'Unknown Source';
      for (const item of feed.items) {
        if (!item.title || !item.link || !item.pubDate) continue;
        articles.push({
          title: item.title,
          link: item.link,
          pubDate: new Date(item.pubDate),
          source,
          summary: cleanHtml(item.contentSnippet || item.content || item.summary)
        });
      }
    } catch (e) {
      console.error(`Failed to fetch feed ${url}:`, e);
    }
  });

  await Promise.allSettled(promises);
  return articles;
}

export async function fetchAllFeeds(): Promise<ArticleInput[]> {
  const [googleNews, direct] = await Promise.all([
    fetchGoogleNews(),
    fetchDirectFeeds()
  ]);
  
  // Basic URL deduplication before further processing
  const seenUrls = new Set<string>();
  const unique: ArticleInput[] = [];
  
  for (const article of [...googleNews, ...direct]) {
    if (!seenUrls.has(article.link)) {
      seenUrls.add(article.link);
      unique.push(article);
    }
  }
  
  return unique;
}
