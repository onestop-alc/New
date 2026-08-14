/**
 * One place where the environment is turned into pipeline dependencies.
 *
 * The env reader is injected rather than read here: `Deno.env.get` and
 * `process.env` are runtime globals, and tsconfig.json type-checks this
 * directory with Node types while Deno type-checks it at deploy time. Keeping
 * both globals out of _shared/ is what lets the same file serve both.
 */
import { CONFIG } from './feeds.ts';
import { createBodyFetcher, type BodyFetcher } from './article-text.ts';
import { createLlmExtractor, LLM_DEFAULTS } from './extract-llm.ts';
import type { ExtractorMode, FactExtractor } from './enrich.ts';

export type EnvReader = (key: string) => string | undefined;

export interface IngestExtras {
  fetchBody?: BodyFetcher;
  extractor: FactExtractor | null;
}

function num(env: EnvReader, key: string, fallback: number): number {
  const raw = env(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(env: EnvReader, key: string, fallback: boolean): boolean {
  const raw = env(key);
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

const MODES: ExtractorMode[] = ['off', 'shadow', 'live'];

function readMode(env: EnvReader): ExtractorMode {
  const raw = (env('EXTRACTOR_MODE') ?? 'off').toLowerCase() as ExtractorMode;
  return MODES.includes(raw) ? raw : 'off';
}

/**
 * Both are opt-in and both degrade to today's behaviour when unset: a missing
 * key or EXTRACTOR_MODE=off logs one line and takes the regex path, so a
 * rotated or expired key can never take ingestion down.
 */
export function buildIngestExtras(env: EnvReader): IngestExtras {
  const bodyEnabled = flag(env, 'BODY_FETCH_ENABLED', CONFIG.BODY_FETCH_ENABLED);
  const fetchBody = bodyEnabled
    ? createBodyFetcher({
        timeoutMs: num(env, 'BODY_FETCH_TIMEOUT_MS', CONFIG.BODY_FETCH_TIMEOUT_MS),
        maxChars: num(env, 'MAX_BODY_LENGTH', CONFIG.MAX_BODY_LENGTH),
        maxBytes: CONFIG.BODY_FETCH_MAX_BYTES,
        hostDelayMs: CONFIG.BODY_FETCH_HOST_DELAY_MS
      })
    : undefined;

  const mode = readMode(env);
  const apiKey = env('ANTHROPIC_API_KEY') ?? '';
  const extractor = createLlmExtractor({
    apiKey,
    mode,
    model: env('ANTHROPIC_MODEL') || LLM_DEFAULTS.model,
    maxCalls: num(env, 'LLM_MAX_CALLS_PER_RUN', LLM_DEFAULTS.maxCalls),
    deadlineMs: num(env, 'LLM_DEADLINE_MS', LLM_DEFAULTS.deadlineMs)
  });

  if (mode !== 'off' && !apiKey) {
    console.log(`EXTRACTOR_MODE=${mode} but ANTHROPIC_API_KEY is unset — using regex only.`);
  } else if (extractor) {
    console.log(`LLM extraction enabled: mode=${extractor.mode} model=${extractor.model}`);
  }

  return { fetchBody, extractor };
}
