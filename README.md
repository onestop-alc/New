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
(`feeds.ts` คลังคำ/คำค้น, `filters.ts` ตัวจัดหมวด, `dedup.ts` รวมข่าวซ้ำ, `pipeline.ts` ตรรกะกลาง)
ต่างกันแค่ชั้นอ่านฟีดกับชั้นเขียน DB เท่านั้น

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
npx tsx scripts/status.ts                 # สถานะล่าสุด: จำนวนข่าว, run ล่าสุด, ตาราง cron
npm run ingest -- --dry-run               # ทดสอบตัวคัดกรองโดยไม่เขียน DB
npm run ingest                            # ดูดข่าวจากเครื่องตัวเอง (ใช้ Google + Bing + ฟีดตรง)
npm run ingest -- --seasonal              # เพิ่มคำค้นช่วงสงกรานต์/ปีใหม่
npx tsx scripts/apply-migration.ts supabase/migrations/000X_xxx.sql
npx tsx scripts/backfill-facts.ts         # คำนวณ ผู้เสียชีวิต/บาดเจ็บ/จังหวัด ใหม่จากพาดหัวเดิม
```

dev server **ไม่** ตั้ง cron ให้แล้ว (กันดูดซ้ำกับคลาวด์) ถ้าต้องการให้รันในเครื่อง ตั้ง `LOCAL_INGEST_CRON=1`

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
