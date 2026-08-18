/**
 * Pair-level ratchet for the entity merge paths.
 *
 * dedup.spec.ts tests the rules one clause at a time. This file tests the six
 * events that were still split across the live table after the retroactive
 * merge — the cases that motivated entities.ts — plus the near misses that must
 * stay split.
 *
 * The headlines are reconstructions: they were rewritten from the description
 * of each event rather than copied out of the database, because the credentials
 * needed to read the live table are not in the repo. They preserve what the
 * pairs were split *on* — a rewritten headline, a missing toll, a shared
 * landmark or age or office — which is what these paths have to survive. Real
 * headlines should replace them the next time the table is reachable.
 *
 * The negatives matter more than the positives. Every one of them is a pair the
 * entity paths could plausibly have merged, and a change that turns one green-
 * to-red has widened the merge rule too far.
 */
import { describe, expect, it } from 'vitest';
import { isSameStory, type SameStoryInput } from '../supabase/functions/_shared/dedup.ts';
import {
  extractEntities,
  entityScore,
  vehicleClasses,
  vehicleMarques
} from '../supabase/functions/_shared/entities.ts';

const BASE = new Date('2026-08-12T10:00:00Z');
const hoursLater = (h: number) => new Date(BASE.getTime() + h * 3_600_000);

function story(partial: Partial<SameStoryInput> & { title: string }): SameStoryInput {
  return { provinces: [], deaths: null, injuries: null, published: BASE, ...partial };
}

interface Pair {
  name: string;
  a: SameStoryInput;
  b: SameStoryInput;
}

/** Same event, still stored as two stories before entities.ts. */
const DUPLICATES: Pair[] = [
  {
    // The event that started this: sixteen stories, three deaths counted
    // sixteen times. Neither headline reuses a phrase from the other, so the
    // only thing joining them is the district plus the vehicles plus the toll.
    name: 'BMW hits a tuk-tuk in Bang Bua Thong',
    a: story({
      title: 'ดับ 3 ศพ! เก๋งหรูพุ่งชนสามล้อ กลางถนนบางบัวทอง',
      provinces: ['นนทบุรี'], deaths: 3
    }),
    b: story({
      title: 'เปิดวงจรปิด นาที BMW ซิ่งชนตุ๊กตุ๊ก ย่านบางบัวทอง',
      provinces: ['นนทบุรี'], deaths: 3, published: hoursLater(72)
    })
  },
  {
    // Neither side states a death toll, so corroboration was unreachable. The
    // office is what carries it.
    name: 'a village headman hits schoolchildren in Kamphaeng Phet',
    a: story({
      title: 'ผู้ใหญ่บ้านเมาแล้วขับ ชนนักเรียนเจ็บ 2 ราย จ.กำแพงเพชร',
      provinces: ['กำแพงเพชร'], injuries: 2
    }),
    b: story({
      title: 'เมาแล้วขับพุ่งชนกลุ่มนักเรียน คนขับเป็นผู้ใหญ่บ้าน เมืองกำแพงเพชร',
      provinces: ['กำแพงเพชร'], published: hoursLater(24)
    })
  },
  {
    name: 'a school director kills a 14-year-old pupil',
    a: story({
      title: 'ผอ.ร.ร.เมาแล้วขับ ชนนักเรียนวัย 14 ปี ดับคาที่',
      provinces: ['ชัยภูมิ'], deaths: 1
    }),
    b: story({
      title: 'สลด! ครูใหญ่เมาขับรถชน ด.ช.วัย 14 ปี เสียชีวิต',
      provinces: ['ชัยภูมิ'], deaths: 1, published: hoursLater(12)
    })
  },
  {
    // Wording is close but under STRONG_SIMILARITY: the near-duplicate path,
    // where the age is the rare entity that licenses the merge.
    name: 'one checkpoint arrest, two outlets',
    a: story({
      title: 'ตั้งด่านตรวจแอลกอฮอล์ รวบชายวัย 55 ปี เมาแล้วขับ', provinces: ['ระยอง']
    }),
    b: story({
      title: 'ตั้งด่านตรวจวัดแอลกอฮอล์ จับชายวัย 55 ปี ขับรถขณะเมาสุรา',
      provinces: ['ระยอง'], published: hoursLater(6)
    })
  },
  {
    name: 'Myanmar workers hit in Samut Sakhon',
    a: story({
      title: 'สลด! เมาแล้วขับพุ่งชนกลุ่มแรงงานเมียนมา ดับ 2 เจ็บ 5 ที่สมุทรสาคร',
      provinces: ['สมุทรสาคร'], deaths: 2, injuries: 5
    }),
    b: story({
      title: 'เปิดภาพนาที เก๋งเมาขับชนแรงงานเมียนมา เสียชีวิต 2 ราย สมุทรสาคร',
      provinces: ['สมุทรสาคร'], deaths: 2, published: hoursLater(30)
    })
  },
  {
    name: 'a Chinese tourist hits a market stall in Phuket',
    a: story({
      title: 'รวบหนุ่มจีนเมาแล้วขับ ซิ่งเก๋งชนแผงลอย ที่ภูเก็ต', provinces: ['ภูเก็ต']
    }),
    b: story({
      title: 'ตำรวจภูเก็ตจับนักท่องเที่ยวจีน เมาขับเก๋งพุ่งชนแผงลอย',
      provinces: ['ภูเก็ต'], published: hoursLater(20)
    })
  },
  {
    // Follow-up coverage weeks later. Nothing survives the rewrite but the
    // marque and the vehicles.
    name: 'bail hearing for the BMW driver',
    a: story({
      title: 'หนุ่มเมาขับ BMW ชนประสานงา รถตุ๊กตุ๊ก เสียชีวิตสลด 3 ราย',
      provinces: ['นนทบุรี'], deaths: 3
    }),
    b: story({
      title: 'ศาลให้ประกัน “หนุ่มบีเอ็มเมาขับ” ชนรถตุ๊กตุ๊ก ดับ 3 ศพ วงเงิน 5 แสน',
      provinces: [], deaths: 3, published: hoursLater(72)
    })
  }
];

