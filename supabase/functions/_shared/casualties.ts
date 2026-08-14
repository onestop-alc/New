/**
 * Casualty extraction from Thai news text.
 *
 * Runtime-agnostic: imported by both the Deno Edge Function and the Node CLI,
 * so no Deno or Node globals here. Imports only feeds.ts (for the place-name
 * lists) to avoid dragging string-similarity-js into every consumer.
 *
 * Three ideas carry the whole module:
 *
 *  1. MASKING instead of lookaheads. The old extractor tried to stop a numeral
 *     from bleeding into the next word with `(?![ก-๙])`, which instead rejected
 *     every count glued to a Thai counter ("ดับ2ราย", "ชนดับสองคน") and every
 *     Thai digit, since [ก-๙] spans U+0E01–U+0E59 and swallows ๐-๙. Here the
 *     false friends (อันดับ, ระดับ, ไฟดับ, ตายาย, สี่แยก, ร้อยเอ็ด, …) are
 *     replaced with same-length filler first, then matching runs freely.
 *
 *  2. ONE combined left-to-right scan. Running a death regex and an injury
 *     regex independently over the same string lets the death regex eat the
 *     injury's number — which is why "เจ็บ 2 ดับ 3" used to report 2 deaths.
 *     Every casualty keyword is found once, and numbers are attributed to the
 *     nearest keyword with no other keyword in between.
 *
 *  3. UNKNOWN, ZERO and A NUMBER are three different answers. null means the
 *     text does not say; 0 means the text says nobody was hurt. The old code
 *     collapsed both into null and the UI then rendered them as "0".
 *
 * Snippets are reported against the normalised text, not the raw input: the
 * normalisation fixes the เเ→แ typo and rewrites Thai digits, so "ดับ ๒ ราย"
 * is quoted back as "ดับ 2 ราย". Masking is length-preserving so every index
 * lines up between the masked and normalised strings.
 */
import { PROVINCES, AREA_ALIASES } from './feeds.ts';

/** Bump on every behaviour change: the backfill selects rows below it. */
export const CASUALTY_EXTRACTOR_VERSION = 1;

export type Evidence = 'explicit' | 'implied' | 'range' | 'zero';
export type CasualtyScope = 'incident' | 'aggregate';
export type CasualtyField = 'title' | 'summary' | 'body';

export interface CasualtyFact {
  /** null = the text does not say. 0 = the text says nobody. */
  value: number | null;
  evidence: Evidence | null;
  /** 0..1. Drives both field arbitration and the cross-article rollup. */
  confidence: number;
  /** Which rule fired, e.g. 'D1' / 'I4'. Null when nothing did. */
  rule: string | null;
  /** Matched text from the normalised input, for the audit trail. */
  snippet: string | null;
  field: CasualtyField | null;
  scope: CasualtyScope;
}

export interface CasualtyReading {
  deaths: CasualtyFact;
  injuries: CasualtyFact;
  /** True when the text reports a period/region total rather than one crash. */
  aggregate: boolean;
}

export interface CasualtyInput {
  title: string;
  summary?: string;
  body?: string;
}

// ---------------------------------------------------------------- normalising

const THAI_DIGIT_BASE = 0x0e50; // ๐

/** ๐-๙ -> 0-9 and drop thousands separators, so "1,234" is not read as 1. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[๐-๙]/g, c => String(c.codePointAt(0)! - THAI_DIGIT_BASE))
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
}

/**
 * `เเ` (two SARA E) is a near-universal web typo for `แ` and silently breaks
 * every match — the classifier normalises it too (filters.ts).
 */
export function normalizeText(s: string): string {
  return normalizeDigits(
    s.replace(/เเ/g, 'แ').replace(/[ ​‌﻿]/g, ' ')
  );
}

// ------------------------------------------------------------------- numerals

const DIGIT_WORD: Record<string, number> = {
  ศูนย์: 0, หนึ่ง: 1, เอ็ด: 1, สอง: 2, ยี่: 2, สาม: 3, สี่: 4,
  ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9
};

const SCALE_WORD: Record<string, number> = {
  สิบ: 10, ร้อย: 100, พัน: 1000, หมื่น: 10_000
};

const WORD_NUMERAL_SRC =
  'ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย|พัน|หมื่น';

/**
 * Only ever valid as part of a compound (ยี่สิบ, สิบเอ็ด) or as a noun
 * ("ศูนย์อำนวยการ" is a centre, not a zero). Alone they are not counts.
 */
