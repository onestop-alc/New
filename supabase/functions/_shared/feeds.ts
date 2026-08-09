// Google News RSS notes (measured 2026-08-09 against
// https://news.google.com/rss/search?q=...&hl=th&gl=TH&ceid=TH:th):
//  * hard cap of 100 items per query, relevance-ranked — NOT recency-ranked
//  * unquoted `OR` works and raises recent-item density (28 -> 44 items in the
//    last 30 days); quoting the phrases lowers it
//  * `when:` is broken (when:1d returned one unrelated item) and `allintext:`
//    returns nothing — never use either
export const GOOGLE_NEWS_QUERIES = [
  "เมาแล้วขับ OR เมาขับ OR ดื่มแล้วขับ",
  "เมาแล้วขับ ชน OR ดับ OR เสียชีวิต",
  "เมาแล้วขับ จับกุม OR รวบ OR ดำเนินคดี",
  "เป่าแอลกอฮอล์ OR ตรวจวัดแอลกอฮอล์ OR ด่านตรวจแอลกอฮอล์",
  "ตั้งด่าน ตรวจแอลกอฮอล์ OR เป่าแอลกอฮอล์",
  "ขับรถขณะเมาสุรา OR มิลลิกรัมเปอร์เซ็นต์"
];

// Archive-heavy and seasonal: each returned zero unique articles from the last
// 30 days, but they spike during Songkran and New Year. Run weekly, not every
// 30 minutes — `npm run ingest -- --seasonal`.
export const GOOGLE_NEWS_QUERIES_SEASONAL = [
  "เมาแล้วขับ สงกรานต์ OR ปีใหม่ OR 7 วันอันตราย",
  "คุมประพฤติ เมาแล้วขับ OR เมาขับ",
  "เมาแล้วขับ ริบรถ OR ยึดใบขับขี่ OR คุก",
  "ไม่ยอมเป่า OR ปฏิเสธเป่า แอลกอฮอล์"
];

// Whole-site Thai feeds are general-news firehoses: 0 of 502 items across the
// 13 feeds that still respond passed the filter, and Google News already
// indexes every one of those outlets. Left empty on purpose.
// Working URLs, if this is ever revisited (measured item counts):
//   https://www.thairath.co.th/rss/news (20), https://www.khaosod.co.th/feed (50,
//   browser UA required — /rss is Cloudflare-blocked), https://www.matichon.co.th/feed (50),
//   https://www.matichon.co.th/local/crime/feed (50), https://www.prachachat.net/feed (30),
//   https://www.dailynews.co.th/news_group/crime/feed/ (12), https://www.amarintv.com/rss/news (20).
// Dead: khaosod /rss (403), dailynews /feed/ (200 but zero items), siamrath /rss (HTML).
export const DIRECT_FEEDS: string[] = [];

// ---------------------------------------------------------------------------
// Classification vocabulary.
//
// Every term below is matched against normalizeForMatch() output, which strips
// spaces and punctuation — so write terms unspaced. Thai has no word
// boundaries, so short tokens are substrings of unrelated words: "ชน" lives
// inside ประชาชน, "ดับ" inside อันดับ/ดับเพลิง, "เมา" inside เมาท์แบตเทน.
// The lists are split along two axes (alcohol evidence x driving/enforcement
// context) instead of one strong/weak axis, which is what keeps bar raids and
// liquor-tax stories out.
// ---------------------------------------------------------------------------

/** Tier 1: a single match is definitive drunk driving. */
export const DUI_PHRASES = [
  "เมาแล้วขับ", "เมาแล้วขี่", "เมาขับ", "เมาขี่", "เมาซิ่ง", "เมาแล้วซิ่ง", "เมาแล้วชน",
  "ดื่มแล้วขับ", "ดื่มแล้วขี่", "ขับขณะเมาสุรา", "ขับรถขณะเมาสุรา", "ขับขี่ขณะเมาสุรา",
  "ขับรถขณะมึนเมา", "เมาแล้วขับรถ", "เมาแอ๋ขับ", "เมาหลับคารถ"
];

