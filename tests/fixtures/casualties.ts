/**
 * Gold set for casualty extraction.
 *
 * Semantics of the expected values — these three are NOT interchangeable and
 * the whole point of the rewrite is that the extractor stops confusing them:
 *   number  the text states this count for THIS incident
 *   null    the text does not state a count (unknown)
 *   0       the text explicitly states nobody died / was hurt
 *
 * `scope: 'aggregate'` means the numbers are real but describe a period or a
 * region (a 7-day roundup, a national statistic), not one crash. They are
 * extracted and stored, then excluded from the story rollup and the dashboard
 * totals — see recompute_story_casualties() and Feed.tsx.
 *
 * Phrasings are drawn from the live Bing/direct feeds. Keep them realistic:
 * an invented headline that no Thai outlet would write is a test that tunes the
 * extractor toward nothing.
 */

export type CasualtyTag =
  | 'no-space'
  | 'thai-numeral'
  | 'thai-digit'
  | 'compound'
  | 'counter'
  | 'combined'
  | 'reverse'
  | 'range'
  | 'truncated'
  | 'aggregate'
  | 'implied'
  | 'indefinite'
  | 'explicit-zero'
  | 'checkpoint'
  | 'false-friend'
  | 'unit-guard'
  | 'summary'
  | 'body'
  | 'typo'
  | 'no-casualty';

export interface CasualtyCase {
  /** Stable slug. Keeps diffs readable when the list is re-sorted. */
  id: string;
  title: string;
  summary?: string;
  body?: string;
  deaths: number | null;
  injuries: number | null;
  /** Defaults to 'incident'. */
  scope?: 'incident' | 'aggregate';
  tags: CasualtyTag[];
  /** Why this expectation, for whoever reads the failure. */
  note?: string;
}