const NON_STANDALONE_WORDS = new Set(['ยี่', 'เอ็ด', 'ศูนย์']);

/**
 * Thai numerals are positional: <unit><scale> pairs summed left to right.
 *   สิบเอ็ด = 11, ยี่สิบสาม = 23, สองร้อยสิบห้า = 215
 * A bare scale means one of it (สิบ = 10). Returns null for a run that is not a
 * complete numeral.
 */
export function parseThaiWordNumber(run: string): number | null {
  const tokens = run.match(new RegExp(WORD_NUMERAL_SRC, 'g'));
  if (!tokens || tokens.join('') !== run) return null;
  if (tokens.length === 1 && NON_STANDALONE_WORDS.has(tokens[0])) return null;

  let total = 0;
  let pending = 0;
  for (const token of tokens) {
    if (token in DIGIT_WORD) {
      pending = DIGIT_WORD[token];
      continue;
    }
    total += (pending || 1) * SCALE_WORD[token];
    pending = 0;
  }
  return total + pending;
}

// -------------------------------------------------------------- false friends

/** ดับ / ตาย / เจ็บ inside an unrelated word. */
const KEYWORD_FALSE_FRIENDS = [
  'จัดอันดับ', 'อันดับ', 'ลำดับ', 'ระดับ', 'ไฟดับ', 'ดับเพลิง', 'ดับเครื่อง',
  'ดับไฟ', 'มอดดับ', 'ดับฝัน', 'ดับอนาคต', 'ดับเบิล', 'ดับกลิ่น', 'ดับร้อน',
  'ตายาย', 'ตายตัว', 'ตายใจ', 'ตายาก',
  'เจ็บป่วย', 'เจ็บใจ', 'เจ็บแค้น', 'เจ็บคอ', 'เจ็บท้อง', 'เจ็บปวดใจ',
  'คร่าว'
];

/** Number words inside a word that is not a number. */
const NUMBER_FALSE_FRIENDS = [
  'ร้อยเอ็ด', 'ร้อยละ', 'ร้อยเวร', 'พันธุ์', 'พันท้าย',
  'สิบล้อ', 'หกล้อ', 'สิบแปดล้อ', 'สามล้อ', 'สองแถว', 'สี่ล้อ',
  'สี่แยก', 'สามแยก', 'ห้าแยก', 'สามเหลี่ยม', 'สามย่าน',
  'ร้อยตำรวจเอก', 'ร้อยตำรวจโท', 'ร้อยตำรวจตรี',
  'พันตำรวจเอก', 'พันตำรวจโท', 'พันตำรวจตรี',
  'สิบตำรวจเอก', 'สิบตำรวจโท', 'สิบตำรวจตรี',
  'ยี่ห้อ', 'เก้าอี้', 'ห้างสรรพสินค้า', 'ห้าง', 'หกล้ม', 'แปดริ้ว', 'ห้ามล้อ'
];

const MASK_CHAR = '·'; // middot — never appears in Thai news copy

/** Length-preserving so every index stays valid against the normalised text. */
function maskTerm(text: string, term: string): string {
  if (!term || !text.includes(term)) return text;
  return text.split(term).join(MASK_CHAR.repeat(term.length));
}

function maskAll(text: string, terms: Iterable<string>): string {
  let out = text;
  for (const term of terms) out = maskTerm(out, term);
  return out;
}

// -------------------------------------------------------------------- lexicon

interface KeywordSpec {
  word: string;
  kind: Kind;
}

type Kind = 'death' | 'injury';

const DEATH_KEYWORDS = [
  'เสียชีวิตในที่เกิดเหตุ', 'เสียชีวิตคาที่', 'ดับคาพวงมาลัย', 'ดับคาซาก',
  'ดับยกครัว', 'ดับคารถ', 'เสียชีวิต', 'สิ้นใจคาที่', 'ตายคาที่', 'ดับคาที่',
  'ดับสลด', 'ดับอนาถ', 'คร่าชีวิต', 'สังเวย', 'สิ้นใจ', 'มรณะ', 'คร่า',
  'ดับ', 'ตาย'
];

const INJURY_KEYWORDS = [
  'บาดเจ็บสาหัส', 'บาดเจ็บเล็กน้อย', 'อาการสาหัส', 'อาการโคม่า',
  'เจ็บสาหัส', 'เจ็บเล็กน้อย', 'บาดเจ็บ', 'โคม่า', 'สาหัส', 'เจ็บ'
];