/** Different events that the entity paths must not fuse. */
const DISTINCT: Pair[] = [
  {
    // Two checkpoint round-ups from one province: a province and a shared
    // subject, and nothing rare at all.
    name: 'two checkpoint round-ups in one province',
    a: story({ title: 'ตั้งด่านตรวจแอลกอฮอล์ รวบเมาแล้วขับ 120 ราย', provinces: ['ขอนแก่น'] }),
    b: story({
      title: 'ด่านตรวจวัดแอลกอฮอล์ จับกุมผู้ขับขี่เมาสุรา 87 ราย',
      provinces: ['ขอนแก่น'], published: hoursLater(48)
    })
  },
  {
    // One rare entity is necessary, not sufficient: two people of the same age
    // arrested in one province in one week is unremarkable.
    name: 'two arrests that happen to share an age',
    a: story({
      title: 'เมาแล้วขับชนเสาไฟ ชายวัย 30 ปี ดับ', provinces: ['เชียงใหม่'], deaths: 1
    }),
    b: story({
      title: 'รวบหญิงวัย 30 ปี เมาแล้วขับ ฝ่าด่าน',
      provinces: ['เชียงใหม่'], published: hoursLater(48)
    })
  },
  {
    name: 'identical headlines from different provinces',
    a: story({ title: 'เมาขับเก๋งชน จยย. ดับ 2 ราย', provinces: ['ขอนแก่น'], deaths: 2 }),
    b: story({
      title: 'เมาขับเก๋งชน จยย. ดับ 2 ราย', provinces: ['ภูเก็ต'], deaths: 2,
      published: hoursLater(24)
    })
  },
  {
    name: 'same vehicles and province, nothing rare shared',
    a: story({ title: 'เมาแล้วขับ เก๋งชน จยย. ดับคาที่', provinces: ['ขอนแก่น'] }),
    b: story({
      title: 'เมาแล้วขับ เก๋งเสยท้าย จยย. เจ็บหนัก',
      provinces: ['ขอนแก่น'], published: hoursLater(24 * 10)
    })
  },
  {
    // ปราจีนบุรี contains จีน. Without the mask both sides would report a
    // shared Chinese nationality and merge on it.
    name: 'Prachinburi is not a Chinese national',
    a: story({ title: 'เมาแล้วขับชนเสาไฟ ที่ปราจีนบุรี', provinces: ['ปราจีนบุรี'] }),
    b: story({ title: 'หนุ่มจีนเมาแล้วขับชนเสาไฟ', provinces: [] })
  }
];

describe('isSameStory on the pairs that were still split', () => {
  for (const { name, a, b } of DUPLICATES) {
    it(`merges ${name}`, () => {
      expect(isSameStory(a, b)).toBe(true);
      expect(isSameStory(b, a)).toBe(true);
    });
  }
});

describe('isSameStory keeps different events apart', () => {
  for (const { name, a, b } of DISTINCT) {
    it(`does not merge ${name}`, () => {
      expect(isSameStory(a, b)).toBe(false);
      expect(isSameStory(b, a)).toBe(false);
    });
  }
});

