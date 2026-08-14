import { describe, expect, it } from 'vitest';
import {
  casualtyAgreement,
  getVehicleSignature,
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

describe('getVehicleSignature', () => {
  it('recognises the marque names Thai headlines actually use', () => {
    // An empty signature is what let one crash become sixteen stories.
    expect(getVehicleSignature('หนุ่มเมาขับ BMW ชนรถตุ๊กตุ๊ก')).toBe('3W,4W-C');
    expect(getVehicleSignature('บีเอ็มเมาขับ ชนตุ๊กตุ๊ก')).toBe('3W,4W-C');
    expect(getVehicleSignature('เก๋งหรูพุ่งชนสามล้อเครื่อง')).toBe('3W,4W-C');
  });

  it('does not class a motorcycle as a bicycle', () => {
    // 'จักรยานยนต์' contains 'จักรยาน'.
    expect(getVehicleSignature('เมาขับชนจักรยานยนต์')).toBe('2W');
    expect(getVehicleSignature('เมาขับชนจักรยาน')).toBe('Bike');
    expect(getVehicleSignature('เก๋งชนจักรยานยนต์และจักรยาน')).toBe('2W,4W-C,Bike');
  });

  it('returns an empty signature when no vehicle is named', () => {
    expect(getVehicleSignature('เมาแล้วขับ โทษปรับสูงสุดเท่าไร')).toBe('');
  });

  it('is order-independent so two wordings produce the same key', () => {
    expect(getVehicleSignature('กระบะชน จยย.')).toBe(getVehicleSignature('จยย.ถูกกระบะชน'));
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

  it('merges follow-up coverage when the toll and the vehicles corroborate', () => {
    // Real headlines, 3 days apart. Wording has nothing in common beyond the
    // crash itself, so similarity never reaches STRONG_SIMILARITY.
    const a = story({
      title: 'หนุ่มเมาขับ BMW ชนประสานงา รถตุ๊กตุ๊ก เสียชีวิตสลด 3 ราย',
      provinces: ['นนทบุรี'], deaths: 3, published: BASE
    });
    const b = story({
      title: 'ศาลให้ประกัน “หนุ่มบีเอ็มเมาขับ” ชนรถตุ๊กตุ๊ก ดับ 3 ศพ วงเงิน 5 แสน',
      provinces: [], deaths: 3, published: hoursLater(72)
    });
    expect(isSameStory(a, b)).toBe(true);
  });

  it('refuses follow-up coverage when the toll does not corroborate', () => {
    const a = story({
      title: 'หนุ่มเมาขับ BMW ชนประสานงา รถตุ๊กตุ๊ก เสียชีวิตสลด 3 ราย',
      provinces: ['นนทบุรี'], deaths: 3, published: BASE
    });
    // Same vehicles, same province, but nobody stated a toll on the other side.
    const b = story({
      title: 'หนุ่มเมาขับ BMW ชนรถตุ๊กตุ๊ก คดีถึงที่สุด',
      provinces: ['นนทบุรี'], deaths: null, published: hoursLater(24 * 10)
    });
    expect(isSameStory(a, b)).toBe(false);
  });

  it('does not merge two different crashes that merely share a toll', () => {
    // Same vehicles and same figure, but each names a different province.
    const a = story({
      title: 'เมาขับเก๋งชน จยย. ดับ 2 ราย', provinces: ['ขอนแก่น'], deaths: 2
    });
    const b = story({
      title: 'เมาขับเก๋งชน จยย. ดับ 2 ราย', provinces: ['ภูเก็ต'], deaths: 2,
      published: hoursLater(24 * 9)
    });
    expect(isSameStory(a, b)).toBe(false);
  });

  it('needs more than an unnamed province to merge', () => {
    // No province either side, no toll, no shared vehicle: silence is not
    // evidence of sameness.
    const a = story({ title: 'เมาแล้วขับชนแล้วหลบหนี ตำรวจเร่งล่า', provinces: [] });
    const b = story({ title: 'เมาแล้วขับชนแล้วหนี ตำรวจตามล่าตัว', provinces: [] });
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