/** With no number attached, these describe exactly one victim. */
const DEATH_IMPLIED = [
  'ดับคาที่', 'ดับสลด', 'ดับอนาถ', 'ดับยกครัว', 'เสียชีวิตคาที่', 'ตายคาที่',
  'ดับคาพวงมาลัย', 'ดับคารถ', 'ดับคาซาก', 'สิ้นใจคาที่', 'เสียชีวิตในที่เกิดเหตุ'
];

const INJURY_IMPLIED = [
  'บาดเจ็บสาหัส', 'บาดเจ็บเล็กน้อย', 'อาการสาหัส', 'อาการโคม่า',
  'เจ็บสาหัส', 'เจ็บเล็กน้อย', 'โคม่า', 'สาหัส'
];

/** "many" with no figure. Report unknown — never guess 1. */
const INDEFINITE = [
  'หลาย', 'จำนวนมาก', 'ระนาว', 'อื้อ', 'เพียบ', 'เกลื่อน',
  'นับสิบ', 'นับร้อย', 'ไม่ทราบจำนวน', 'นับไม่ถ้วน'
];

interface ZeroPhrase {
  phrase: string;
  kinds: Kind[];
}

/** Explicit statements that nobody was killed / hurt: value 0, not null. */
const ZERO_PHRASES: ZeroPhrase[] = ([
  { phrase: 'ไม่มีผู้เสียชีวิตและบาดเจ็บ', kinds: ['death', 'injury'] },
  { phrase: 'ไม่มีผู้บาดเจ็บและเสียชีวิต', kinds: ['death', 'injury'] },
  { phrase: 'ไม่มีผู้บาดเจ็บหรือเสียชีวิต', kinds: ['death', 'injury'] },
  { phrase: 'ไม่มีรายงานผู้เสียชีวิต', kinds: ['death'] },
  { phrase: 'ไม่มีรายงานผู้บาดเจ็บ', kinds: ['injury'] },
  { phrase: 'ไม่มีผู้ได้รับบาดเจ็บ', kinds: ['injury'] },
  { phrase: 'ไม่มีผู้ใดเสียชีวิต', kinds: ['death'] },
  { phrase: 'ไม่มีผู้ใดบาดเจ็บ', kinds: ['injury'] },
  { phrase: 'ไม่มีใครเสียชีวิต', kinds: ['death'] },
  { phrase: 'ไม่มีใครบาดเจ็บ', kinds: ['injury'] },
  { phrase: 'รอดตายหวุดหวิด', kinds: ['death'] },
  { phrase: 'ไม่มีผู้เสียชีวิต', kinds: ['death'] },
  { phrase: 'ไม่มีผู้บาดเจ็บ', kinds: ['injury'] },
  { phrase: 'ไม่มีใครเจ็บ', kinds: ['injury'] },
  { phrase: 'ไม่มีผู้ตาย', kinds: ['death'] },
  { phrase: 'ไม่มีคนตาย', kinds: ['death'] },
  { phrase: 'ไม่เสียชีวิต', kinds: ['death'] }
] as ZeroPhrase[]).sort((a, b) => b.phrase.length - a.phrase.length);

/**
 * Period / region totals. Real numbers, but a national 7-day toll must never
 * land on a single-crash card, so they are tagged and excluded from the story
 * rollup and the dashboard sums instead of being discarded.
 */
const AGGREGATE_MARKERS = [
  'สรุปยอด', 'ยอดสะสม', 'สถิติ', '7วันอันตราย', 'เจ็ดวันอันตราย', 'ศปถ',
  'ศูนย์อำนวยการความปลอดภัยทางถนน', 'ตลอดทั้งปี', 'ตลอดปี', 'ทั่วประเทศ',
  'รวม7วัน', 'เทียบปีที่แล้ว', 'ยอดรวมทั้งประเทศ'
];

/** Counters that mark a number as people. */
const COUNTER_SRC = 'ราย|คน|ศพ|นาย|ชีวิต|ร่าง';

/**
 * Thai headlines routinely count victims with the noun instead of a counter —
 * "ชน 2 วัยรุ่น ดับ", "ชน2เยาวชนดับ", "2 นักเรียนดับ". Four of these turned up
 * in a single dry run, so they are treated like counters when a number
 * precedes a casualty keyword. Longest-first: เด็กชาย must win over เด็ก.
 */
