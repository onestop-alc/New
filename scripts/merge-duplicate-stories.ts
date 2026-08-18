/**
 * Retroactively merges stories that describe the same crash.
 *
 *   npx tsx scripts/merge-duplicate-stories.ts             # dry run (default)
 *   npx tsx scripts/merge-duplicate-stories.ts --commit
 *
 * Dedup runs only at ingest time, so stories created before the dedup rules
 * improved stay split — one BMW/tuk-tuk crash is sixteen rows and its three
 * deaths are summed sixteen times on the dashboard. This groups existing
 * stories with the SAME isSameStory() the pipeline uses, then folds each group
 * into its oldest member.
 *
 * DESTRUCTIVE. Each group is merged in its own transaction: child articles are
 * reassigned to the parent, duplicate child stories are deleted, and the parent
 * is recomputed. Always read the --dry-run grouping before --commit — a bad
 * grouping would fuse two genuinely different crashes.
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import { isSameStory, type SameStoryInput } from '../supabase/functions/_shared/dedup.ts';
import { extractEntities, entityScore } from '../supabase/functions/_shared/entities.ts';
import { CONFIG } from '../supabase/functions/_shared/feeds.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const commit = process.argv.includes('--commit');

interface StoryRow {
  id: string;
  display_title: string;
  provinces: string[] | null;
  deaths: number | null;
  injuries: number | null;
  first_published: Date;
  last_published: Date;
}

interface Node extends SameStoryInput {
  id: string;
  first: Date;
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await client.connect();

const { rows } = await client.query<StoryRow>(
  `select id, display_title, provinces, deaths, injuries, first_published, last_published
     from stories order by first_published`
);

const nodes: Node[] = rows.map(r => ({
  id: r.id,
  title: r.display_title,
  provinces: r.provinces ?? [],
  deaths: r.deaths,
  injuries: r.injuries,
  published: r.last_published,
  first: r.first_published
}));

// Mirror the SQL candidate filter so this never merges a pair the live pipeline
// would never have been shown as a candidate in the first place.
const windowMs = CONFIG.DEDUP_FOLLOWUP_WINDOW_DAYS * 86_400_000;
const inWindow = (a: Node, b: Node) =>
  Math.abs(a.published!.getTime() - b.published!.getTime()) <= windowMs;

// Greedy single-link clustering — the same shape as findMatchingStory(), which
// attaches an article to the first candidate story that matches.
const clusters: Node[][] = [];
for (const node of nodes) {
  const hit = clusters.find(c => c.some(m => inWindow(m, node) && isSameStory(m, node)));
  if (hit) hit.push(node);
  else clusters.push([node]);
}

const toMerge = clusters
  .filter(c => c.length > 1)
  // Oldest story is the parent; children fold into it.
  .map(c => [...c].sort((a, b) => a.first.getTime() - b.first.getTime()))
  .sort((a, b) => b.length - a.length);

console.log(
  `${nodes.length} stories -> ${clusters.length} clusters · ` +
  `${toMerge.length} groups to merge${commit ? '' : ' (dry run)'}\n`
);

for (const group of toMerge) {
  const [parent, ...children] = group;
  console.log(`parent ${parent.id} (+${children.length})  deaths=${parent.deaths ?? '?'}`);
  for (const n of group) {
    console.log(`   ${n.id === parent.id ? '*' : ' '} ${n.id.padStart(4)} ${n.title.slice(0, 64)}`);
    // Why this member joined: without it a dry run shows a grouping but no
    // grounds for it, and a wrong group is the one failure worth catching by
    // eye before --commit.
    if (n.id !== parent.id) {
      const overlap = entityScore(extractEntities(parent), extractEntities(n));
      console.log(`        shared: ${overlap.shared.join(' ') || '(text similarity only)'}`);
    }
  }
  console.log('');
}

if (!commit) {
  const removed = toMerge.reduce((sum, g) => sum + g.length - 1, 0);
  console.log(`Dry run — nothing written. --commit would remove ${removed} duplicate stories.`);
  await client.end();
  process.exit(0);
}

let merged = 0;
let reassigned = 0;
let deletedDupArticles = 0;

for (const group of toMerge) {
  const [parent, ...children] = group;
  const parentId = parent.id;
  const childIds = children.map(c => c.id);

  try {
    await client.query('BEGIN');

    // Reassign child articles to the parent, but skip any whose (story_id,
    // title_key) would collide — that article is the same report already on the
    // parent, so it is a duplicate to drop, not to move.
    const moved = await client.query(
      `update articles a
          set story_id = $1
        where a.story_id = any($2::bigint[])
          and not exists (
            select 1 from articles p
             where p.story_id = $1 and p.title_key = a.title_key
          )`,
      [parentId, childIds]
    );
    reassigned += moved.rowCount ?? 0;

    // Whatever still points at a child is a title_key duplicate of a parent
    // article. Delete it, then the now-empty child stories.
    const dropped = await client.query(
      `delete from articles where story_id = any($1::bigint[])`,
      [childIds]
    );
    deletedDupArticles += dropped.rowCount ?? 0;

    await client.query(`delete from stories where id = any($1::bigint[])`, [childIds]);

    // Rebuild the parent's derived fields from its full membership. Mirrors the
    // source_count / published-window logic in ingest_article() (0013).
    await client.query(
      `update stories s set
         source_count = greatest(
           (select count(distinct a.source_key)
              from articles a where a.story_id = s.id and not a.aggregator), 1),
         first_published = coalesce(
           (select min(a.published) from articles a where a.story_id = s.id), s.first_published),
         last_published = coalesce(
           (select max(a.published) from articles a where a.story_id = s.id), s.last_published),
         max_confidence = case
           when exists (select 1 from articles a
                          where a.story_id = s.id and a.confidence = 'high')
             then 'high' else 'medium' end
       where s.id = $1`,
      [parentId]
    );

    // deaths / injuries / provinces / content_type come from the rollup, which
    // also honours casualties_locked.
    await client.query('SELECT recompute_story_casualties($1)', [parentId]);

    await client.query('COMMIT');
    merged++;
    process.stdout.write(`\rmerged ${merged}/${toMerge.length} groups`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\nFailed to merge group parent=${parentId}:`, err);
  }
}

console.log(
  `\n\ndone: ${merged} groups merged · ${reassigned} articles reassigned · ` +
  `${deletedDupArticles} duplicate articles removed`
);

await client.end();
