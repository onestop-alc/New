# ระบบรวมข่าว "เมาแล้วขับ"

เว็บแอป React + Vite อ่านข้อมูลข่าวจาก Supabase โดยตรง (ตาราง `stories`, `articles`)

## 1) ตั้งค่า

ไฟล์ [.env.local](.env.local) ตั้งค่าไว้แล้ว:

```
VITE_SUPABASE_URL=https://fhuwoswahypqpxnafemy.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

## 2) เปิดสิทธิ์อ่านให้ anon (ต้องทำครั้งเดียว)

ตอนนี้ Supabase ยัง **ไม่อนุญาต** ให้ key anon อ่านตาราง (error `42501 permission denied`)
เปิด Supabase Dashboard → SQL Editor แล้วรันไฟล์ [supabase/migrations/0003_grants.sql](supabase/migrations/0003_grants.sql)

## 3) รัน

```bash
npm install
npm run dev     # http://localhost:3000
```

build/production:

```bash
npm run build && npm start
```

## 4) (ทางเลือก) เปิดระบบดูดข่าวอัตโนมัติ

ตัวดูด RSS (`src/backend/ingest`) เขียนลง DB จึงต้องต่อ Postgres โดยตรง — เพิ่ม `DATABASE_URL`
(Supabase Dashboard → Project Settings → Database → Connection string URI) ลงใน `.env.local`
แล้วรัน `npm run dev` ใหม่ ระบบจะดูดข่าวทันทีและทุก 30 นาที
ถ้าไม่ใส่ แอปจะยังทำงานปกติแต่แสดงเฉพาะข้อมูลที่มีอยู่ใน DB แล้ว