export const CASUALTY_GOLD: CasualtyCase[] = [
  // ---------------------------------------------------------------- explicit
  { id: 'd-2-ray', title: 'เมาแล้วขับ ซิ่งกระบะชนดับ 2 ราย',
    deaths: 2, injuries: null, tags: ['counter'] },
  { id: 'd-2-i-3-nospace', title: 'เมาแล้วขับ ซิ่งกระบะชนดับ2ราย เจ็บ3คน',
    deaths: 2, injuries: 3, tags: ['no-space', 'combined', 'counter'],
    note: 'ทั้งสองเลขติดลักษณนาม — lookahead เดิมคืน null ทั้งคู่' },
  { id: 'd-1-siachiwit', title: 'หนุ่มเมาขับชนเสียชีวิต 1 ราย',
    deaths: 1, injuries: null, tags: ['counter'] },
  { id: 'd-3-khon', title: 'เมาขับพุ่งชนคนเดินเท้า เสียชีวิต 3 คน',
    deaths: 3, injuries: null, tags: ['counter'] },
  { id: 'd-2-tai', title: 'เมาแล้วขับชนท้ายรถบรรทุก ตาย 2 ราย',
    deaths: 2, injuries: null, tags: ['counter'] },
  { id: 'i-5-badjep', title: 'เมาขับชนกลุ่มวัยรุ่น บาดเจ็บ 5 ราย',
    deaths: null, injuries: 5, tags: ['counter'] },
  { id: 'i-4-jep', title: 'เมาขับเสยท้าย เจ็บ 4 คน',
    deaths: null, injuries: 4, tags: ['counter'] },
  { id: 'd-1-i-2-no-counter', title: 'เมาแล้วขับชนดับ 1 เจ็บ 2',
    deaths: 1, injuries: 2, tags: ['combined'],
    note: 'พาดหัวไทยตัดลักษณนามออกเมื่อเลขติดกันสองตัว' },
  { id: 'i-2-sahat', title: 'เมาขับชนสาหัส 2 ราย',
    deaths: null, injuries: 2, tags: ['counter'] },
  { id: 'd-3-sop-modifier', title: 'เมาขับ ดับคาที่ 3 ศพ',
    deaths: 3, injuries: null, tags: ['counter'],
    note: 'modifier คาที่ คั่นระหว่าง keyword กับเลข' },
  { id: 'd-4-sangwoei', title: 'เมาขับเสยรถพ่วง สังเวย 4 ศพ',
    deaths: 4, injuries: null, tags: ['counter'] },
  { id: 'd-5-yod-dap', title: 'เมาขับชน ยอดดับพุ่ง 5 ราย',
    deaths: 5, injuries: null, tags: ['counter'] },
  { id: 'd-3-khra-chiwit', title: 'เมาขับชนคนข้ามถนน คร่า 3 ชีวิต',
    deaths: 3, injuries: null, tags: ['counter'] },
  { id: 'd-1-sop', title: 'เมาขับชนกระบะ ดับ 1 ศพ',
    deaths: 1, injuries: null, tags: ['counter'] },
  { id: 'd-2-nai', title: 'เมาขับชน ดับ 2 นาย',
    deaths: 2, injuries: null, tags: ['counter'] },
  { id: 'i-1-nai', title: 'เมาขับพุ่งชนป้อมตำรวจ ตำรวจเจ็บ 1 นาย',
    deaths: null, injuries: 1, tags: ['counter'] },
  { id: 'd-1-thi-koet-het', title: 'เมาขับชนรถจักรยาน เสียชีวิต 1 ราย ในที่เกิดเหตุ',
    deaths: 1, injuries: null, tags: ['counter'] },
  { id: 'd-2-i-7-tamruat', title: 'เมาขับชน ตำรวจเผยผู้เสียชีวิต 2 ราย บาดเจ็บ 7 ราย',
    deaths: 2, injuries: 7, tags: ['combined', 'counter'] },
  { id: 'd-2-i-3-mi-phu', title: 'เมาขับชน มีผู้เสียชีวิต 2 คน และบาดเจ็บ 3 คน',
    deaths: 2, injuries: 3, tags: ['combined', 'counter'] },

  // -------------------------------------------------------------- thai digits
  { id: 'thai-digit-d2-i1', title: 'เมาขับชนดับ ๒ ราย สาหัส ๑',
    deaths: 2, injuries: 1, tags: ['thai-digit', 'combined'] },
  { id: 'thai-digit-d3-sop', title: 'เมาขับชนดับ ๓ ศพ',
    deaths: 3, injuries: null, tags: ['thai-digit', 'counter'] },
  { id: 'thai-digit-reverse-d10', title: 'เมาขับชน ๑๐ รายเสียชีวิต',
    deaths: 10, injuries: null, tags: ['thai-digit', 'reverse'] },
  { id: 'thai-digit-d1-i2', title: 'เมาขับชน เสียชีวิต ๑ ราย บาดเจ็บ ๒ ราย',
    deaths: 1, injuries: 2, tags: ['thai-digit', 'combined'] },

  // ------------------------------------------------------- thai word numerals
  { id: 'word-song-khon', title: 'หนุ่มเมาขี่ จยย. ชนดับสองคน',
    deaths: 2, injuries: null, tags: ['thai-numeral', 'counter', 'no-space'] },
  { id: 'word-sam-ray', title: 'เมาขับชนดับสามราย',
    deaths: 3, injuries: null, tags: ['thai-numeral', 'counter', 'no-space'] },
  { id: 'word-si-khon', title: 'เมาแล้วขับพลิกคว่ำ เจ็บสี่คน',
    deaths: null, injuries: 4, tags: ['thai-numeral', 'counter'] },
  { id: 'word-sip-et', title: 'รถตู้เมาขับพลิกคว่ำ ดับสิบเอ็ดราย',
    deaths: 11, injuries: null, tags: ['thai-numeral', 'compound', 'counter'] },
  { id: 'word-yi-sip', title: 'เมาขับชนรถตู้ ดับยี่สิบราย',
    deaths: 20, injuries: null, tags: ['thai-numeral', 'compound', 'counter'] },
  { id: 'word-yi-sip-sam', title: 'เมาขับชนรถบัส เจ็บยี่สิบสามคน',
    deaths: null, injuries: 23, tags: ['thai-numeral', 'compound', 'counter'] },
  { id: 'word-nueng-song', title: 'เมาขับชน ดับหนึ่งราย เจ็บสองคน',
    deaths: 1, injuries: 2, tags: ['thai-numeral', 'combined', 'counter'] },
  { id: 'word-sip', title: 'เมาขับ ดับสิบราย',
    deaths: 10, injuries: null, tags: ['thai-numeral', 'counter'] },
  { id: 'word-both-nospace', title: 'เมาขับชนดับสองรายเจ็บสามคน',
    deaths: 2, injuries: 3, tags: ['thai-numeral', 'combined', 'counter', 'no-space'] },
  { id: 'word-no-counter-rejected', title: 'เมาขับชนดับสอง',
    deaths: null, injuries: null, tags: ['thai-numeral'],
    note: 'ข้อจำกัดโดยเจตนา: เลขคำไทยต้องมีลักษณนามตาม ไม่งั้น สี่แยก/สองแถว/ยี่ห้อ จะกลายเป็นจำนวนคน' },

  // --------------------------------------------------------- false friends
  { id: 'ff-andap-1', title: 'ไทยติดอันดับ 1 ของอาเซียน เมาแล้วขับ',
    deaths: null, injuries: null, tags: ['false-friend'],
    note: 'อันดับ ⊃ ดับ — วันนี้คืน deaths=1' },
  { id: 'ff-jat-andap-5', title: 'จัดอันดับ 5 จังหวัดเสี่ยงเมาแล้วขับ',
    deaths: null, injuries: null, tags: ['false-friend'],
    note: 'วันนี้คืน deaths=5' },
  { id: 'ff-andap-1-sahet', title: 'เมาแล้วขับ อันดับ 1 สาเหตุอุบัติเหตุ',
    deaths: null, injuries: null, tags: ['false-friend'] },
  { id: 'ff-andap-3-sathiti', title: 'สถิติเมาขับสูงเป็นอันดับ 3 ของภูมิภาค',
    deaths: null, injuries: null, tags: ['false-friend'] },
  { id: 'ff-radap-250', title: 'ตรวจวัดระดับแอลกอฮอล์ 250 มก.% เมาแล้วขับ',
    deaths: null, injuries: null, tags: ['false-friend', 'unit-guard'],
    note: 'ระดับ ⊃ ดับ และ มก.% เป็นหน่วย ไม่ใช่คน' },
  { id: 'ff-fai-dap-5-chm', title: 'ไฟดับ 5 ชม. หลังเมาขับชนเสาไฟฟ้า',
    deaths: null, injuries: null, tags: ['false-friend', 'unit-guard'] },
  { id: 'ff-fai-dap-soi', title: 'เมาขับชนเสาไฟ ไฟดับทั้งซอย',
    deaths: null, injuries: null, tags: ['false-friend'] },
  { id: 'ff-ta-yai', title: 'สองตายายถูกหนุ่มเมาขับชน',
    deaths: null, injuries: null, tags: ['false-friend'],
    note: 'ตายาย ⊃ ตาย และ สอง อยู่ติดกัน' },
  { id: 'ff-dap-khrueang', title: 'หนุ่มเมาขับดับเครื่องหนี ตำรวจรวบ 1 ราย',
    deaths: null, injuries: null, tags: ['false-friend', 'checkpoint'] },
  { id: 'ff-dap-phloeng', title: 'เมาขับชนรถดับเพลิง 2 คัน',
    deaths: null, injuries: null, tags: ['false-friend', 'unit-guard'] },
  { id: 'ff-dap-fan', title: 'เมาขับดับฝันนักกีฬาทีมชาติ',
    deaths: null, injuries: null, tags: ['false-friend'] },
  { id: 'ff-jep-jai', title: 'หนุ่มเมาขับชน เจ็บใจไม่ได้ประกัน',
    deaths: null, injuries: null, tags: ['false-friend'] },
  { id: 'ff-si-yaek', title: 'เมาขับชนที่สี่แยกไฟแดง เจ็บ 2 ราย',
    deaths: null, injuries: 2, tags: ['false-friend', 'counter'],
    note: 'สี่แยก ต้องไม่กลายเป็นเลข 4' },
  { id: 'ff-sam-lo', title: 'เมาขับชนสามล้อพ่วง เจ็บ 1 ราย',
    deaths: null, injuries: 1, tags: ['false-friend', 'counter'] },
  { id: 'ff-song-thaeo', title: 'เมาขับชนสองแถว เจ็บ 3 คน',
    deaths: null, injuries: 3, tags: ['false-friend', 'counter'] },
  { id: 'ff-roi-tamruat-ek', title: 'ร้อยตำรวจเอกเมาขับ ชนดับ 1 ราย',
    deaths: 1, injuries: null, tags: ['false-friend', 'counter'] },
  { id: 'ff-roi-et-province', title: 'เมาขับชนที่ จ.ร้อยเอ็ด ดับ 2 ราย',
    deaths: 2, injuries: null, tags: ['false-friend', 'counter'],
    note: 'ร้อยเอ็ด เป็นจังหวัด ไม่ใช่ 101' },
  { id: 'ff-sip-lo', title: 'เมาขับชนรถสิบล้อ ดับ 1 ราย',
    deaths: 1, injuries: null, tags: ['false-friend', 'counter'] },

  // ------------------------------------------------------------- unit guard
  { id: 'unit-2-khan', title: 'เมาขับชน 2 คัน เสียหายหนัก',
    deaths: null, injuries: null, tags: ['unit-guard', 'no-casualty'] },
  { id: 'unit-yuet-2-khan', title: 'เมาขับชนแล้วหลบหนี ยึดรถ 2 คัน',
    deaths: null, injuries: null, tags: ['unit-guard', 'no-casualty'] },
  { id: 'unit-dap-3-wan', title: 'เมาขับชนดับ 3 วันก่อน',
    deaths: null, injuries: null, tags: ['unit-guard'],
    note: 'วัน เป็นหน่วยเวลา — ห้ามอ่านเป็นจำนวนคน' },
  { id: 'unit-dap-2-ray-3-wan', title: 'เมาขับ ดับ 2 ราย เมื่อ 3 วันก่อน',
    deaths: 2, injuries: null, tags: ['unit-guard', 'counter'] },
  { id: 'unit-3-lang', title: 'เมาขับพุ่งชนบ้าน เสียหาย 3 หลัง',
    deaths: null, injuries: null, tags: ['unit-guard', 'no-casualty'] },
  { id: 'unit-fine-baht', title: 'เมาแล้วขับ ค่าปรับ 20,000 บาท จำคุก 1 ปี',
    deaths: null, injuries: null, tags: ['unit-guard', 'no-casualty'] },

  // ------------------------------------------------------ combined / ordering
  { id: 'order-i2-d3', title: 'เมาขับชน เจ็บ 2 ดับ 3',
    deaths: 3, injuries: 2, tags: ['combined'],
    note: 'first-match-wins เดิมยัด 2 ให้ deaths' },
  { id: 'order-d1-i4', title: 'เมาขับชน ดับ 1 เจ็บ 4',
    deaths: 1, injuries: 4, tags: ['combined'] },
  { id: 'reverse-2-ray-d-1-ray-i', title: 'เมาขับชนคนข้ามถนน 2 รายเสียชีวิต 1 รายสาหัส',
    deaths: 2, injuries: 1, tags: ['reverse', 'combined', 'counter'] },
  { id: 'reverse-3-ray-dap', title: 'เมาขับชน 3 รายดับ',
    deaths: 3, injuries: null, tags: ['reverse', 'counter'] },
  { id: 'reverse-5-khon-badjep', title: 'เมาขับชน 5 คนบาดเจ็บ',
    deaths: null, injuries: 5, tags: ['reverse', 'counter'] },
  { id: 'order-i1-d2', title: 'เมาขับชนสาหัส 1 ราย ดับ 2 ราย',
    deaths: 2, injuries: 1, tags: ['combined', 'counter'] },
  { id: 'order-d2-i3-sahat', title: 'เมาขับ ดับ 2 ราย บาดเจ็บสาหัส 3 ราย',
    deaths: 2, injuries: 3, tags: ['combined', 'counter'] },
  { id: 'reverse-both', title: 'เมาขับพลิกคว่ำ 1 รายเสียชีวิต 3 รายบาดเจ็บ',
    deaths: 1, injuries: 3, tags: ['reverse', 'combined', 'counter'] },
  { id: 'order-d2-sop-i5', title: 'เมาขับชนดับ 2 ศพ เจ็บ 5 ราย',
    deaths: 2, injuries: 5, tags: ['combined', 'counter'] },
  { id: 'order-nospace-all', title: 'เมาขับชนดับ2ศพเจ็บ3ราย',
    deaths: 2, injuries: 3, tags: ['no-space', 'combined', 'counter'] },
  { id: 'order-d2-i1-pickup', title: 'เมาแล้วขับ ซิ่งกระบะพุ่งชน จยย. ดับ 2 เจ็บ 1',
    deaths: 2, injuries: 1, tags: ['combined'] },
  { id: 'order-d1-i1-max', title: 'หนุ่มเมาขับเก๋งชนคนกวาดถนน ดับ 1 ราย สาหัส 1 ราย',
    deaths: 1, injuries: 1, tags: ['combined', 'counter'] },
  { id: 'order-jep-3-sahat-1', title: 'เมาขับ ชนดับ 2 คน เจ็บ 3 คน สาหัส 1 ราย',
    deaths: 2, injuries: 3, tags: ['combined', 'counter'],
    note: 'เจ็บ 3 สาหัส 1 = เจ็บ 3 คน (1 คนอาการหนัก) → เอาค่ามากสุดในชนิดเดียวกัน' },
  { id: 'order-d1-i2-sahat-1', title: 'เมาขับชน ดับ 1 ราย เจ็บ 2 ราย สาหัส 1 ราย',
    deaths: 1, injuries: 2, tags: ['combined', 'counter'] },
  { id: 'order-d1-i1-win', title: 'เมาแล้วขับชนคนขับวินฯ ดับ 1 เจ็บ 1',
    deaths: 1, injuries: 1, tags: ['combined'] },

  // ---------------------------------------------------------------- implied
  { id: 'implied-dap-kha-thi', title: 'หนุ่มเมาซิ่งเก๋งเสยท้ายสิบล้อ ดับคาที่',
    deaths: 1, injuries: null, tags: ['implied'] },
  { id: 'implied-dap-salot', title: 'เมาขับชนต้นไม้ ดับสลด',
    deaths: 1, injuries: null, tags: ['implied'] },
  { id: 'implied-siachiwit-kha-thi', title: 'เมาขับพุ่งชน เสียชีวิตคาที่',
    deaths: 1, injuries: null, tags: ['implied'] },
  { id: 'implied-dap-anat', title: 'เมาขับชน ดับอนาถ',
    deaths: 1, injuries: null, tags: ['implied'] },
  { id: 'implied-dap-kha-phuang', title: 'เมาขับชน ดับคาพวงมาลัย',
    deaths: 1, injuries: null, tags: ['implied'] },
  { id: 'implied-tai-kha-thi-2-sop', title: 'เมาขับพุ่งชน ตายคาที่ 2 ศพ',
    deaths: 2, injuries: null, tags: ['counter'],
    note: 'มีเลขชัด → ห้ามใช้ implied 1' },
  { id: 'implied-badjep-sahat', title: 'เมาขับชนจยย. บาดเจ็บสาหัส',
    deaths: null, injuries: 1, tags: ['implied'] },
  { id: 'implied-khoma', title: 'เมาขับชน อาการโคม่า',
    deaths: null, injuries: 1, tags: ['implied'] },
  { id: 'implied-sahat-bare', title: 'เมาขับชนต้นไม้ คนขับสาหัส',
    deaths: null, injuries: 1, tags: ['implied'] },
  { id: 'implied-jep-lek-noi', title: 'เมาขับชนกำแพง คนขับเจ็บเล็กน้อย',
    deaths: null, injuries: 1, tags: ['implied'] },
  { id: 'implied-d1-i2', title: 'เมาขับชนดับคาที่ 1 เจ็บสาหัส 2 ราย',
    deaths: 1, injuries: 2, tags: ['combined', 'counter'] },
  { id: 'implied-both', title: 'เมาขับชน ดับคาที่ เจ็บสาหัส',
    deaths: 1, injuries: 1, tags: ['implied', 'combined'] },
  { id: 'implied-mixed-driver', title: 'เมาขับชนรถพ่วง คนขับดับคาที่ ผู้โดยสารเจ็บ 2 ราย',
    deaths: 1, injuries: 2, tags: ['implied', 'combined', 'counter'] },
  { id: 'implied-mi-phu-siachiwit-bare', title: 'เมาขับชนจนมีผู้เสียชีวิต',
    deaths: null, injuries: null, tags: ['implied'],
    note: 'ไม่ระบุจำนวน และ "มีผู้เสียชีวิต" อาจมากกว่า 1 — คืน null อย่างซื่อสัตย์ ห้ามเดา 1' },

  // ------------------------------------------------------------- indefinite
  { id: 'indef-jep-ranao', title: 'เมาขับชนกลุ่มวัยรุ่น เจ็บระนาว',
    deaths: null, injuries: null, tags: ['indefinite'] },
  { id: 'indef-badjep-ue', title: 'เมาขับชนตลาด บาดเจ็บอื้อ',
    deaths: null, injuries: null, tags: ['indefinite'] },
  { id: 'indef-dap-lai-ray', title: 'เมาขับชน ดับหลายราย',
    deaths: null, injuries: null, tags: ['indefinite'] },
  { id: 'indef-siachiwit-lai-sop', title: 'เมาขับชนรถตู้ เสียชีวิตหลายศพ',
    deaths: null, injuries: null, tags: ['indefinite'] },
  { id: 'indef-jep-phiap', title: 'เมาขับชน เจ็บเพียบ',
    deaths: null, injuries: null, tags: ['indefinite'] },
  { id: 'indef-dap-kha-thi-lai-sop', title: 'เมาขับชนดับคาที่หลายศพ',
    deaths: null, injuries: null, tags: ['indefinite', 'implied'],
    note: 'indefinite ต้องชนะ implied — ห้ามคืน 1' },
  { id: 'indef-dap-chamnuan-mak', title: 'เมาขับชน ดับจำนวนมาก',
    deaths: null, injuries: null, tags: ['indefinite'] },

  // ----------------------------------------------------------- explicit zero
  { id: 'zero-both', title: 'เมาแล้วขับพลิกคว่ำกลางถนน ไม่มีผู้บาดเจ็บและเสียชีวิต',
    deaths: 0, injuries: 0, tags: ['explicit-zero'] },
  { id: 'zero-deaths-only', title: 'เมาขับชนเสาไฟ ไม่มีผู้เสียชีวิต',
    deaths: 0, injuries: null, tags: ['explicit-zero'] },
  { id: 'zero-injuries-only', title: 'เมาขับชนท้ายรถ ไม่มีผู้ได้รับบาดเจ็บ',
    deaths: null, injuries: 0, tags: ['explicit-zero'] },
  { id: 'zero-both-reordered', title: 'เมาขับพลิกคว่ำ ไม่มีผู้เสียชีวิตและบาดเจ็บ',
    deaths: 0, injuries: 0, tags: ['explicit-zero'] },
  { id: 'zero-rot-tai', title: 'เมาขับชนรอดตายหวุดหวิด',
    deaths: 0, injuries: null, tags: ['explicit-zero'] },
  { id: 'zero-mai-mi-khrai-jep', title: 'เมาแล้วขับชนท้าย ไม่มีใครเจ็บ',
    deaths: null, injuries: 0, tags: ['explicit-zero'] },
  { id: 'zero-mai-mi-raingan', title: 'เมาขับชนรถเข็น ไม่มีรายงานผู้บาดเจ็บ',
    deaths: null, injuries: 0, tags: ['explicit-zero'] },
  { id: 'zero-two-phrases', title: 'เมาขับชนเสาไฟฟ้า ไม่มีผู้บาดเจ็บ ไม่มีผู้เสียชีวิต',
    deaths: 0, injuries: 0, tags: ['explicit-zero'] },
  { id: 'zero-plus-positive', title: 'เมาขับชน ไม่มีผู้เสียชีวิต บาดเจ็บ 3 ราย',
    deaths: 0, injuries: 3, tags: ['explicit-zero', 'combined'] },
  { id: 'zero-numeric-dap-0', title: 'เมาขับชนม็อบ เจ็บ 12 ราย ดับ 0 ราย',
    deaths: 0, injuries: 12, tags: ['explicit-zero', 'combined', 'counter'],
    note: 'ศูนย์ที่เขียนเป็นตัวเลข ต้องไม่กลายเป็น null' },
  { id: 'zero-numeric-jep-0', title: 'เมาขับ ดับ 1 ราย เจ็บ 0 ราย',
    deaths: 1, injuries: 0, tags: ['explicit-zero', 'combined', 'counter'] },
  { id: 'zero-i10-d0', title: 'เมาขับชนแผงลอย บาดเจ็บ 10 ราย ไม่มีผู้เสียชีวิต',
    deaths: 0, injuries: 10, tags: ['explicit-zero', 'combined', 'counter'] },

  // ---------------------------------------------------------------- aggregate
  { id: 'agg-songkran-264', title: 'สรุปยอด 7 วันอันตรายสงกรานต์ เสียชีวิต 264 ศพ เมาแล้วขับสาเหตุอันดับ 1',
    deaths: 264, injuries: null, scope: 'aggregate', tags: ['aggregate'],
    note: 'เลขจริง แต่เป็นยอดทั้งประเทศ — ต้องไม่เข้า story rollup หรือยอดรวมหน้าเว็บ' },
  { id: 'agg-sopotho-1234', title: 'ศปถ. เผยสถิติเมาแล้วขับ เสียชีวิต 1,234 ราย ตลอดทั้งปี',
    deaths: 1234, injuries: null, scope: 'aggregate', tags: ['aggregate'],
    note: 'ตัวคั่นหลักพัน — วันนี้อ่านได้ 1' },
  { id: 'agg-yod-sasom', title: 'ยอดสะสม 7 วัน เมาขับ ดับ 45 ราย เจ็บ 300 ราย',
    deaths: 45, injuries: 300, scope: 'aggregate', tags: ['aggregate', 'combined'] },
  { id: 'agg-thua-prathet', title: 'สถิติอุบัติเหตุเมาแล้วขับทั่วประเทศ เสียชีวิต 500 ราย',
    deaths: 500, injuries: null, scope: 'aggregate', tags: ['aggregate'] },

  // -------------------------------------------------------- checkpoint counts
  { id: 'chk-1234-ray', title: 'ตั้งด่านตรวจแอลกอฮอล์ รวบเมาแล้วขับ 1,234 ราย',
    deaths: null, injuries: null, tags: ['checkpoint'],
    note: 'ราย ที่นี่นับคนถูกจับ ไม่ใช่ผู้บาดเจ็บ — ไม่มี casualty keyword จึงต้องไม่จับเลข' },
  { id: 'chk-jap-250', title: 'ด่านตรวจเมาขับ จับกุม 250 ราย ปรับ 5,000 บาท',
    deaths: null, injuries: null, tags: ['checkpoint'] },
  { id: 'chk-87-khon', title: 'ตำรวจตั้งด่าน จับเมาแล้วขับ 87 คน',
    deaths: null, injuries: null, tags: ['checkpoint'] },
  { id: 'chk-yuet-12', title: 'ด่านแอลกอฮอล์ ยึดใบขับขี่ 12 ราย',
    deaths: null, injuries: null, tags: ['checkpoint'] },
  { id: 'chk-plus-crash', title: 'ตั้งด่านเมาขับ รวบ 40 ราย ดับ 1 ราย',
    deaths: 1, injuries: null, tags: ['checkpoint', 'counter'] },

  // ------------------------------------------------- truncated title fallback
  { id: 'trunc-phuyaiban',
    title: 'สอบวินัยร้ายแรงผู้ใหญ่บ้านเมาขับ ซิ่งกระบะชน 2 วัยรุ่น ดับ ...',
    summary: 'เจ้าหน้าที่เผยว่าคนขับมีปริมาณแอลกอฮอล์ 180 มก.% พุ่งชนวัยรุ่น 2 คน ดับ 2 ราย ในที่เกิดเหตุ',
    deaths: 2, injuries: null, tags: ['truncated', 'summary'],
    note: 'เคสจริงจาก Bing — พาดหัวถูกตัดก่อนถึงเลข เลขอยู่ในสรุปข่าว' },
  { id: 'trunc-summary-d1-i2',
    title: 'เมาขับชนดับ ...',
    summary: 'คนขับเมาแล้วขับพุ่งชนรถจักรยานยนต์ เสียชีวิต 1 ราย บาดเจ็บ 2 ราย',
    deaths: 1, injuries: 2, tags: ['truncated', 'summary', 'combined'] },
  { id: 'trunc-komchadluek',
    title: 'ผู้ว่าฯ สั่งสอบ ผู้ใหญ่บ้าน ชนนักเรียน ...',
    summary: 'ขับกระบะพุ่งชน จยย. นักเรียน ดับ 2 ราย ขณะที่ญาติหวั่นไม่ได้รับความเป็นธรรม',
    deaths: 2, injuries: null, tags: ['truncated', 'summary'],
    note: 'ข่าวเดียวกับ trunc-phuyaiban คนละสำนัก — ต้องได้ 2 ทั้งคู่เพื่อให้ dedup merge ติด' },
  { id: 'trunc-implied-loses-to-summary',
    title: 'เมาขับชน ดับคาที่ ...',
    summary: 'เจ้าหน้าที่กู้ภัยรายงาน เสียชีวิต 3 ราย บาดเจ็บ 1 ราย',
    deaths: 3, injuries: 1, tags: ['truncated', 'summary', 'implied'],
    note: 'implied 1 จากพาดหัวที่ถูกตัด ต้องแพ้เลขชัดในสรุปข่าว' },

  // ------------------------------------------------------------- body fallback
  { id: 'body-d2-i1',
    title: 'หนุ่มเมาขับซิ่งเก๋งชนกลางดึก',
    summary: 'เกิดเหตุที่ถนนพระราม 2',
    body: 'ตำรวจ สน.ท่าข้าม รับแจ้งเหตุรถเก๋งพุ่งชนรถจักรยานยนต์ ผู้เสียชีวิต 2 ราย บาดเจ็บ 1 ราย นำส่งโรงพยาบาล',
    deaths: 2, injuries: 1, tags: ['body'],
    note: 'พระราม 2 เป็นชื่อถนน — เลข 2 ในสรุปข่าวต้องไม่กลายเป็นจำนวนคน' },
  { id: 'body-i4-d0',
    title: 'เมาขับพุ่งชนร้านค้า',
    body: 'คนขับมีอาการมึนเมา พุ่งชนร้านค้าริมทาง มีผู้บาดเจ็บ 4 ราย ไม่มีผู้เสียชีวิต',
    deaths: 0, injuries: 4, tags: ['body', 'explicit-zero'] },
  { id: 'body-d1-i3',
    title: 'เมาแล้วขับชนกลางสี่แยก',
    body: 'อุบัติเหตุเกิดขึ้นเมื่อเวลา 02.00 น. ผลการตรวจพบแอลกอฮอล์ 150 มก.% ดับ 1 เจ็บ 3',
    deaths: 1, injuries: 3, tags: ['body', 'combined'] },

  // ------------------------------------------------------------------ ranges
  { id: 'range-dap-2-3', title: 'เมาแล้วขับชนกลุ่มวัยรุ่น ดับ 2-3 ราย',
    deaths: 2, injuries: null, tags: ['range', 'counter'],
    note: 'เอาขอบล่าง evidence=range' },
  { id: 'range-jep-4-thueng-5', title: 'เมาขับชน เจ็บ 4 ถึง 5 ราย',
    deaths: null, injuries: 4, tags: ['range', 'counter'] },

  // ------------------------------------------------------- developing tolls
  { id: 'dev-yod-dap-phoem', title: 'เมาขับชน ยอดดับเพิ่มเป็น 3 ราย',
    deaths: 3, injuries: null, tags: ['counter'] },
  { id: 'dev-yod-siachiwit-phoem', title: 'เมาขับชน ยอดผู้เสียชีวิตเพิ่มเป็น 4 ราย',
    deaths: 4, injuries: null, tags: ['counter'] },
  { id: 'dev-dap-laeo', title: 'เมาขับชน ดับแล้ว 2 ราย',
    deaths: 2, injuries: null, tags: ['counter'] },

  // ------------------------------------------------------------------- misc
  { id: 'typo-sara-e', title: 'เเมาเเล้วขับชนดับ 2 ราย',
    deaths: 2, injuries: null, tags: ['typo', 'counter'],
    note: 'เเ เป็น typo ยอดนิยมของ แ' },
  { id: 'area-pak-chong', title: 'เมาขับชนที่ปากช่อง ดับ 2 ราย',
    deaths: 2, injuries: null, tags: ['counter'] },
  { id: 'area-hua-hin', title: 'เมาขับชนที่หัวหิน เจ็บ 3 ราย',
    deaths: null, injuries: 3, tags: ['counter'] },

  // ------------------------- observed live: count + person-noun + keyword
  // Four of these appeared in a single `npm run ingest --dry-run`. Thai
  // headlines count victims with the noun instead of a counter.
  { id: 'live-2-wairun-dap',
    title: 'สอบวินัยร้ายแรงผู้ใหญ่บ้านเมาขับ ซิ่งกระบะชน 2 วัยรุ่น ดับ นายอำเภอให้ลาออกแล้ว',
    deaths: 2, injuries: null, tags: ['reverse', 'counter'] },
  { id: 'live-2-yaowachon-dap',
    title: 'ผู้ว่าฯกำแพงเพชร สั่งฟันวินัยร้ายแรง ผู้ใหญ่บ้านเมาขับซิ่งชน2เยาวชนดับ',
    deaths: 2, injuries: null, tags: ['reverse', 'counter', 'no-space'] },
  { id: 'live-2-nakrian-dap',
    title: 'ผู้ใหญ่บ้านเมาขับชน จยย. 2 นักเรียนดับ แชทโผล่สั่งปิดข่าว ญาติหวั่นไม่เป็นธรรม',
    deaths: 2, injuries: null, tags: ['reverse', 'counter'] },
  { id: 'live-2-nakrian-dap-alt',
    title: 'ญาติร้องผู้ใหญ่บ้านเมา ซิ่งกระบะชน 2 นักเรียนดับ ผู้ว่าฯ สั่งสอบวินัยร้ายแรง นายอำเภอให้ลาออก',
    deaths: 2, injuries: null, tags: ['reverse', 'counter'],
    note: 'ข่าวเดียวกับ live-2-nakrian-dap คนละสำนัก — ต้องได้ 2 ทั้งคู่ ไม่งั้น dedup ไม่ merge' },
  { id: 'live-chonburi-fc',
    title: 'เเข้งชลบุรีเอฟซีซิ่งเก๋งแหกโค้งชนคนดับ 1 สาหัสอีก 1',
    deaths: 1, injuries: 1, tags: ['typo', 'combined'] },
  { id: 'live-jep-1-truncated',
    title: 'โจ๋ลำปางซิ่ง จยย. พุ่งชนตำรวจจุดตรวจเมาแล้วขับ เจ็บ 1 ก่อนแหก ...',
    deaths: null, injuries: 1, tags: ['truncated'] },
  { id: 'live-chon-khon-tai',
    title: 'ข่าวผู้ว่าฯ สั่งสอบ ผญบ. เมาแล้วขับชนคนตาย จ.กำแพงเพชร',
    deaths: null, injuries: null, tags: ['implied'],
    note: 'ระบุว่ามีคนตายแต่ไม่บอกจำนวน — ต้องคืน null ไม่ใช่เดา 1' },
  { id: 'live-lung-det',
    title: 'ไกล่เกลี่ยรอบแรกไร้ผล! “ลุงเดช เมาแล้วขับ”ชน “น้องเติมฝัน”ดับ-แม่เมย์ สาหัส อ้างไม่มีเงิน-ทรัพย์สินเยียวยา',
    deaths: null, injuries: 1, tags: ['implied'],
    note: 'ชื่อคนตามด้วย ดับ ไม่มีตัวเลข → null; สาหัส ลอย → เจ็บ 1' },
  { id: 'live-no-casualty-stated',
    title: 'ข่าวเมาแล้วขับ เบียดชนรถ จยย.ตกข้างทาง',
    deaths: null, injuries: null, tags: ['no-casualty'] },
  { id: 'live-lak-100-metre',
    title: 'หนุ่มเมาขับเก๋งพุ่งชนลากจยย.กว่า 100 เมตร เตี๊ยมเพื่อนสลับตัวขับ',
    deaths: null, injuries: null, tags: ['unit-guard', 'no-casualty'],
    note: '100 เมตร เป็นระยะทาง' },

  // -------------------------------------------------- nothing to extract
  { id: 'none-penalty', title: 'เมาแล้วขับ โทษปรับสูงสุด 20,000 บาท',
    deaths: null, injuries: null, tags: ['no-casualty', 'unit-guard'] },
  { id: 'none-campaign', title: 'รณรงค์เมาไม่ขับ ช่วงเทศกาลปีใหม่',
    deaths: null, injuries: null, tags: ['no-casualty'] },
  { id: 'none-legal-50', title: 'เปิดกฎหมายเมาแล้วขับ ระดับแอลกอฮอล์เกิน 50 มก.%',
    deaths: null, injuries: null, tags: ['no-casualty', 'false-friend', 'unit-guard'] },
  { id: 'none-insurance', title: 'เมาแล้วขับ ประกันไม่คุ้มครอง จริงหรือ',
    deaths: null, injuries: null, tags: ['no-casualty'] }
];

/** Cases where any emitted number is a false positive. */
export const FALSE_POSITIVE_TAGS: CasualtyTag[] = [
  'false-friend', 'checkpoint', 'unit-guard', 'indefinite', 'no-casualty'
];

export function isFalsePositiveCase(c: CasualtyCase): boolean {
  return c.deaths === null && c.injuries === null &&
    c.tags.some(t => FALSE_POSITIVE_TAGS.includes(t));
}
