/**
 * Companion to 0009_source_identity.sql:
 *   1. fills source_key / title_key / aggregator on existing articles
 *   2. deletes duplicate rows (same story, same normalised headline)
 *   3. recomputes source_count and the published window from what remains
 *   4. creates the unique index that duplicates would have blocked
 *
 *   npx tsx scripts/backfill-sources.ts
 *
 * Safe to re-run.
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import { canonicalSource } from '../supabase/functions/_shared/sources.ts';
import { normalizeForMatch } from '../supabase/functions/_shared/filters.ts';

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
try {
  await client.query('BEGIN');

  const { rows: articles } = await client.query<{ id: string; source: string; title: string }>(
    'SELECT id, source, title FROM articles'
  );

  for (const article of articles) {
    const outlet = canonicalSource(article.source);
    await client.query(
      'UPDATE articles SET source_key = $1, aggregator = $2, title_key = $3 WHERE id = $4',
      [outlet.key, outlet.aggregator, normalizeForMatch(article.title), article.id]
    );
  }
  console.log(`keyed ${articles.length} articles`);

  const duplicates = await client.query(`
    DELETE FROM articles a
     USING articles b
     WHERE a.story_id = b.story_id
       AND a.title_key = b.title_key
       AND a.id > b.id`);
  console.log(`removed ${duplicates.rowCount} duplicate article rows`);

  const orphans = await client.query(`
    DELETE FROM stories s
     WHERE NOT EXISTS (SELECT 1 FROM articles a WHERE a.story_id = s.id)`);
  console.log(`removed ${orphans.rowCount} orphan stories`);

  await client.query(`
    UPDATE stories s
       SET source_count = greatest(
             (select count(distinct a.source_key) from articles a
               where a.story_id = s.id and not a.aggregator), 1),
           first_published = coalesce(
             (select min(a.published) from articles a where a.story_id = s.id),
             s.first_published),
           last_published = coalesce(
             (select max(a.published) from articles a where a.story_id = s.id),
             s.last_published),
           max_confidence = coalesce(
             (select case when bool_or(a.confidence = 'high') then 'high' else 'medium' end
                from articles a where a.story_id = s.id),
             s.max_confidence)`);
  console.log('recomputed source_count / published window / confidence');

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS articles_story_title_key_uniq
      ON articles (story_id, title_key)`);
  console.log('unique index articles_story_title_key_uniq is in place');

  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  console.error('backfill failed, rolled back:', err);
  process.exitCode = 1;
} finally {
  await client.end();
}
