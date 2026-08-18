import { stringSimilarity } from 'string-similarity-js';
import { SYNONYMS, FILLER, PROVINCES, AREA_ALIASES, CONFIG } from './feeds.ts';
import { extractEntities, entityScore, vehicleClasses } from './entities.ts';

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

export function getVehicleSignature(title: string): string {
  return vehicleClasses(title).join(',');
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

type ProvinceAgreement = 'agree' | 'unknown' | 'conflict';

/**
 * Same three-state reasoning as the casualty check: a report that never named a
 * place is silence, not a claim that the place was different. Treating an empty
 * province list as a mismatch blocked follow-up coverage from merging, because
 * a headline like "ศาลให้ประกันหนุ่มเมาขับบีเอ็ม" names no province at all.
 */
function provinceAgreement(a: string[], b: string[]): ProvinceAgreement {
  if (a.length === 0 || b.length === 0) return 'unknown';
  return a.some(p => b.includes(p)) ? 'agree' : 'conflict';
}

function daysApart(a?: Date | null, b?: Date | null): number {
  if (!a || !b) return 0;
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

export function isSameStory(a: SameStoryInput, b: SameStoryInput): boolean {
  // Two named provinces that never intersect is the one veto outranking every
  // signal below, so it is checked before anything is computed.
  const provinces = provinceAgreement(a.provinces, b.provinces);
  if (provinces === 'conflict') return false;

  const deaths = casualtyAgreement(a.deaths, b.deaths);
  const injuries = casualtyAgreement(a.injuries, b.injuries);

  const similarity = stringSimilarity(normalizeTitle(a.title), normalizeTitle(b.title));
  const vehicleA = getVehicleSignature(a.title);
  const vehicleB = getVehicleSignature(b.title);
  const vehicleMatch = vehicleA === vehicleB && vehicleA !== '';
  const strong = similarity >= CONFIG.STRONG_SIMILARITY;

  if (deaths === 'conflict' || injuries === 'conflict') {
    // A death toll rises as victims die, so two outlets reporting 2 and 3 on
    // the same crash must still merge — but only on strong evidence, or the
    // checkpoint round-ups guarded against below would collapse too.
    if (!strong || !vehicleMatch) return false;
    return daysApart(a.published, b.published) * 24 <= CONFIG.CASUALTY_CONFLICT_WINDOW_HOURS;
  }

  /**
   * Thai DUI headlines are highly templated: the same sentence with a different
   * province scores ~0.89, and two checkpoint round-ups differing only in the
   * arrest count score ~0.94. Text similarity alone therefore never merges two
   * stories — every path below needs a signature, a corroborating toll, or a
   * shared entity.
   *
   * The entity paths are what reach coverage that was rewritten from scratch,
   * where similarity is not merely weak but near zero: "ดับ 3 ศพ! เก๋งหรู
   * พุ่งชนสามล้อ" and "เปิดวงจรปิด...บีเอ็มชนตุ๊กตุ๊ก" are one crash and share
   * three trigrams. Both demand a *rare* shared entity — a landmark, an age, a
   * marque, a name, an office — because score alone is reachable by two
   * different crashes in one province on one night.
   */
  const overlap = entityScore(extractEntities(a), extractEntities(b));
  const entityMatch = overlap.rare >= 1 && overlap.score >= CONFIG.ENTITY_MERGE_SCORE;
  const nearDuplicate =
    overlap.rare >= 1 &&
    overlap.score >= CONFIG.ENTITY_NEAR_DUP_SCORE &&
    similarity >= CONFIG.ENTITY_NEAR_DUP_SIMILARITY;

  // Below the threshold the two headlines share almost no wording. That is the
  // case entityMatch exists for, and it is the only path allowed to cross it.
  if (similarity < CONFIG.SIMILARITY_THRESHOLD) return entityMatch;

  /**
   * Follow-up coverage rewords the headline completely — "ศาลให้ประกัน…",
   * "ญาติเชิญดวงวิญญาณ…", "แจ้งข้อหาหนัก…" — so similarity never approaches
   * STRONG_SIMILARITY. Two independent reports stating the SAME toll for the
   * SAME vehicle types is the substitute.
   */
  const corroborated = deaths === 'agree' && a.deaths !== null && vehicleMatch;

  // Beyond the normal window the pair is follow-up coverage of an older event,
  // where wording has drifted and the risk of colliding with a different crash
  // is higher. Only the two paths that require hard evidence are accepted.
  if (daysApart(a.published, b.published) > CONFIG.DEDUP_WINDOW_DAYS) {
    return corroborated || entityMatch;
  }

  // An unnamed province is not evidence of sameness either, so it still needs
  // something concrete to stand on.
  if (provinces === 'unknown') {
    return corroborated || strong || entityMatch || nearDuplicate;
  }

  return vehicleMatch || strong || entityMatch || nearDuplicate;
}
