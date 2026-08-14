import { describe, expect, it } from 'vitest';
import {
  casualtyAgreement,
  isSameStory,
  type SameStoryInput
} from '../supabase/functions/_shared/dedup.ts';

const BASE = new Date('2026-08-12T10:00:00Z');
const hoursLater = (h: number) => new Date(BASE.getTime() + h * 3_600_000);

function story(partial: Partial<SameStoryInput> & { title: string }): SameStoryInput {
  return {
    provinces: [],
    deaths: null,
    injuries: null,
    published: BASE,
    ...partial
  };
}

describe('casualtyAgreement', () => {
  it('treats a missing figure as no information, not as a difference', () => {
    expect(casualtyAgreement(null, 2)).toBe('unknown');
    expect(casualtyAgreement(2, null)).toBe('unknown');
    expect(casualtyAgreement(null, null)).toBe('unknown');
  });

  it('separates agreement from conflict', () => {
    expect(casualtyAgreement(2, 2)).toBe('agree');
    expect(casualtyAgreement(0, 0)).toBe('agree');
    expect(casualtyAgreement(2, 3)).toBe('conflict');
    // 0 is a claim, not an absence.
    expect(casualtyAgreement(0, 1)).toBe('conflict');
  });
});

describe('isSameStory', () => {
  it('merges the same crash reported by two outlets', () => {
    const a = story({
      title: 'เมาแล้วขับ ซิ่งกระบะพุ่งชน จยย. ดับ 2 ราย',
      provinces: ['กำแพงเพชร'], deaths: 2
    });
    const b = story({
      title: 'เมาแล้วขับ ซิ่งกระบะพุ่งชน จยย. ดับ 2 ราย ที่กำแพงเพชร',
      provinces: ['กำแพงเพชร'], deaths: 2
    });
    expect(isSameStory(a, b)).toBe(true);
  });

  it('does not merge templated headlines from different provinces', () => {
    const a = story({
      title: 'เมาแล้วขับชนดับ 2 ราย', provinces: ['เชียงใหม่'], deaths: 2
    });
    const b = story({
      title: 'เมาแล้วขับชนดับ 2 ราย', provinces: ['ภูเก็ต'], deaths: 2
    });
    expect(isSameStory(a, b)).toBe(false);
  });

  it('merges when one side has no figure at all', () => {
    // The dominant case before the rewrite: null on both sides. It must stay a
    // merge, but for the right reason — unknown is not agreement.
    const a = story({
      title: 'เมาแล้วขับ ซิ่งกระบะพุ่งชน จยย. ดับคาที่',
      provinces: ['ชลบุรี'], deaths: 1
    });
    const b = story({
      title: 'เมาแล้วขับ ซิ่งกระบะพุ่งชน จยย. ดับคาที่ กลางดึก',
      provinces: ['ชลบุรี'], deaths: null
    });
    expect(isSameStory(a, b)).toBe(true);
  });

  it('merges a developing toll when the evidence is strong and recent', () => {
    const title = 'เมาแล้วขับ ซิ่งกระบะพุ่งชน จยย. กลางถนนพระราม 2';
    const a = story({ title: `${title} ดับ 2 ราย`, provinces: ['กรุงเทพมหานคร'], deaths: 2 });
    const b = story({
      title: `${title} ดับ 3 ราย`, provinces: ['กรุงเทพมหานคร'], deaths: 3,
      published: hoursLater(6)
    });
    expect(isSameStory(a, b)).toBe(true);
  });

  it('refuses a conflicting toll once the reports are days apart', () => {
    const title = 'เมาแล้วขับ ซิ่งกระบะพุ่งชน จยย. กลางถนนพระราม 2';
    const a = story({ title: `${title} ดับ 2 ราย`, provinces: ['กรุงเทพมหานคร'], deaths: 2 });
    const b = story({
      title: `${title} ดับ 3 ราย`, provinces: ['กรุงเทพมหานคร'], deaths: 3,
      published: hoursLater(72)
    });
    expect(isSameStory(a, b)).toBe(false);
  });

  it('keeps two checkpoint round-ups apart when only the count differs', () => {
    // Near-identical text, same province, but different arrest totals: exactly
    // the case the strong-similarity shortcut must not collapse.
    const a = story({
      title: 'ตั้งด่านตรวจแอลกอฮอล์ รวบเมาแล้วขับ 120 ราย ดับ 1 ราย',
      provinces: ['ขอนแก่น'], deaths: 1
    });
    const b = story({
      title: 'ตั้งด่านตรวจแอลกอฮอล์ รวบเมาแล้วขับ 340 ราย ดับ 4 ราย',
      provinces: ['ขอนแก่น'], deaths: 4
    });
    expect(isSameStory(a, b)).toBe(false);
  });

  it('does not merge unrelated headlines however compatible the figures', () => {
    const a = story({ title: 'เมาแล้วขับชนเสาไฟ ดับ 1 ราย', provinces: ['ตาก'], deaths: 1 });
    const b = story({
      title: 'เปิดกฎหมายเมาแล้วขับ โทษปรับสูงสุดเท่าไร', provinces: ['ตาก'], deaths: null
    });
    expect(isSameStory(a, b)).toBe(false);
  });

  it('treats an absent published date as inside the conflict window', () => {
    const title = 'เมาแล้วขับ ซิ่งกระบะพุ่งชน จยย. กลางถนนพระราม 2';
    const a = story({
      title: `${title} ดับ 2 ราย`, provinces: ['กรุงเทพมหานคร'], deaths: 2, published: null
    });
    const b = story({
      title: `${title} ดับ 3 ราย`, provinces: ['กรุงเทพมหานคร'], deaths: 3, published: null
    });
    expect(isSameStory(a, b)).toBe(true);
  });
});