/** Tier 1: breath/blood testing language, near-exclusive to DUI enforcement. */
export const ALCOTEST_STRONG = [
  "เป่าแอลกอฮอล์", "เป่าวัดแอลกอฮอล์", "เป่าแอลฯ", "เป่าเมา", "เป่าทะลุ",
  "ตรวจวัดแอลกอฮอล์", "ตรวจวัดปริมาณแอลกอฮอล์", "วัดปริมาณแอลกอฮอล์",
  "ทดสอบปริมาณแอลกอฮอล์", "มิลลิกรัมเปอร์เซ็นต์", "มิลลิกรัมเปอร์เซนต์",
  "มก.%", "มก.เปอร์เซ็นต์",
  "ปฏิเสธเป่า", "ไม่ยอมเป่า", "ไม่เป่าแอลกอฮอล์", "ปฏิเสธการเป่า", "ปฏิเสธตรวจวัดแอลกอฮอล์"
];

/** Tier 2: alcohol testing that also appears in medical/lab contexts. */
export const ALCOTEST_WEAK = [
  "ตรวจแอลกอฮอล์", "วัดแอลกอฮอล์", "แอลกอฮอล์ในเลือด",
  "ปริมาณแอลกอฮอล์ในร่างกาย", "ระดับแอลกอฮอล์", "ค่าแอลกอฮอล์"
];

/** Tier 1: named alcohol checkpoints. */
export const CHECKPOINT_STRONG = [
  "ด่านตรวจแอลกอฮอล์", "ด่านแอลกอฮอล์", "ด่านตรวจวัดแอลกอฮอล์", "ด่านวัดแอลกอฮอล์",
  "จุดตรวจวัดแอลกอฮอล์", "จุดตรวจแอลกอฮอล์", "ด่านตรวจเมา", "ด่านเมาไม่ขับ",
  "ด่านตรวจวัดระดับแอลกอฮอล์"
];

/**
 * Tier 2: generic checkpoints, need alcohol + driving/enforcement alongside.
 * Bare "ด่าน" is deliberately absent — it matches ด่านศุลกากร, ด่านชายแดน, ด่านลอย.
 */
export const CHECKPOINT_WEAK = [
  "ตั้งด่าน", "จุดตรวจ", "ด่านตรวจ", "ด่านจราจร",
  "แหกด่าน", "หนีด่าน", "ฝ่าด่าน", "เข้าด่าน", "เจอด่าน", "จุดสกัด"
];

export const DRIVING_TERMS = [
  "ขับ", "ขี่", "คนขับ", "ผู้ขับขี่", "ผู้ขับ", "ใบขับขี่", "โชเฟอร์", "ซิ่ง", "จราจร",
  "รถยนต์", "เก๋ง", "กระบะ", "ปิกอัพ", "จยย", "จักรยานยนต์", "มอเตอร์ไซค์", "บิ๊กไบค์",
  "รถบรรทุก", "รถตู้", "รถพ่วง", "รถหรู", "ไรเดอร์", "ตุ๊กตุ๊ก", "แท็กซี่"
];

export const ENFORCEMENT_TERMS = [
  "จับกุม", "ถูกจับ", "รวบ", "ดำเนินคดี", "แจ้งข้อหา", "ตั้งข้อหา", "ส่งฟ้อง", "สั่งฟ้อง",
  "เปรียบเทียบปรับ", "คุมประพฤติ", "บำเพ็ญประโยชน์", "ริบรถ", "ยึดใบขับขี่",
  "พักใช้ใบขับขี่", "เพิกถอนใบขับขี่", "จำคุก", "ประกันตัว", "พ.ร.บ.จราจร", "ศาล"
];

