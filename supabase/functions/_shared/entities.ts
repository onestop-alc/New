/**
 * Entity extraction for story deduplication.
 *
 * String similarity alone cannot merge two reports of one crash: an outlet that
 * rewrites the headline from scratch — "ดับ 3 ศพ! เก๋งหรูพุ่งชนสามล้อ" versus
 * "เปิดวงจรปิดนาทีบีเอ็มชนตุ๊กตุ๊ก" — shares almost no trigrams with the first
 * report, so the pair was rejected before any signature was consulted.
 *
 * What two reports of one event *do* share is the concrete detail: the
 * landmark, the victim's age, the marque, the job title. This module pulls
 * those out of a headline and scores the overlap between two of them.
 *
 * Entities are split into two tiers because the weights alone are not enough of
 * a guard. A province plus a vehicle type plus a matching toll is a plausible
 * score for two *different* crashes on the same night, so isSameStory() also
 * requires at least one shared `rare` entity — something a second, unrelated
 * crash would be unlikely to reproduce.
 */
import { AREA_ALIASES, VEHICLE_CLASSES, VEHICLE_MARQUES } from './feeds.ts';
import { normalizeDigits } from './casualties.ts';

export type EntityTier = 'rare' | 'generic';

export interface Entity {
  /** `${kind}:${value}` — two sets match on this string. */
  key: string;
  weight: number;
  tier: EntityTier;
}

export type EntitySet = Map<string, Entity>;

export interface EntityInput {
  title: string;
  provinces: string[];
  deaths: number | null;
  injuries: number | null;
}

export interface EntityOverlap {
  score: number;
  /** Number of shared rare entities. Zero means "do not merge on this alone". */
  rare: number;
  /** Shared keys, so the retroactive merge script can explain a grouping. */
  shared: string[];
}

const WEIGHT = {
  landmark: 3,
  name: 3,
  age: 2,
  marque: 2,
  specificRole: 2,
  nationality: 2,
  deaths: 1.5,
  province: 1,
  vehicle: 1,
  injuries: 1,
  genericRole: 1
};

/**
 * Sentinel used to blank out a longer term before scanning for a shorter one it
 * contains — จักรยานยนต์/จักรยาน, ปราจีนบุรี/จีน. A space would match every title.
 */
const MASK = '\u0000';

/**
 * 'สน.' pins a story to Bangkok but appears in a large share of Bangkok crime
 * headlines, so it is a province hint rather than a landmark. Every other
 * AREA_ALIASES key names one district, road or beach.
 */
const GENERIC_AREAS = new Set(['สน.']);

/** Longest first: 'นางสาว' must win over 'นาง'. */
const HONORIFICS = [
  'นางสาว', 'ด.ช.', 'ด.ญ.', 'น.ส.', 'เสี่ย', 'น้อง', 'ยาย', 'ลุง', 'ป้า', 'นาย', 'นาง'
].sort((a, b) => b.length - a.length);

/**
 * 'นาย' and 'นาง' open a job title as often as a name. Rather than guess at
 * Thai name morphology, drop the captures that are plainly an office.
 */
const NOT_A_NAME = [
  'กรัฐมนตรี', 'กเทศมนตรี', 'กอบต.', 'กอำเภอ', 'กสมาคม', 'กสภา', 'กเล็ก',
  'อำเภอ', 'ตำรวจ', 'แพทย์', 'พยาบาล', 'ทหาร', 'ประกัน', 'จ้าง', 'ทุน',
  'สาว', 'ชาย', 'ฟ้า', 'เอก', 'ท้าย', 'หน้า', 'แบบ', 'เรือ', 'สนาม',
  // "ด.ช.วัย 14 ปี" and "นายอายุ 30 ปี" are ages, not names.
  'วัย', 'อายุ', 'ราย', 'คน'
];

/**
 * A quoted phrase is a name only when it is not simply the subject of the
 * story: Thai headlines quote “เมาแล้วขับ” and “ด่านปากหวาน” constantly, and
 * treating those as rare entities would merge every checkpoint round-up in the
 * country into one story.
 */
const QUOTE_NOISE = [
  'เมา', 'ดื่ม', 'แอลกอฮอล์', 'ด่าน', 'ขับ', 'ขี่', 'ชน', 'ดับ', 'ตาย', 'ศพ',
  'จับ', 'ปี', 'คดี', 'กฎหมาย', 'อันตราย'
];

const QUOTE_PAIRS: Array<[string, string]> = [
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['«', '»'],
  ['"', '"'],
  ["'", "'"]
];