const PERSON_NOUN_SRC = [
  'ผู้สูงอายุ', 'คนเดินเท้า', 'ผู้โดยสาร', 'นักศึกษา', 'นักเรียน', 'เด็กชาย',
  'เด็กหญิง', 'ครอบครัว', 'เยาวชน', 'วัยรุ่น', 'คนงาน', 'ตำรวจ', 'ทหาร',
  'พ่อลูก', 'แม่ลูก', 'เหยื่อ', 'พลเมือง', 'ชาวบ้าน', 'ผู้ป่วย',
  'หนุ่ม', 'สาว', 'ชาย', 'หญิง', 'เด็ก', 'พระ'
].join('|');

/** A counter that is specific to the dead, so it needs no keyword. */
const DEATH_COUNTER_SRC = 'ศพ';

/** A number followed by one of these is a unit, not a headcount. */
const NON_COUNTER_SRC = [
  'มก', 'มิลลิกรัม', 'เปอร์เซ็นต์', '%', 'บาท', 'ปี', 'เดือน', 'วัน',
  'ชม', 'ชั่วโมง', 'นาที', 'น\\.', 'นาฬิกา', 'กม', 'กิโล', 'เมตร', 'ไมล์',
  'คัน', 'ล้อ', 'ขวด', 'แก้ว', 'ลิตร', 'ล้าน', 'แสน', 'หมื่น',
  'จังหวัด', 'อำเภอ', 'ตำบล', 'หมู่', 'แห่ง', 'จุด', 'ด่าน', 'หลัง', 'ห้อง',
  'ครั้ง', 'เท่า', 'ข้อหา', 'คดี', 'มาตรา', 'ตร\\.ว'
].join('|');

/** A count, optionally expressed as a range ("ดับ 2-3 ราย"). */
const NUM_SRC = String.raw`\d+(?:\s*(?:-|–|—|ถึง)\s*\d+)?`;

/** Bridge between a keyword and its number: "ดับคาที่ 3 ศพ", "ยอดดับพุ่ง 5 ราย". */
const ATTRIBUTION_WINDOW = 12;

// --------------------------------------------------------------------- engine

interface NumToken {
  start: number;
  end: number;
  value: number;
  isWord: boolean;
  isRange: boolean;
  consumed: boolean;
}

interface Mention {
  kind: Kind;
  value: number;
  evidence: Evidence;
  confidence: number;
  rule: string;
  snippet: string;
}

const KEYWORD_SPECS: KeywordSpec[] = [
  ...DEATH_KEYWORDS.map(word => ({ word, kind: 'death' as Kind })),
  ...INJURY_KEYWORDS.map(word => ({ word, kind: 'injury' as Kind }))
].sort((a, b) => b.word.length - a.word.length);

const KEYWORD_RE = new RegExp(KEYWORD_SPECS.map(k => k.word).join('|'), 'g');
const KIND_OF = new Map(KEYWORD_SPECS.map(k => [k.word, k.kind]));

const WORD_NUM_RE = new RegExp(`(?:${WORD_NUMERAL_SRC})+`, 'g');
const ASCII_NUM_RE = new RegExp(NUM_SRC, 'g');
const COUNTER_AFTER_RE = new RegExp(`^\\s*(?:${COUNTER_SRC})`);
const DEATH_COUNTER_AFTER_RE = new RegExp(`^\\s*(?:${DEATH_COUNTER_SRC})`);
const NON_COUNTER_AFTER_RE = new RegExp(`^\\s*(?:${NON_COUNTER_SRC})`);
/** No whitespace between the counter and the keyword — see attributeReverse. */
const COUNTER_ABUTTING_RE = new RegExp(`^\\s*(?:${COUNTER_SRC}|${PERSON_NOUN_SRC})$`);
/** Same, but tolerating a space. Only safe on the late pass — see attributeReverse. */
const COUNTER_LOOSE_RE = new RegExp(`^\\s*(?:${COUNTER_SRC}|${PERSON_NOUN_SRC})\\s*$`);

function firstIndexOfAny(haystack: string, needles: string[]): number {
  let best = -1;
  for (const needle of needles) {
    const at = haystack.indexOf(needle);
    if (at !== -1 && (best === -1 || at < best)) best = at;
  }
  return best;
}

