import { stringSimilarity } from 'string-similarity-js';
import { SYNONYMS, FILLER, PROVINCES, AREA_ALIASES, CONFIG } from './feeds.ts';

// Casualty parsing lives in casualties.ts. Re-exported here so existing callers
// keep working; new code should import readCasualties() directly.
export {
  readCasualties,
  extractDeaths,
  extractInjuries,
  normalizeDigits,
  parseThaiWordNumber,
  CASUALTY_EXTRACTOR_VERSION
} from './casualties.ts';
export type {
  CasualtyFact,
  CasualtyReading,
  CasualtyInput,
  CasualtyField,
  CasualtyScope,
  Evidence
} from './casualties.ts';

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

export function extractProvinces(text: string): string[] {
  const found = new Set<string>();

  for (const [area, province] of Object.entries(AREA_ALIASES)) {
    if (text.includes(area)) found.add(province);
  }

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

export type CasualtyAgreement = 'agree' | 'unknown' | 'conflict';

/**
 * Absence of a figure is not evidence that two reports describe different
 * events. Until the extractor rewrite both sides were almost always null, so
 * the old `deathsA === deathsB` check was a veto that never actually fired;
 * turning it on unchanged would have split every crash whose outlets disagreed
 * on the toll.
 */
export function casualtyAgreement(a: number | null, b: number | null): CasualtyAgreement {
  if (a === null || b === null) return 'unknown';
  return a === b ? 'agree' : 'conflict';
}

export interface SameStoryInput {
  title: string;
  provinces: string[];
  deaths: number | null;
  injuries: number | null;
  /** Used only to bound a conflicting-toll merge. */
  published?: Date | null;
}

export function isSameStory(a: SameStoryInput, b: SameStoryInput): boolean {
  const similarity = stringSimilarity(normalizeTitle(a.title), normalizeTitle(b.title));
  if (similarity < CONFIG.SIMILARITY_THRESHOLD) return false;

  // Thai DUI headlines are highly templated: the same sentence with a
  // different province scores ~0.89, and two checkpoint round-ups differing
  // only in the arrest count score ~0.94. So the signature checks are
  // mandatory — text similarity alone never merges two stories.
  const provMatch =
    a.provinces.some(p => b.provinces.includes(p)) ||
    (a.provinces.length === 0 && b.provinces.length === 0);
  if (!provMatch) return false;

  const vehicleA = getVehicleSignature(a.title);
  const vehicleB = getVehicleSignature(b.title);
  const vehicleMatch = vehicleA === vehicleB && vehicleA !== '';
  const strong = similarity >= CONFIG.STRONG_SIMILARITY;

  const deaths = casualtyAgreement(a.deaths, b.deaths);
  const injuries = casualtyAgreement(a.injuries, b.injuries);

  if (deaths === 'conflict' || injuries === 'conflict') {
    // A death toll rises as victims die, so two outlets reporting 2 and 3 on
    // the same crash must still merge — but only on strong evidence, or the
    // checkpoint round-ups the comment above is guarding would collapse too.
    if (!strong || !vehicleMatch) return false;
    if (!withinConflictWindow(a.published, b.published)) return false;
    return true;
  }

  return vehicleMatch || strong;
}

function withinConflictWindow(a?: Date | null, b?: Date | null): boolean {
  if (!a || !b) return true;
  const hours = Math.abs(a.getTime() - b.getTime()) / 3_600_000;
  return hours <= CONFIG.CASUALTY_CONFLICT_WINDOW_HOURS;
}
