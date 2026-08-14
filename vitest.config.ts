import path from 'path';
import { defineConfig } from 'vitest/config';

/**
 * Standalone config: vitest would otherwise load vite.config.ts and pull in the
 * React and Tailwind plugins, which nothing under tests/ needs.
 *
 * Vite resolves the Deno-style `./feeds.ts` import specifiers used throughout
 * supabase/functions/_shared as-is, so no loader shim is required.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    globals: false,
    // src/lib/supabase.ts throws at import when these are unset, and the pure
    // casualty helpers in src/lib/api.ts sit in the same module graph. Values
    // are placeholders — nothing under tests/ makes a network call.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key'
    }
  }
});