function findNumbers(masked: string): NumToken[] {
  const tokens: NumToken[] = [];

  for (const match of masked.matchAll(ASCII_NUM_RE)) {
    const raw = match[0];
    const digits = raw.match(/\d+/g)!;
    tokens.push({
      start: match.index!,
      end: match.index! + raw.length,
      // A range reports its low bound: "ดับ 2-3 ราย" is at least 2.
      value: parseInt(digits[0], 10),
      isWord: false,
      isRange: digits.length > 1,
      consumed: false
    });
  }

  for (const match of masked.matchAll(WORD_NUM_RE)) {
    const value = parseThaiWordNumber(match[0]);
    if (value === null) continue;
    tokens.push({
      start: match.index!,
      end: match.index! + match[0].length,
      value,
      isWord: true,
      isRange: false,
      consumed: false
    });
  }

  // Unit guard: reject "250 มก.%", "5 ชม.", "2 คัน", "3 วันก่อน" outright, so no
  // rule can ever pick them up. This also covers the "7 วันอันตราย" in an
  // aggregate headline, whose numbers must not be read as people.
  const kept = tokens.filter(t => !NON_COUNTER_AFTER_RE.test(masked.slice(t.end)));
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

interface KeywordHit {
  word: string;
  kind: Kind;
  start: number;
  end: number;
  resolved: boolean;
}

function findKeywords(masked: string): KeywordHit[] {
  KEYWORD_RE.lastIndex = 0;
  const hits: KeywordHit[] = [];
  for (const match of masked.matchAll(KEYWORD_RE)) {
    hits.push({
      word: match[0],
      kind: KIND_OF.get(match[0])!,
      start: match.index!,
      end: match.index! + match[0].length,
      resolved: false
    });
  }
  return hits;
}

const CONF = {
  reverse: 0.85,
  reverseLoose: 0.8,
  withCounter: 0.9,
  bare: 0.7,
  deathCounter: 0.85,
  implied: 0.5,
  zero: 0.6,
  range: 0.4
};

function snippetAround(norm: string, start: number, end: number): string {
  const from = Math.max(0, start - 6);
  const to = Math.min(norm.length, end + 6);
  return norm.slice(from, to).trim();
}

/**
 * "2 รายเสียชีวิต 1 รายสาหัส" — the count precedes the verb.
 *
 * Runs in two passes, and the discriminator between them is spacing. Thai
 * writes a leading count as one phrase with no space before the verb, so the
 * `strict` pass (no space allowed) is safe to run early. A space usually means
 * the number belongs to the previous clause — "รวบ 40 ราย ดับ 1 ราย" must not
 * report 40 deaths.
 *
 * The `loose` pass tolerates that space, and is therefore only run last, after
 * the forward passes: by then any keyword with a number of its own has taken
 * it, so the only keywords left are ones with nothing after them —
 * "ชน 2 วัยรุ่น ดับ", where the leading count is all there is.
 */
function attributeReverse(
  masked: string, norm: string, keywords: KeywordHit[], tokens: NumToken[],
  reach: 'strict' | 'loose'
): Mention[] {
  const out: Mention[] = [];
  const pattern = reach === 'strict' ? COUNTER_ABUTTING_RE : COUNTER_LOOSE_RE;

  for (const kw of keywords) {
    if (kw.resolved) continue;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i];
      if (token.consumed || token.end > kw.start) continue;
      if (kw.start - token.end > ATTRIBUTION_WINDOW) break;
      if (!pattern.test(masked.slice(token.end, kw.start))) continue;

      token.consumed = true;
      kw.resolved = true;
      out.push({
        kind: kw.kind,
        value: token.value,
        evidence: token.isRange ? 'range' : 'explicit',
        confidence: token.isRange
          ? CONF.range
          : reach === 'strict' ? CONF.reverse : CONF.reverseLoose,
        rule: kw.kind === 'death' ? 'D4' : 'I4',
        snippet: snippetAround(norm, token.start, kw.end)
      });
      break;
    }
  }
  return out;
}

/**
 * "ดับ 2 ราย" / "ดับ2ราย" / "ดับคาที่ 3 ศพ" / "ยอดดับเพิ่มเป็น 3 ราย".
 *
 * Aborts when another casualty keyword appears before the number — the single
 * constraint that makes "ดับ 1 เจ็บ 4" resolve correctly and that removes any
 * need for the old lookahead.
 *
 * Runs twice. `adjacent` only takes a number glued straight to the keyword and
 * runs BEFORE the reverse pass, because adjacency outranks direction: in fully
 * unspaced copy ("ดับสองรายเจ็บสามคน") the counter of one clause abuts the next
 * keyword, and a reverse-first order would hand เจ็บ the figure that belongs to
 * ดับ. `window` is the wide pass and is also where "many, unspecified" is
 * detected — the last chance to resolve a keyword.
 */
