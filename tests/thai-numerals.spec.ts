import { describe, expect, it } from 'vitest';
import {
  normalizeDigits,
  normalizeText,
  parseThaiWordNumber
} from '../supabase/functions/_shared/casualties.ts';

describe('normalizeDigits', () => {
  const cases: Array<[string, string]> = [
    ['๐๑๒๓๔๕๖๗๘๙', '0123456789'],
    ['ดับ ๒ ราย', 'ดับ 2 ราย'],
    ['1,234', '1234'],
    ['1,234,567', '1234567'],
    // Not a thousands separator: a decimal comma or a list must survive.
    ['2,5', '2,5'],
    ['ดับ 1,2 และ 3 ราย', 'ดับ 1,2 และ 3 ราย'],
    ['๑,๒๓๔ ราย', '1234 ราย']
  ];
  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      expect(normalizeDigits(input)).toBe(expected);
    });
  }
});

describe('normalizeText', () => {
  it('repairs the เเ typo', () => {
    expect(normalizeText('เเมาเเล้วขับ')).toBe('แมาแล้วขับ');
  });

  it('folds zero-width and non-breaking spaces to plain spaces', () => {
    expect(normalizeText('ดับ 2​ราย')).toBe('ดับ 2 ราย');
  });
});

describe('parseThaiWordNumber', () => {
  const valid: Array<[string, number]> = [
    ['หนึ่ง', 1],
    ['สอง', 2],
    ['สาม', 3],
    ['สี่', 4],
    ['ห้า', 5],
    ['หก', 6],
    ['เจ็ด', 7],
    ['แปด', 8],
    ['เก้า', 9],
    ['สิบ', 10],
    ['สิบเอ็ด', 11],
    ['สิบสอง', 12],
    ['ยี่สิบ', 20],
    ['ยี่สิบเอ็ด', 21],
    ['ยี่สิบสาม', 23],
    ['สามสิบ', 30],
    ['เก้าสิบเก้า', 99],
    ['ร้อย', 100],
    ['หนึ่งร้อยยี่สิบ', 120],
    ['สองร้อยสิบห้า', 215],
    ['พัน', 1000],
    ['สองพันห้าร้อย', 2500],
    // Numerically 101. That it is also a province is handled by masking in
    // scanField(), not by the parser — see ff-roi-et-province in the gold set.
    ['ร้อยเอ็ด', 101]
  ];
  for (const [input, expected] of valid) {
    it(`${input} = ${expected}`, () => {
      expect(parseThaiWordNumber(input)).toBe(expected);
    });
  }

  const invalid = [
    'ยี่',        // only valid inside ยี่สิบ
    'เอ็ด',       // only valid inside สิบเอ็ด
    'ศูนย์',      // also the word for "centre"
    'สิบล้อ',     // a ten-wheeler
    'สองแถว',     // a songthaew
    'ราย',
    ''
  ];
  for (const input of invalid) {
    it(`${input || '<empty>'} is not a numeral`, () => {
      expect(parseThaiWordNumber(input)).toBeNull();
    });
  }
});
