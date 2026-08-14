/**
 * RETIRED — replaced by scripts/backfill-casualties.ts.
 *
 * This script recomputed deaths/injuries/provinces from stories.display_title
 * alone and wrote them back unconditionally. Both halves are now wrong:
 *
 *  - Headline-only extraction is the bug the rewrite exists to fix. The figure
 *    is frequently only in the summary or the body, especially when the
 *    aggregator truncated the headline.
 *  - The unconditional overwrite reverted every manual correction, because it
 *    predates stories.casualties_locked.
 *
 * The replacement re-reads at the article level, honours casualties_locked, and
 * derives the story figure from every member article via
 * recompute_story_casualties().
 */
console.error(
  'scripts/backfill-facts.ts is retired — it reverts manual corrections and\n' +
  'extracts from headlines only.\n\n' +
  'Use instead:\n' +
  '  npx tsx scripts/backfill-casualties.ts            # dry run\n' +
  '  npx tsx scripts/backfill-casualties.ts --commit\n'
);
process.exit(1);