function attributeForward(
  masked: string, norm: string, keywords: KeywordHit[], tokens: NumToken[],
  unknown: Set<Kind>, reach: 'adjacent' | 'window'
): Mention[] {
  const out: Mention[] = [];
  const wide = reach === 'window';

  for (const kw of keywords) {
    if (kw.resolved) continue;
    const limit = wide ? Math.min(kw.end + ATTRIBUTION_WINDOW, masked.length) : kw.end;

    const token = tokens.find(t =>
      !t.consumed && t.start >= kw.end && (wide ? t.start < limit : t.start === kw.end)
    );
    const blocked = keywords.some(
      other => other !== kw && other.start >= kw.end &&
        other.start < (token ? token.start : limit)
    );

    if (wide) {
      // "เจ็บระนาว" / "ดับหลายราย": the text says many without saying how many.
      const indefinite = firstIndexOfAny(masked.slice(kw.end, limit), INDEFINITE);
      const tokenOffset = token && !blocked ? token.start - kw.end : Infinity;
      if (indefinite !== -1 && indefinite < tokenOffset) {
        kw.resolved = true;
        unknown.add(kw.kind);
        continue;
      }
    }

    if (!token || blocked) continue;
    // A Thai word numeral only counts people when a counter follows it;
    // without that rule "สี่แยก" and "สองแถว" become casualty figures.
    const hasCounter = COUNTER_AFTER_RE.test(masked.slice(token.end));
    if (token.isWord && !hasCounter) continue;

    token.consumed = true;
    kw.resolved = true;
    out.push({
      kind: kw.kind,
      value: token.value,
      evidence: token.isRange ? 'range' : 'explicit',
      confidence: token.isRange ? CONF.range : hasCounter ? CONF.withCounter : CONF.bare,
      rule: kw.kind === 'death' ? (hasCounter ? 'D1' : 'D7') : hasCounter ? 'I1' : 'I7',
      snippet: snippetAround(norm, kw.start, token.end)
    });
  }

  return out;
}

/** "4 ศพ" with no verb: ศพ counts only the dead, so it stands on its own. */
function attributeDeathCounter(
  masked: string, norm: string, tokens: NumToken[]
): Mention[] {
  const out: Mention[] = [];
  for (const token of tokens) {
    if (token.consumed) continue;
    if (!DEATH_COUNTER_AFTER_RE.test(masked.slice(token.end))) continue;
    token.consumed = true;
    out.push({
      kind: 'death',
      value: token.value,
      evidence: token.isRange ? 'range' : 'explicit',
      confidence: token.isRange ? CONF.range : CONF.deathCounter,
      rule: 'D2',
      snippet: snippetAround(norm, token.start, token.end)
    });
  }
  return out;
}

interface FieldScan {
  mentions: Mention[];
  unknown: Set<Kind>;
}

