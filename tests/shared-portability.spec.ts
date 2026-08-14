import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * supabase/functions/_shared is compiled twice: by `tsc --noEmit` with Node
 * types (tsconfig.json excludes only supabase/functions/ingest, not _shared) and
 * by Deno at `supabase functions deploy`. A runtime-specific global slips
 * through local development and only fails at deploy time, so it is worth
 * twenty lines to catch it here.
 */
const SHARED_DIR = path.resolve(__dirname, '../supabase/functions/_shared');

/**
 * Comments are stripped before scanning: several of these files legitimately
 * *document* why `Deno.env.get` and `process.env` are kept out, and the guard
 * must check the code rather than the prose explaining the rule.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FILES = readdirSync(SHARED_DIR)
  .filter(name => name.endsWith('.ts'))
  .map(name => ({
    name,
    source: stripComments(readFileSync(path.join(SHARED_DIR, name), 'utf8'))
  }));

describe('_shared stays runtime-agnostic', () => {
  it('has files to check', () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  for (const { name, source } of FILES) {
    describe(name, () => {
      it('does not use Deno globals', () => {
        expect(source).not.toMatch(/\bDeno\s*\./);
        expect(source).not.toMatch(/\bEdgeRuntime\b/);
      });

      it('does not use Node globals or CommonJS', () => {
        expect(source).not.toMatch(/\bprocess\s*\.\s*env\b/);
        expect(source).not.toMatch(/\brequire\s*\(/);
        expect(source).not.toMatch(/\b__dirname\b/);
        expect(source).not.toMatch(/from\s+['"]node:/);
      });

      it('gives every relative import an explicit .ts extension', () => {
        const specifiers = [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map(m => m[1]);
        for (const specifier of specifiers) {
          expect(specifier, `${name} imports ${specifier}`).toMatch(/\.ts$/);
        }
      });
    });
  }
});