describe('extractEntities', () => {
  const of = (title: string, provinces: string[] = []) =>
    [...extractEntities({ title, provinces, deaths: null, injuries: null }).keys()];

  it('reads a district or landmark out of a headline', () => {
    expect(of('เก๋งหรูพุ่งชนสามล้อ กลางถนนบางบัวทอง')).toContain('landmark:บางบัวทอง');
    // 'สน.' marks Bangkok but appears in most Bangkok crime headlines, so it is
    // a province hint rather than a rare entity.
    expect(of('เมาขับชนแล้วหนี สน.ทองหล่อ ตามล่า')).not.toContain('landmark:สน.');
  });

  it('reads an age but not a year', () => {
    expect(of('รวบชายวัย 55 ปี เมาแล้วขับ')).toContain('age:55');
    expect(of('สถิติเมาแล้วขับ ปี 2568 พุ่งสูง')).not.toContain('age:2568');
  });

  it('reads an office that identifies one person', () => {
    expect(of('ผอ.ร.ร.เมาแล้วขับ ชนนักเรียน')).toContain('role:ผอ.โรงเรียน');
    expect(of('ครูใหญ่เมาขับรถชน ด.ช.')).toContain('role:ผอ.โรงเรียน');
    expect(of('ผู้ใหญ่บ้านเมาแล้วขับ')).toContain('role:ผู้ใหญ่บ้าน');
  });

  it('reads a name but not the phrase the story is about', () => {
    expect(of('พ่อ “น้องมะปราง” ร้องขอความเป็นธรรม')).toContain('name:น้องมะปราง');
    // Quoting the subject of every DUI story must not produce a rare entity.
    expect(of('ตำรวจคุมเข้ม “เมาแล้วขับ” ช่วงปีใหม่')).not.toContain('name:เมาแล้วขับ');
    // 'วัย' follows a honorific constantly and is an age, not a name.
    expect(of('เมาขับชน ด.ช.วัย 14 ปี')).not.toContain('name:วัย');
  });

  it('never emits a key for a figure nobody stated', () => {
    const set = extractEntities({
      title: 'เมาแล้วขับชนเสาไฟ', provinces: [], deaths: null, injuries: 2
    });
    expect([...set.keys()]).toContain('injuries:2');
    expect([...set.keys()].some(key => key.startsWith('deaths:'))).toBe(false);
  });
});

describe('entityScore', () => {
  const setOf = (title: string, provinces: string[], deaths: number | null = null) =>
    extractEntities({ title, provinces, deaths, injuries: null });

  it('counts rare and generic overlap separately', () => {
    const overlap = entityScore(
      setOf('เก๋งหรูพุ่งชนสามล้อ บางบัวทอง', ['นนทบุรี'], 3),
      setOf('BMW ชนตุ๊กตุ๊ก ย่านบางบัวทอง', ['นนทบุรี'], 3)
    );
    expect(overlap.rare).toBe(1);                       // the district
    expect(overlap.shared).toContain('landmark:บางบัวทอง');
    expect(overlap.score).toBeGreaterThanOrEqual(4);
  });

  it('scores generic-only overlap below the merge threshold', () => {
    const overlap = entityScore(
      setOf('เมาแล้วขับ เก๋งชน จยย. ดับคาที่', ['ขอนแก่น']),
      setOf('เมาแล้วขับ เก๋งเสยท้าย จยย. เจ็บหนัก', ['ขอนแก่น'])
    );
    expect(overlap.rare).toBe(0);
    expect(overlap.score).toBeLessThan(4);
  });
});

describe('vehicle lexicon', () => {
  it('classes the marques Thai headlines actually use', () => {
    expect(vehicleClasses('หนุ่มเมาขับ BMW ชนรถตุ๊กตุ๊ก')).toEqual(['3W', '4W-C']);
    expect(vehicleMarques('หนุ่มเมาขับ BMW ชนรถตุ๊กตุ๊ก')).toEqual(['bmw']);
    expect(vehicleMarques('บีเอ็มเมาขับ ชนตุ๊กตุ๊ก')).toEqual(['bmw']);
  });

  it('does not read a car into a Honda motorcycle', () => {
    // Marques that sell more motorcycles than cars in Thailand stay out of the
    // 4W-C class, or every ฮอนด้า would be classed as a passenger car.
    expect(vehicleClasses('เมาขับ จยย.ฮอนด้า ชนท้ายกระบะ')).toEqual(['2W', '4W-P']);
    expect(vehicleMarques('เมาขับ จยย.ฮอนด้า ชนท้ายกระบะ')).toEqual(['honda']);
  });

  it('collapses the three-wheeler wordings onto one class', () => {
    expect(vehicleClasses('ชนสามล้อ')).toEqual(vehicleClasses('ชนตุ๊กตุ๊ก'));
    expect(vehicleClasses('ชนสกายแล็บ')).toEqual(['3W']);
  });
});