function scanField(text: string): FieldScan {
  const norm = normalizeText(text);
  const unknown = new Set<Kind>();
  const mentions: Mention[] = [];

  // Zero phrases are matched and masked first: left in place, "ไม่มีผู้เสียชีวิต"
  // would expose a `เสียชีวิต` keyword that then grabs a later, unrelated number.
  let masked = norm;
  for (const { phrase, kinds } of ZERO_PHRASES) {
    if (!masked.includes(phrase)) continue;
    const at = masked.indexOf(phrase);
    for (const kind of kinds) {
      mentions.push({
        kind,
        value: 0,
        evidence: 'zero',
        confidence: CONF.zero,
        rule: kind === 'death' ? 'D9' : 'I9',
        snippet: snippetAround(norm, at, at + phrase.length)
      });
    }
    masked = maskTerm(masked, phrase);
  }

  masked = maskAll(masked, KEYWORD_FALSE_FRIENDS);
  masked = maskAll(masked, NUMBER_FALSE_FRIENDS);
  masked = maskAll(masked, Object.keys(AREA_ALIASES));
  masked = maskAll(masked, PROVINCES);

  const tokens = findNumbers(masked);
  const keywords = findKeywords(masked);

  // Order matters: adjacency outranks direction, and the space-tolerant reverse
  // pass runs last so it only ever claims a number nothing else wanted.
  mentions.push(...attributeForward(masked, norm, keywords, tokens, unknown, 'adjacent'));
  mentions.push(...attributeReverse(masked, norm, keywords, tokens, 'strict'));
  mentions.push(...attributeForward(masked, norm, keywords, tokens, unknown, 'window'));
  mentions.push(...attributeReverse(masked, norm, keywords, tokens, 'loose'));
  mentions.push(...attributeDeathCounter(masked, norm, tokens));

  // "ดับคาที่" with no figure means one death — but only when nothing else
  // resolved that kind, and never when the text already said "many".
  for (const [kind, phrases] of [
    ['death', DEATH_IMPLIED],
    ['injury', INJURY_IMPLIED]
  ] as Array<[Kind, string[]]>) {
    if (unknown.has(kind)) continue;
    if (mentions.some(m => m.kind === kind)) continue;
    const at = firstIndexOfAny(masked, phrases);
    if (at === -1) continue;
    const phrase = phrases.find(p => masked.indexOf(p) === at)!;
    mentions.push({
      kind,
      value: 1,
      evidence: 'implied',
      confidence: CONF.implied,
      rule: kind === 'death' ? 'D8' : 'I8',
      snippet: snippetAround(norm, at, at + phrase.length)
    });
  }

  return { mentions, unknown };
}

const EMPTY_FACT: Omit<CasualtyFact, 'scope'> = {
  value: null, evidence: null, confidence: 0, rule: null, snippet: null, field: null
};

function isTruncated(title: string): boolean {
  return /(?:…|\.{3})\s*$/.test(title.trim());
}

/**
 * Within a field, higher confidence wins; at equal confidence the larger figure
 * wins. "เจ็บ 3 คน สาหัส 1 ราย" means three injured of whom one is critical, so
 * the total is 3, not 1.
 */
function pickBest(
  candidates: Array<{ mention: Mention; field: CasualtyField; confidence: number }>
) {
  return candidates.sort((a, b) =>
    b.confidence - a.confidence ||
    FIELD_RANK[a.field] - FIELD_RANK[b.field] ||
    b.mention.value - a.mention.value
  )[0];
}

const FIELD_RANK: Record<CasualtyField, number> = { title: 0, summary: 1, body: 2 };

export function readCasualties(input: CasualtyInput): CasualtyReading {
  const fields: Array<[CasualtyField, string]> = [['title', input.title]];
  if (input.summary) fields.push(['summary', input.summary]);
  if (input.body) fields.push(['body', input.body]);

  // Aggregate detection runs over the whole record with whitespace removed, so
  // "7 วันอันตราย" matches the unspaced marker.
  const joined = normalizeText(fields.map(([, text]) => text).join(' '))
    .replace(/\s+/g, '');
  const aggregate = AGGREGATE_MARKERS.some(marker => joined.includes(marker));
  const scope: CasualtyScope = aggregate ? 'aggregate' : 'incident';

  const titleTruncated = isTruncated(input.title);
  const candidates: Record<Kind, Array<{
    mention: Mention; field: CasualtyField; confidence: number;
  }>> = { death: [], injury: [] };

  for (const [field, text] of fields) {
    if (!text) continue;
    for (const mention of scanField(text).mentions) {
      // A headline cut off mid-phrase ("...ชน 2 วัยรุ่น ดับ ...") lost its
      // number to the ellipsis, so its implied 1 must not outrank the summary.
      const penalty =
        field === 'title' && titleTruncated && mention.evidence === 'implied' ? 0.3 : 0;
      candidates[mention.kind].push({
        mention, field, confidence: mention.confidence - penalty
      });
    }
  }

  const toFact = (kind: Kind): CasualtyFact => {
    const best = pickBest(candidates[kind]);
    if (!best) return { ...EMPTY_FACT, scope };
    return {
      value: best.mention.value,
      evidence: best.mention.evidence,
      confidence: best.confidence,
      rule: best.mention.rule,
      snippet: best.mention.snippet,
      field: best.field,
      scope
    };
  };

  return { deaths: toFact('death'), injuries: toFact('injury'), aggregate };
}

/** Back-compat shims for callers that only have a headline. */
export function extractDeaths(title: string): number | null {
  return readCasualties({ title }).deaths.value;
}

export function extractInjuries(title: string): number | null {
  return readCasualties({ title }).injuries.value;
}