/** Bare "ดับ" removed: it matches อันดับ / ระดับ / ดับเพลิง / ดับเครื่อง. */
export const CRASH_TERMS = [
  "ชน", "เฉี่ยวชน", "พุ่งชน", "เสยท้าย", "คว่ำ", "พลิกคว่ำ", "ตกข้างทาง", "ตกถนน",
  "อุบัติเหตุ", "ดับคาที่", "ดับสลด", "ดับ 1", "ดับ 2", "ดับ 3", "เสียชีวิต",
  "บาดเจ็บ", "สาหัส", "โคม่า", "เจ็บ"
];

/** Ambiguous alcohol mentions — only ever reach the medium tier. */
export const ALCOHOL_WEAK = [
  "เมา", "มึนเมา", "แอลกอฮอล์", "แอลฯ", "กลิ่นเหล้า", "กลิ่นสุรา",
  "ดื่มสุรา", "ดื่มเหล้า", "ดื่มเบียร์", "น้ำเมา", "เมาสุรา", "นักดื่ม"
];

/** Prevention campaigns: real, but not incidents. Capped at medium. */
export const CAMPAIGN_TERMS = [
  "เมาไม่ขับ", "ดื่มไม่ขับ", "ดื่มไม่ขี่", "เมาไม่ขี่", "ขับไม่ดื่ม",
  "7วันอันตราย", "เจ็ดวันอันตราย", "ด่านปากหวาน"
];

export const NEGATIVE_TERMS = [
  // wrong sense of เมา
  "เมารถ", "เมาเรือ", "เมาคลื่น", "เมาเครื่องบิน", "เมาหมัด", "เมามวย", "เมารัก",
  "เมาอำนาจ", "เมายศ", "เมาท์", "เมาแล้วเดิน", "เมาแล้วนอน",
  // drugs, not alcohol
  "เมากัญชา", "เมายาบ้า", "เมายา",
  // non-beverage alcohol
  "เจลแอลกอฮอล์", "สเปรย์แอลกอฮอล์", "แอลกอฮอล์ล้างมือ", "แอลกอฮอล์ฆ่าเชื้อ",
  "แอลกอฮอล์ทางการแพทย์", "ไร้แอลกอฮอล์", "ปราศจากแอลกอฮอล์", "แอลกอฮอล์0%",
  // liquor trade / tax / licensing / bar raids
  "ภาษีสุรา", "ภาษีเบียร์", "สรรพสามิต", "สุราเถื่อน", "เหล้าเถื่อน", "สุราชุมชน",
  "ใบอนุญาตขายสุรา", "พ.ร.บ.สุรา", "พ.ร.บ.ควบคุมเครื่องดื่มแอลกอฮอล์",
  "ขายเหล้า", "ขายสุรา", "ลักลอบขายสุรา", "เหล้าปลอม", "โรงเบียร์",
  "คราฟต์เบียร์", "โรงงานสุรา",
  // devices / commerce
  "เครื่องวัดแอลกอฮอล์", "เครื่องเป่าแอลกอฮอล์", "เครื่องตรวจแอลกอฮอล์",
  // false-friend checkpoint: an extortion roadblock, not an alcohol one
  "ด่านลอย"
];

/** Stripped before matching: place names containing alcohol substrings. */
export const PLACE_GUARD = ["สุราษฎร์ธานี", "สุราษฎร์"];

/** SEO evergreen explainers that resurface forever. Demote high -> medium. */
export const EVERGREEN_MARKERS = [
  "โทษเท่าไหร่", "มีโทษอย่างไร", "เปิดอัตราโทษ", "ค่าปรับเท่าไร", "สรุปกฎหมาย",
  "อัพเดทกฎหมาย", "อัปเดตกฎหมาย", "กี่ชั่วโมง", "กี่ช็อต", "ตรวจไม่เจอ",
  "เช็กข่าวชัวร์", "เช็คข่าวชัวร์", "จริงหรือ", "วิธีเลี่ยง", "ทำไงดี",
  "คุ้มครองหรือไม่", "รู้ไว้ก่อน", "ต้องรู้"
];

