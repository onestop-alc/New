# ระบบรวมข่าว "เมาแล้วขับ + ด่าน/จับกุมแอลกอฮอล์"

เว็บ React + Vite อ่านข่าวจาก Supabase โดยตรง ส่วนตัวดูดข่าวรันอยู่บน Supabase Edge Function
ตั้งเวลาโดย `pg_cron` ทุก 30 นาที (ไม่ต้องเปิดเครื่องทิ้งไว้)

## สถาปัตยกรรม

```
pg_cron (ทุก 30 นาที)
  └─ pg_net → POST /functions/v1/ingest   (header x-ingest-secret จาก Vault)
       └─ Edge Function (Deno)
            ├─ Bing News RSS ×8 คำค้น + ฟีดข่าวไทย 5 แหล่ง
            ├─ คัดกรอง → ตัดข่าวเก่ากว่า 45 วัน → รวมข่าวซ้ำ
            └─ RPC ingest_article() เขียนแบบ atomic ลง stories / articles
                 └─ เว็บอ่านผ่าน PostgREST ด้วย anon key (RLS: อ่านอย่างเดียว)
```

โค้ดที่ใช้ร่วมกันระหว่าง Node กับ Edge Function อยู่ที่ [supabase/functions/_shared/](supabase/functions/_shared/)
(`feeds.ts` คลังคำ/คำค้น, `filters.ts` ตัวจัดหมวด, `casualties.ts` สกัดจำนวนผู้เสียชีวิต/บาดเจ็บ,
`dedup.ts` รวมข่าวซ้ำ, `enrich.ts` รวมผลจาก regex/LLM, `pipeline.ts` ตรรกะกลาง)
ต่างกันแค่ชั้นอ่านฟีดกับชั้นเขียน DB เท่านั้น — `_shared/` ห้ามมี `Deno.*` หรือ `process.env`
(มี test บังคับที่ [tests/shared-portability.spec.ts](tests/shared-portability.spec.ts))

**หมายเหตุสำคัญ:** Google News RSS ตอบ **503 ทุก request จาก IP ของ Supabase** (ทดสอบแล้วทั้งแบบใส่/ไม่ใส่ User-Agent
และคำค้นภาษาอังกฤษ) บนคลาวด์จึงใช้ Bing News RSS เป็นหลัก ส่วน Google ยังใช้ได้เมื่อรันจากเครื่องตัวเอง
เปิดใช้บนคลาวด์ได้ด้วย `npx supabase secrets set ENABLE_GOOGLE_NEWS=1` ถ้าวันหนึ่ง Google เลิกบล็อก

