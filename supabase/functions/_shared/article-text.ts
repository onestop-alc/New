/**
 * Publisher-page reader.
 *
 * The RSS description is stripped to 300 characters and often cut mid-sentence,
 * and the Google News path carries no description at all — so for a headline
 * whose casualty figure never made it into either, the count only exists on the
 * publisher's page.
 *
 * Bodies are held in memory for the duration of the run and NEVER written to the
 * database. The only body-derived text that is persisted is the short snippet
 * that evidences a figure (articles.casualty_snippet). That keeps the copyright
 * and PDPA surface at quote scale, at the cost of having to re-crawl when the
 * extractor changes — which is what scripts/refetch-bodies.ts is for.
 *
 * Runtime-agnostic: global fetch, AbortSignal.timeout and ReadableStream exist
 * in both Node 18+ and Deno, and the HTML is parsed with regexes rather than a
 * DOM library so no dependency has to be added to both manifests.
 */

export type BodyVia = 'jsonld' | 'og' | 'paragraphs';

export interface BodyResult {
  text: string;
  via: BodyVia;
}

/** Returns null whenever the page yielded nothing better than the RSS summary. */
export type BodyFetcher = (url: string) => Promise<BodyResult | null>;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const NAMED_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&apos;': "'", '&#39;': "'", '&ldquo;': '“', '&rdquo;': '”', '&hellip;': '…',
  '&ndash;': '–', '&mdash;': '—'
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&[a-z]+;|&#\d+;/gi, entity => {
      const named = NAMED_ENTITIES[entity.toLowerCase()];
      if (named !== undefined) return named;
      const numeric = entity.match(/^&#(\d+);$/);
      if (numeric) return String.fromCodePoint(Number(numeric[1]));
      return entity;
    });
}

/**
 * Single HTML-to-text decoder for the whole project. Both RSS layers and the
 * body reader used to carry their own copy.
 */
export function stripHtml(html: string, maxLength: number): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function clip(text: string, maxChars: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function matchMeta(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i')
  ];
  for (const pattern of patterns) {
    const found = html.match(pattern);
    if (found?.[1]) return decodeEntities(found[1]);
  }
  return null;
}

const ARTICLE_TYPES = new Set(['NewsArticle', 'Article', 'ReportageNewsArticle', 'BlogPosting']);

/** Walks @graph / arrays / nested objects looking for an article body. */
function pickArticleBody(node: unknown, depth = 0): string | null {
  if (depth > 6 || node === null || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickArticleBody(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  const rawType = record['@type'];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  if (types.some(t => typeof t === 'string' && ARTICLE_TYPES.has(t))) {
    for (const key of ['articleBody', 'description']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) return value;
    }
  }

  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
    const found = pickArticleBody(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const PARAGRAPH_SCOPES = [
  /<article\b[\s\S]*?<\/article>/i,
  /itemprop=["']articleBody["'][\s\S]{0,40000}/i,
  /class=["'][^"']*(?:entry-content|article-content|detail|post-content)[^"']*["'][\s\S]{0,40000}/i
];

/**
 * Pure parser, so it can be unit-tested against saved fixtures without network.
 * Order matters: Thai publishers are mostly WordPress with Yoast/RankMath and
 * emit a reliable JSON-LD articleBody; og:description is a real sentence where
 * the RSS cut is not; paragraph scraping is the last resort.
 */
export function extractBodyText(html: string, maxChars: number): BodyResult | null {
  const capped = html.slice(0, 1_000_000);

  for (const match of capped.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    const body = pickArticleBody(safeJson(match[1].trim()));
    if (body) {
      const text = clip(stripHtml(body, maxChars * 2), maxChars);
      if (text.length > 160) return { text, via: 'jsonld' };
    }
  }

  const og = matchMeta(capped, 'og:description') ?? matchMeta(capped, 'description');

  let scope: string | null = null;
  for (const pattern of PARAGRAPH_SCOPES) {
    const found = capped.match(pattern);
    if (found) { scope = found[0]; break; }
  }
  if (scope) {
    const cleaned = scope
      .replace(/<(script|style|figure|figcaption|aside|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    const paragraphs = [...cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(p => stripHtml(p[1], maxChars))
      .filter(t => t.length > 40)
      .join(' ');
    if (paragraphs.length > 160) {
      return { text: clip([og, paragraphs].filter(Boolean).join(' '), maxChars), via: 'paragraphs' };
    }
  }

  if (og && og.trim().length > 60) return { text: clip(og, maxChars), via: 'og' };
  return null;
}

export interface BodyFetchConfig {
  timeoutMs: number;
  maxChars: number;
  maxBytes: number;
  hostDelayMs: number;
}

/** Reads at most maxBytes, then cancels — a runaway page must not eat the run. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let text = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (total >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

/**
 * Politeness is enforced per hostname: one request in flight at a time with a
 * fixed gap, and a host that answers 403/429 is dropped for the rest of the
 * process rather than retried.
 */
export function createBodyFetcher(config: BodyFetchConfig): BodyFetcher {
  const nextAllowedAt = new Map<string, number>();
  const deadHosts = new Set<string>();

  return async function fetchBody(url: string): Promise<BodyResult | null> {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return null;
    }
    if (deadHosts.has(host)) return null;

    const waitUntil = nextAllowedAt.get(host) ?? 0;
    const wait = waitUntil - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    nextAllowedAt.set(host, Date.now() + config.hostDelayMs);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'th,en;q=0.8'
        },
        signal: AbortSignal.timeout(config.timeoutMs),
        redirect: 'follow'
      });

      if (response.status === 403 || response.status === 429) {
        deadHosts.add(host);
        await response.body?.cancel().catch(() => {});
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      if (!/text\/html|application\/xhtml/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel().catch(() => {});
        return null;
      }

      const html = await readCapped(response, config.maxBytes);
      return extractBodyText(html, config.maxChars);
    } catch {
      // Timeout, DNS, TLS, paywall redirect loop: the headline still goes on.
      return null;
    }
  };
}
