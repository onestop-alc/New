/**
 * One outlet, one identity.
 *
 * The same publisher reaches us under two naming conventions: Google News puts
 * a display name in <source> ("The Bangkok Insight", "ข่าวสด") while Bing only
 * gives a link, so we derive a hostname ("thebangkokinsight.com",
 * "khaosod.co.th"). Counting those as two outlets made single-source stories
 * look corroborated and earned them a false HIGH badge.
 *
 * canonicalSource() collapses both shapes onto the same key, and flags the
 * aggregators that republish other outlets' reporting — those are distribution,
 * not independent corroboration.
 */

/** Domain suffixes stripped when reducing a hostname to its outlet label. */
const DOMAIN_SUFFIXES = new Set([
  'com', 'net', 'org', 'co', 'th', 'or', 'ac', 'go', 'in', 'me', 'tv',
  'io', 'asia', 'info', 'news', 'app', 'online', 'website'
]);

/** Display names (Google News <source>) mapped onto the hostname-derived key. */
export const SOURCE_ALIASES: Record<string, string> = {
  'ข่าวสด': 'khaosod',
  'มติชนออนไลน์': 'matichon',
  'มติชน': 'matichon',
  'เดลินิวส์': 'dailynews',
  'ไทยรัฐ': 'thairath',
  'ไทยรัฐออนไลน์': 'thairath',
  'ผู้จัดการออนไลน์': 'mgronline',
  'ประชาชาติธุรกิจ': 'prachachat',
  'กรุงเทพธุรกิจ': 'bangkokbiznews',
  'คมชัดลึก': 'komchadluek',
  'แนวหน้า': 'naewna',
  'บ้านเมือง': 'banmuang',
  'สยามรัฐ': 'siamrath',
  'ไทยโพสต์': 'thaipost',
  'ข่าวช่อง 8': 'thaich8',
  'ช่อง 7': 'ch7',
  'สวพ.fm91': 'fm91',
  'จส.100': 'js100',
  'อมรินทร์ ทีวี': 'amarintv',
  'amarin tv': 'amarintv',
  'amarintv': 'amarintv',
  'thai pbs': 'thaipbs',
  'ไทยพีบีเอส': 'thaipbs',
  'tnn thailand': 'tnn',
  'tnn ช่อง 16': 'tnn',
  'the bangkok insight': 'thebangkokinsight',
  'the better': 'thebetter',
  'the standard': 'thestandard',
  'the reporters': 'thereporters',
  'workpoint today': 'workpointtoday',
  'pptv hd 36': 'pptvhd36',
  'nation tv': 'nationtv',
  'top news': 'topnews',
  'ch7.com': 'ch7',
  'thaiger': 'thaiger',
  'ไทยเกอร์': 'thaiger',
  'trueid': 'trueid',
  'sanook': 'sanook',
  'kapook': 'kapook',
  'line today': 'line',
  'msn': 'msn'
};

/**
 * Republishers. They carry real articles, so their rows stay in the story, but
 * they never count towards "N independent outlets reported this".
 */
export const AGGREGATOR_SOURCES = new Set([
  'msn', 'line', 'trueid', 'kapook', 'sanook', 'thaitabloid',
  'facebook', 'youtube', 'tiktok', 'x', 'twitter', 'instagram',
  'google', 'bing'
]);

export interface SourceIdentity {
  /** Stable key for one outlet, used for counting. */
  key: string;
  /** True when the outlet republishes other people's reporting. */
  aggregator: boolean;
}

function hostnameToKey(hostname: string): string {
  const labels = hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean);

  // Drop suffix labels from the right: today.line.me -> [today, line],
  // thairath.co.th -> [thairath], bugaboo.tv -> [bugaboo].
  while (labels.length > 1 && DOMAIN_SUFFIXES.has(labels[labels.length - 1])) {
    labels.pop();
  }

  return labels[labels.length - 1] ?? hostname.toLowerCase();
}

export function canonicalSource(source: string): SourceIdentity {
  const raw = (source ?? '').trim();
  if (!raw) return { key: 'unknown', aggregator: false };

  const lower = raw.toLowerCase();
  const alias = SOURCE_ALIASES[lower];

  let key: string;
  if (alias) {
    key = alias;
  } else if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(lower)) {
    key = hostnameToKey(lower);
    // A hostname can still map onto a display-name alias (khaosod.co.th).
    key = SOURCE_ALIASES[key] ?? key;
  } else {
    // Unknown display name: fold whitespace and punctuation so "TNN Thailand"
    // and "tnn  thailand" agree.
    key = lower.replace(/[\s.\-_'"()]+/g, '');
  }

  return { key, aggregator: AGGREGATOR_SOURCES.has(key) };
}
