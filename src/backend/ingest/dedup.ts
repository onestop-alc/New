import { stringSimilarity } from 'string-similarity-js';
import { SYNONYMS, FILLER, PROVINCES, CONFIG } from './feeds.js';

export function normalizeTitle(title: string): string {
  let normalized = title;

  // Replace synonyms with symbols. split/join instead of RegExp because keys
  // like "จยย." contain regex metacharacters.
  for (const [word, symbol] of Object.entries(SYNONYMS)) {
    normalized = normalized.split(word).join(symbol);
  }

  // Remove filler words. No \b anchors: JavaScript word boundaries are defined
  // against [A-Za-z0-9_], so they never match between two Thai characters and
  // the removal silently did nothing — which inflated every similarity score.
  for (const word of FILLER) {
    normalized = normalized.split(word).join('');
  }

  return normalized.trim();
}

export function extractTrgmKey(title: string): string {
  // Trgm key is simple normalization without symbols (letters and numbers only)
  return title.replace(/[^ก-๙a-zA-Z0-9]/g, '');
}

const THAI_NUMBER_WORDS = [
  "หนึ่ง", "เอ็ด", "สอง", "ยี่", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า", "สิบ"
] as const;

const THAI_NUMBERS: Record<string, number> = {
  "หนึ่ง": 1, "เอ็ด": 1, "สอง": 2, "ยี่": 2, "สาม": 3, "สี่": 4,
  "ห้า": 5, "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9, "สิบ": 10
};

/**
 * Casualty counts, e.g. "ดับ 2 ราย" / "ชนดับสองคน".
 * The Thai numeral alternation is explicit and followed by a negative
 * lookahead: a greedy [ก-๙]+ swallows the next word ("สองคน") and never
 * resolves. The regex is scanned globally so an early non-numeric match does
 * not shadow a later real one.
 */
function extractCount(title: string, keywords: string[]): number | null {
  const pattern = new RegExp(
    `(?:${keywords.join('|')})\\s*(\\d+|${THAI_NUMBER_WORDS.join('|')})(?![ก-๙])`,
    'g'
  );
  for (const match of title.matchAll(pattern)) {
    const value = match[1];
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    if (THAI_NUMBERS[value]) return THAI_NUMBERS[value];
  }
  return null;
}

export function extractDeaths(title: string): number | null {
  const count = extractCount(title, ['ดับ', 'เสียชีวิต', 'ตาย']);
  if (count !== null) return count;
  // "ดับคาที่" / "ดับสลด" without a number implies a single fatality.
  if (/ดับคาที่|ดับสลด|เสียชีวิตคาที่/.test(title)) return 1;
  return null;
}

export function extractInjuries(title: string): number | null {
  const count = extractCount(title, ['บาดเจ็บ', 'สาหัส', 'เจ็บ']);
  if (count !== null) return count;
  if (/บาดเจ็บสาหัส|อาการสาหัส|โคม่า/.test(title)) return 1;
  return null;
}

export function extractProvinces(text: string): string[] {
  const found = new Set<string>();
  for (const province of PROVINCES) {
    if (text.includes(province)) {
      if (province === 'กทม' || province === 'กทม.') {
        found.add('กรุงเทพมหานคร');
      } else if (province === 'โคราช') {
        found.add('นครราชสีมา');
      } else if (province === 'พัทยา') {
        found.add('ชลบุรี');
      } else if (province === 'หาดใหญ่') {
        found.add('สงขลา');
      } else {
        found.add(province);
      }
    }
  }
  return Array.from(found);
}

// Function to check if vehicles match (basic check)
export function getVehicleSignature(title: string): string {
  const v = [];
  if (title.includes('จยย.') || title.includes('จักรยานยนต์') || title.includes('มอเตอร์ไซค์')) v.push('2W');
  if (title.includes('เก๋ง') || title.includes('รถเก๋ง')) v.push('4W-C');
  if (title.includes('กระบะ') || title.includes('ปิกอัพ')) v.push('4W-P');
  if (title.includes('บรรทุก') || title.includes('สิบล้อ') || title.includes('พ่วง')) v.push('Truck');
  if (title.includes('ตู้')) v.push('Van');
  return v.sort().join(',');
}

export function isSameStory(
  titleA: string, titleB: string,
  provincesA: string[], provincesB: string[],
  deathsA: number | null, deathsB: number | null,
  injuriesA: number | null, injuriesB: number | null
): boolean {
  const normA = normalizeTitle(titleA);
  const normB = normalizeTitle(titleB);
  
  const similarity = stringSimilarity(normA, normB);
  if (similarity < CONFIG.SIMILARITY_THRESHOLD) return false;

  // Thai DUI headlines are highly templated: the same sentence with a
  // different province scores ~0.89, and two checkpoint round-ups differing
  // only in the arrest count score ~0.94. So the signature checks are
  // mandatory — text similarity alone never merges two stories.
  const provMatch =
    provincesA.some(p => provincesB.includes(p)) ||
    (provincesA.length === 0 && provincesB.length === 0);
  if (!provMatch) return false;

  const deathMatch = deathsA === deathsB;
  const injuryMatch = injuriesA === injuriesB || injuriesA === null || injuriesB === null;
  if (!deathMatch || !injuryMatch) return false;

  const vehicleA = getVehicleSignature(titleA);
  const vehicleB = getVehicleSignature(titleB);
  const vehicleMatch = vehicleA === vehicleB && vehicleA !== '';

  return vehicleMatch || similarity >= CONFIG.STRONG_SIMILARITY;
}