/**
 * A foreign nationality is rare in a Thai DUI headline and, when present, is
 * almost always the detail every outlet keeps: two reports of one crash both
 * say แรงงานเมียนมา or นักท่องเที่ยวจีน even when nothing else survives the
 * rewrite. Codes are canonical so พม่า and เมียนมา compare equal.
 */
const NATIONALITIES: Array<[string, string[]]> = [
  ['เมียนมา', ['เมียนมา', 'พม่า']],
  ['กัมพูชา', ['กัมพูชา', 'เขมร']],
  ['ลาว', ['ลาว']],
  ['เวียดนาม', ['เวียดนาม']],
  ['จีน', ['จีน', 'ไต้หวัน']],
  ['เกาหลี', ['เกาหลี']],
  ['ญี่ปุ่น', ['ญี่ปุ่น']],
  ['อินเดีย', ['อินเดีย']],
  ['รัสเซีย', ['รัสเซีย']],
  ['อังกฤษ', ['อังกฤษ']],
  ['เยอรมัน', ['เยอรมัน', 'เยอรมนี']],
  ['ฝรั่งเศส', ['ฝรั่งเศส']],
  ['อเมริกา', ['อเมริกา', 'สหรัฐ']],
  ['มาเลเซีย', ['มาเลเซีย']],
  ['สิงคโปร์', ['สิงคโปร์']]
];

/**
 * Thai place names that contain a nationality: ปราจีนบุรี holds จีน. Masked out
 * before the scan, the same trick the motorcycle/bicycle clash uses.
 */
const NATIONALITY_FALSE_FRIENDS = ['ปราจีน'];

/** Offices held by one identifiable person — a strong same-event signal. */
const SPECIFIC_ROLES: Array<[string, string[]]> = [
  ['ผู้ใหญ่บ้าน', ['ผู้ใหญ่บ้าน', 'ผญบ.', 'ผญ.บ.']],
  ['กำนัน', ['กำนัน']],
  ['นายอำเภอ', ['นายอำเภอ']],
  ['ผอ.โรงเรียน', ['ผอ.โรงเรียน', 'ผอ.ร.ร.', 'ผู้อำนวยการโรงเรียน', 'ครูใหญ่']],
  ['ผอ.รพ.สต.', ['ผอ.รพ.สต.', 'ผู้อำนวยการโรงพยาบาลส่งเสริม']],
  ['อบต.', ['ส.อบต.', 'นายกอบต.', 'นายก อบต.']],
  ['เทศมนตรี', ['เทศมนตรี']],
  ['สจ.', ['ส.จ.', 'สจ.']],
  ['พระ', ['พระสงฆ์', 'หลวงพ่อ', 'หลวงพี่', 'สามเณร']],
  ['ผู้พิพากษา', ['ผู้พิพากษา', 'อัยการ']],
  ['คนดัง', ['ดารา', 'นักร้อง', 'อินฟลูเอนเซอร์', 'ยูทูบเบอร์', 'เน็ตไอดอล']]
];

/** Everyday descriptions. Shared constantly, so never enough on their own. */
const GENERIC_ROLES: Array<[string, string[]]> = [
  ['นักเรียน', ['นักเรียน', 'นร.']],
  ['นักศึกษา', ['นักศึกษา', 'นศ.']],
  ['ตำรวจ', ['ตำรวจ', 'ตร.']],
  ['ทหาร', ['ทหาร']],
  ['ครู', ['ครู']],
  ['บุคลากรแพทย์', ['แพทย์', 'พยาบาล', 'คุณหมอ']],
  ['วัยรุ่น', ['วัยรุ่น']],
  ['ไรเดอร์', ['ไรเดอร์']]
];

/**
 * Vehicle classes named in a headline, e.g. ['3W', '4W-C'].
 * getVehicleSignature() in dedup.ts is this list joined.
 */
export function vehicleClasses(title: string): string[] {
  // 'จักรยานยนต์' contains 'จักรยาน', so a motorcycle would otherwise also be
  // classed as a bicycle and never match another report of the same crash.
  const text = title.toLowerCase().split('จักรยานยนต์').join(MASK);
  const found = new Set<string>();

  for (const { code, terms } of VEHICLE_CLASSES) {
    if (terms.some(term => text.includes(term))) found.add(code);
  }
  if (text.includes(MASK)) found.add('2W');

  return Array.from(found).sort();
}

