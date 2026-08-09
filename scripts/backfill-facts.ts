/**
 * Recomputes deaths / injuries / provinces for stories already in the table,
 * using the current extractors. Run after changing the heuristics in dedup.ts:
 *   npx tsx scripts/backfill-facts.ts
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import {
  extractDeaths,
  extractInjuries,
  extractProvinces
} from '../supabase/functions/_shared/dedup.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

await client.connect();

const { rows } = await client.query<{
  id: string;
  display_title: string;
  deaths: number | null;
  injuries: number | null;
  provinces: string[] | null;
}>('SELECT id, display_title, deaths, injuries, provinces FROM stories');

let updated = 0;
for (const story of rows) {
  const deaths = extractDeaths(story.display_title);
  const injuries = extractInjuries(story.display_title);
  const provinces = extractProvinces(story.display_title);

  const same =
    deaths === story.deaths &&
    injuries === story.injuries &&
    JSON.stringify(provinces) === JSON.stringify(story.provinces ?? []);
  if (same) continue;

  await client.query(
    'UPDATE stories SET deaths = $1, injuries = $2, provinces = $3::text[] WHERE id = $4',
    [deaths, injuries, provinces, story.id]
  );
  updated++;
}

console.log(`Backfilled ${updated} of ${rows.length} stories.`);
await client.end();