/** Aggregators / UGC reposts: never earn high. */
export const SOFT_SOURCE_BLOCK = [
  "facebook.com", "tiktok.com", "youtube.com", "x.com", "twitter.com", "instagram.com"
];

/** Non-Thai outlets machine-translated into Thai. */
export const HARD_SOURCE_BLOCK = ["vietnam.vn"];

export const SYNONYMS: Record<string, string> = {
  "จยย.": "②",
  "จักรยานยนต์": "②",
  "มอเตอร์ไซค์": "②",
  "รถเก๋ง": "③",
  "เก๋ง": "③",
  "กระบะ": "④",
  "ปิกอัพ": "④",
  "ดับ": "⑧",
  "เสียชีวิต": "⑧",
  "ตาย": "⑧",
  "ตายคาที่": "⑧",
  "สาหัส": "⑨",
  "บาดเจ็บ": "⑨",
  "เจ็บ": "⑨"
};

export const FILLER = [
  "ที่", "ใน", "และ", "หรือ", "ของ", "กับ", "มี", "การ", "ความ"
];

export const PROVINCES = [
  "กรุงเทพมหานคร", "กระบี่", "กาญจนบุรี", "กาฬสินธุ์", "กำแพงเพชร", "ขอนแก่น",
  "จันทบุรี", "ฉะเชิงเทรา", "ชลบุรี", "ชัยนาท", "ชัยภูมิ", "ชุมพร", "เชียงราย",
  "เชียงใหม่", "ตรัง", "ตราด", "ตาก", "นครนายก", "นครปฐม", "นครพนม", "นครราชสีมา",
  "นครศรีธรรมราช", "นครสวรรค์", "นนทบุรี", "นราธิวาส", "น่าน", "บึงกาฬ", "บุรีรัมย์",
  "ปทุมธานี", "ประจวบคีรีขันธ์", "ปราจีนบุรี", "ปัตตานี", "พระนครศรีอยุธยา", "พะเยา",
  "พังงา", "พัทลุง", "พิจิตร", "พิษณุโลก", "เพชรบุรี", "เพชรบูรณ์", "แพร่", "ภูเก็ต",
  "มหาสารคาม", "มุกดาหาร", "แม่ฮ่องสอน", "ยโสธร", "ยะลา", "ร้อยเอ็ด", "ระนอง",
  "ระยอง", "ราชบุรี", "ลพบุรี", "ลำปาง", "ลำพูน", "เลย", "ศรีสะเกษ", "สกลนคร",
  "สงขลา", "สตูล", "สมุทรปราการ", "สมุทรสงคราม", "สมุทรสาคร", "สระแก้ว", "สระบุรี",
  "สิงห์บุรี", "สุโขทัย", "สุพรรณบุรี", "สุราษฎร์ธานี", "สุรินทร์", "หนองคาย",
  "หนองบัวลำภู", "อ่างทอง", "อำนาจเจริญ", "อุดรธานี", "อุตรดิตถ์", "อุทัยธานี", "อุบลราชธานี",
  // Common names
  "กทม", "กทม.", "โคราช", "พัทยา", "หาดใหญ่"
];

export const CONFIG = {
  SIMILARITY_THRESHOLD: 0.35,
  /** Merge shortcut: near-identical titles from the same province. */
  STRONG_SIMILARITY: 0.85,
  DEDUP_WINDOW_DAYS: 3,
  MAX_SUMMARY_LENGTH: 300,
  /** Google News is relevance-ranked and returns items back to 2009. */
  MAX_ARTICLE_AGE_DAYS: 45,
  /** A story only shows the HIGH badge once this many outlets report it. */
  HIGH_BADGE_MIN_SOURCES: 2,
  FEED_TIMEOUT_MS: 15000
};