/** Marque codes named in a headline, e.g. ['bmw']. */
export function vehicleMarques(title: string): string[] {
  const text = title.toLowerCase();
  return VEHICLE_MARQUES
    .filter(marque => marque.terms.some(term => text.includes(term)))
    .map(marque => marque.code);
}

function landmarks(title: string): string[] {
  return Object.keys(AREA_ALIASES).filter(
    area => !GENERIC_AREAS.has(area) && title.includes(area)
  );
}

function ages(title: string): number[] {
  const found = new Set<number>();
  // {1,3} keeps พ.ศ. 2568 and ค.ศ. 2026 out without a lookbehind, which is not
  // available in every runtime this file has to compile for.
  for (const match of normalizeDigits(title).matchAll(/(\d{1,3})\s*ปี/g)) {
    const age = Number(match[1]);
    if (age >= 1 && age <= 110) found.add(age);
  }
  return Array.from(found);
}

function quotedSpans(title: string): string[] {
  const found: string[] = [];
  for (const [open, close] of QUOTE_PAIRS) {
    const pattern = new RegExp(`${open}([^${open}${close}]{2,25})${close}`, 'g');
    for (const match of title.matchAll(pattern)) found.push(match[1].trim());
  }
  return found;
}

function names(title: string): string[] {
  const found = new Set<string>();

  for (const span of quotedSpans(title)) {
    const isSubject = QUOTE_NOISE.some(noise => span.includes(noise));
    const hasHonorific = HONORIFICS.some(honorific => span.includes(honorific));
    if (isSubject && !hasHonorific) continue;
    found.add(span.replace(/\s+/g, ''));
  }

  for (const honorific of HONORIFICS) {
    let from = 0;
    for (;;) {
      const at = title.indexOf(honorific, from);
      if (at === -1) break;
      from = at + honorific.length;
      const token = /^[ก-๙]{2,10}/.exec(title.slice(from))?.[0];
      if (!token) continue;
      if (NOT_A_NAME.some(word => token.startsWith(word))) continue;
      found.add(token);
    }
  }

  return Array.from(found);
}

function nationalities(title: string): string[] {
  let text = title;
  for (const place of NATIONALITY_FALSE_FRIENDS) text = text.split(place).join(MASK);
  return matchedRoles(text, NATIONALITIES);
}

function matchedRoles(title: string, table: Array<[string, string[]]>): string[] {
  return table.filter(([, terms]) => terms.some(term => title.includes(term))).map(([code]) => code);
}

export function extractEntities(input: EntityInput): EntitySet {
  const set: EntitySet = new Map();
  const add = (kind: string, value: string | number, weight: number, tier: EntityTier) => {
    const key = `${kind}:${value}`;
    if (!set.has(key)) set.set(key, { key, weight, tier });
  };

  for (const area of landmarks(input.title)) add('landmark', area, WEIGHT.landmark, 'rare');
  for (const name of names(input.title)) add('name', name, WEIGHT.name, 'rare');
  for (const age of ages(input.title)) add('age', age, WEIGHT.age, 'rare');
  for (const marque of vehicleMarques(input.title)) add('marque', marque, WEIGHT.marque, 'rare');
  for (const role of matchedRoles(input.title, SPECIFIC_ROLES)) {
    add('role', role, WEIGHT.specificRole, 'rare');
  }
  for (const code of nationalities(input.title)) {
    add('nationality', code, WEIGHT.nationality, 'rare');
  }

  for (const province of input.provinces) add('province', province, WEIGHT.province, 'generic');
  for (const code of vehicleClasses(input.title)) add('vehicle', code, WEIGHT.vehicle, 'generic');
  for (const role of matchedRoles(input.title, GENERIC_ROLES)) {
    add('who', role, WEIGHT.genericRole, 'generic');
  }

  // A null figure produces no key at all, so it can never match: absence is
  // silence, the same three-state reasoning casualtyAgreement() uses.
  if (input.deaths !== null) add('deaths', input.deaths, WEIGHT.deaths, 'generic');
  if (input.injuries !== null) add('injuries', input.injuries, WEIGHT.injuries, 'generic');

  return set;
}

export function entityScore(a: EntitySet, b: EntitySet): EntityOverlap {
  let score = 0;
  let rare = 0;
  const shared: string[] = [];

  for (const [key, entity] of a) {
    if (!b.has(key)) continue;
    score += entity.weight;
    if (entity.tier === 'rare') rare++;
    shared.push(key);
  }

  // The 1.5 weights mean a plain sum can land on 4.499999999999999.
  return { score: Math.round(score * 100) / 100, rare, shared };
}