## รันเว็บ

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
```

`.env.local` ต้องมี `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` และ `DATABASE_URL` (สำหรับสคริปต์ฝั่ง DB)

## คำสั่งดูแลระบบ

```bash
npx tsx scripts/status.ts                 # สถานะล่าสุด: จำนวนข่าว, ความครอบคลุมตัวเลข, run ล่าสุด, ตาราง cron
npm run ingest -- --dry-run               # ทดสอบตัวคัดกรอง + ตัวสกัดตัวเลข โดยไม่เขียน DB
npm run ingest                            # ดูดข่าวจากเครื่องตัวเอง (ใช้ Google + Bing + ฟีดตรง)
npm run ingest -- --seasonal              # เพิ่มคำค้นช่วงสงกรานต์/ปีใหม่
npm test                                  # ชุดทดสอบตัวสกัดตัวเลข (gold set ~130 เคส)
npm run test:accuracy                     # ตารางความแม่นแยกตาม stratum + เพดาน regression
npx tsx scripts/apply-migration.ts supabase/migrations/000X_xxx.sql
```

dev server **ไม่** ตั้ง cron ให้แล้ว (กันดูดซ้ำกับคลาวด์) ถ้าต้องการให้รันในเครื่อง ตั้ง `LOCAL_INGEST_CRON=1`

## การอ่านจำนวนผู้เสียชีวิต/บาดเจ็บ

ตัวสกัดอยู่ที่ [_shared/casualties.ts](supabase/functions/_shared/casualties.ts) อ่านจาก **พาดหัว + สรุปข่าว**
(และเนื้อข่าวถ้าเปิด `BODY_FETCH_ENABLED`) แล้วคืนค่าสามสถานะที่ต่างกันจริง:

| ค่า | ความหมาย |
|---|---|
| ตัวเลข | ข่าวระบุจำนวนนี้ |
| `0` | ข่าวบอกว่าไม่มีผู้เสียชีวิต/บาดเจ็บ |
| `null` | **ข่าวไม่ระบุ** — เว็บแสดง "ยังไม่ระบุจำนวน" และไม่ถูกนับเข้ายอดรวม |

ตัวเลขเก็บระดับ **article** แล้ว `recompute_story_casualties()` เลือกค่าของ story จากทุกสำนักข่าว
(หลักฐานแน่นสุด → สำนักข่าวอิสระเห็นตรงกันมากสุด → ล่าสุด) ทำงานตอน merge ด้วย ไม่ใช่แค่ตอนสร้าง story
ข่าวสรุปสถิติ (`7 วันอันตราย`, `ศปถ.`) ถูกติดธง `casualty_scope = 'aggregate'` และตัดออกจากยอดรวมทั้งหมด

```bash
npx tsx scripts/backfill-casualties.ts              # dry run: ดูว่าจะเปลี่ยนอะไรบ้าง
npx tsx scripts/backfill-casualties.ts --commit     # เขียนจริง (เคารพ casualties_locked)
npx tsx scripts/sample-casualty-cases.ts --bucket missed --limit 40   # สุ่มเคสมาเติม gold set
npx tsx scripts/refetch-bodies.ts --commit --max 200 # ดึงเนื้อข่าวเฉพาะที่ยังไม่มีตัวเลข (รันจากเครื่อง)
```

`scripts/backfill-facts.ts` ถูกปลดแล้ว — มันคำนวณจากพาดหัวอย่างเดียวและทับข้อมูลที่คนแก้มือ

### สกัดด้วย Claude (ยังไม่เปิด)

`EXTRACTOR_MODE` มีสามค่า: `off` (ค่าเริ่มต้น, regex ล้วน) · `shadow` (เรียก Claude เก็บผลไว้เทียบ
แต่ regex ยังเป็นตัวจริง) · `live` (Claude เป็นตัวจริงเมื่อผ่าน validation) regex เป็น fallback ถาวร —
คีย์หาย, rate limit, refusal, timeout ล้วน degrade กลับไปพฤติกรรมเดิม ไม่มีทางทำให้ run พัง

| ตัวแปร | ค่าเริ่มต้น |
|---|---|
| `ANTHROPIC_API_KEY` | ไม่ตั้ง → ปิด |
| `EXTRACTOR_MODE` | `off` |
| `ANTHROPIC_MODEL` | `claude-opus-5` |
| `LLM_MAX_CALLS_PER_RUN` | `25` |
| `LLM_DEADLINE_MS` | `60000` |
| `BODY_FETCH_ENABLED` | ตาม `CONFIG.BODY_FETCH_ENABLED` (ปิด) |

> ⚠️ **ห้ามเติม prefix `VITE_` ให้ `ANTHROPIC_API_KEY` เด็ดขาด** — `.env.local` ใช้ร่วมกับ Vite dev server
> และ Vite จะ inline ทุกตัวแปรที่ขึ้นต้นด้วย `VITE_` ลงใน bundle ของเบราว์เซอร์ ไม่มีอะไรฝั่ง browser
> ที่ควรเรียก Anthropic โดยตรง คีย์นี้ใช้เฉพาะฝั่ง server เท่านั้น
>
> คีย์ **ไม่** เก็บใน Supabase Vault — Vault มีไว้ให้ Postgres ประกอบ request ของ `pg_net`
> แต่ Postgres ไม่เคยคุยกับ Anthropic ตัว Edge Function ต่างหากที่คุย จึงใช้ function secret:
> `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`

ขั้นตอนก่อนสวิตช์เป็น `live`:

```bash
# 1. รัน shadow 5-7 วัน แล้วดูเคสที่ regex กับ Claude ไม่ตรงกัน
npx tsx scripts/compare-extractors.ts --since 7d --disagreements-only
# 2. ตัดสินแต่ละเคส → evals/gold.jsonl (กัน 30% เป็น test split)
npx tsx scripts/eval-extraction.ts --gold evals/gold.jsonl --split test
# 3. ผ่าน gate แล้วค่อย backfill ก่อน แล้วจึงเปิด live (สลับลำดับ = dedup พลาด story ซ้ำ)
```

หมายเหตุ: เนื้อข่าวถูกเก็บไว้ในหน่วยความจำระหว่าง run เท่านั้น ไม่เขียนลง DB
สิ่งเดียวที่เก็บคือ `articles.casualty_snippet` — ข้อความสั้นๆ ที่เป็นหลักฐานของตัวเลข

## Deploy ตัวดูดข่าวใหม่

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...
npx supabase functions deploy ingest --use-api --project-ref fhuwoswahypqpxnafemy
```

