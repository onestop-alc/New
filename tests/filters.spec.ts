import { describe, expect, it } from 'vitest';
import { classifyArticle, normalizeForMatch } from '../supabase/functions/_shared/filters.ts';

/**
 * Thin regression net around the classifier. The casualty work edits the shared
 * vocabulary in feeds.ts, and collateral damage there is silent: articles simply
 * stop arriving.
 */
describe('normalizeForMatch', () => {
  it('repairs the เเ typo and strips separators', () => {
    expect(normalizeForMatch('เเมา เเล้ว-ขับ')).toBe('แมาแล้วขับ');
  });
});

describe('classifyArticle', () => {
  const passes: Array<[string, string, 'high' | 'medium']> = [
    ['หนุ่มเมาแล้วขับ ซิ่งกระบะชนดับ 2 ราย', '', 'high'],
    ['ตรวจวัดแอลกอฮอล์ 250 มก.% หลังชนคนข้ามถนน', '', 'high'],
    ['ตั้งด่านตรวจแอลกอฮอล์ รวบเมาแล้วขับ 120 ราย', '', 'high'],
    ['รณรงค์เมาไม่ขับ ช่วงเทศกาล ตำรวจตั้งจุดตรวจ', '', 'medium']
  ];

  for (const [title, summary, confidence] of passes) {
    it(`passes: ${title.slice(0, 40)}`, () => {
      const result = classifyArticle(title, summary);
      expect(result.passed, result.reason).toBe(true);
      expect(result.confidence).toBe(confidence);
    });
  }

  const rejects: Array<[string, string]> = [
    ['ขึ้นภาษีสุราและเบียร์ มีผล 1 ม.ค.', ''],
    ['เจลแอลกอฮอล์ล้างมือ ขาดตลาด', ''],
    ['เปิดโรงเบียร์คราฟต์แห่งใหม่ที่เชียงใหม่', ''],
    ['น้ำท่วมสุราษฎร์ธานี ถนนขาด 3 จุด', ''],
    ['ตำรวจจับแก๊งค้ายาบ้า ยึดของกลางเพียบ', '']
  ];

  for (const [title, summary] of rejects) {
    it(`rejects: ${title.slice(0, 40)}`, () => {
      const result = classifyArticle(title, summary);
      expect(result.passed, result.reason).toBe(false);
      expect(result.confidence).toBe('none');
    });
  }

  it('demotes an evergreen explainer out of the high tier', () => {
    const result = classifyArticle('เมาแล้วขับ มีโทษอย่างไร เปิดอัตราโทษล่าสุด', '');
    expect(result.passed).toBe(true);
    expect(result.confidence).toBe('medium');
  });

  it('demotes a social repost out of the high tier', () => {
    const result = classifyArticle('เมาแล้วขับชนดับ 2 ราย', '', 'facebook.com');
    expect(result.confidence).toBe('medium');
  });
});