ตั้งค่าครั้งแรก (ทำไปแล้ว): `npx tsx scripts/setup-cron.ts` เก็บ `project_url` + `ingest_trigger_secret`
ลง Vault แล้วตั้ง job ใน `pg_cron` — ค่า secret ตัวเดียวกันต้องอยู่ใน Edge Function ด้วย
(`npx supabase secrets set INGEST_TRIGGER_SECRET=<hex>`)

ฟังก์ชันตั้ง `verify_jwt = false` โดยตั้งใจ เพราะ `verify_jwt` ยอมรับ anon key ซึ่งฝังอยู่ใน bundle ของเว็บอยู่แล้ว
จึงป้องกันด้วย header `x-ingest-secret` แทน — ยิงโดยไม่มี header ได้ 403

ทดสอบด้วยมือ (`?wait=1` = รอผลลัพธ์แทนที่จะตอบ 202 ทันที):

```bash
curl -X POST "https://fhuwoswahypqpxnafemy.supabase.co/functions/v1/ingest?wait=1" \
  -H "x-ingest-secret: <secret>"
```

## Migrations

| ไฟล์ | เนื้อหา |
|---|---|
| `0001_schema.sql` | ตาราง stories / articles + ดัชนี trigram |
| `0002_rls.sql` | RLS อ่านอย่างเดียวสำหรับ anon |
| `0003_grants.sql` | `GRANT SELECT` ให้ anon (RLS อย่างเดียวไม่พอ — PostgREST จะตอบ 42501) |
| `0004_find_candidates.sql` | ฟังก์ชันหาข่าวใกล้เคียงพร้อม threshold |
| `0005_ingest_rpc.sql` | `filter_new_urls`, `ingest_article` (atomic), ตาราง `ingest_runs`, `max_confidence` |
| `0006_cron.sql` | pg_cron ทุก 30 นาที + job กวาด run ที่ค้าง |
| `0007_service_role_grants.sql` | สิทธิ์ตารางให้ service_role (RLS ข้ามได้ แต่ table grant ไม่ข้าม) |
| `0008_ingest_dedup_fixes.sql` | นับสำนักข่าวแบบ case-insensitive + จับคู่ story ด้วย `norm_title` |
| `0009_source_identity.sql` | `source_key` / `title_key` / `aggregator` + สูตรนับเฉพาะสำนักข่าวอิสระ |
| `0010_ingest_reports_inserted.sql` | RPC บอกกลับว่าเขียนแถวจริงหรือไม่ (log จะได้ไม่รายงานเกินจริง) |
| `0011_article_casualties.sql` | ย้ายตัวเลขผู้เสียชีวิต/บาดเจ็บไปอยู่ระดับ article + provenance + `casualties_locked` |
| `0012_story_casualty_rollup.sql` | `recompute_story_casualties()`, `upsert_article_facts()`, `articles_pending_extraction()` |
| `0013_ingest_article_rollup.sql` | `ingest_article()` เรียก rollup ตอน merge ด้วย (เดิมตรึงตัวเลขไว้ตั้งแต่ story แรก) |

### การนับ "สำนักข่าว"

สำนักเดียวกันมาได้สองรูปแบบ — Bing ให้ hostname (`thebangkokinsight.com`) ส่วน Google ให้ชื่อแสดงผล
(`The Bangkok Insight`, `ข่าวสด`) [_shared/sources.ts](supabase/functions/_shared/sources.ts) จึงยุบทั้งสองแบบเป็น key เดียว
และติดธง `aggregator` ให้เว็บที่เผยแพร่ต่อ (msn, LINE Today, TrueID, sanook, kapook) ซึ่งไม่นับเป็นการยืนยันอิสระ

`source_count` = จำนวน `source_key` ที่ไม่ใช่ aggregator (อย่างน้อย 1) และ unique index
`(story_id, title_key)` กันไม่ให้ข่าวชิ้นเดียวถูกเก็บซ้ำเมื่อมาคนละ URL
