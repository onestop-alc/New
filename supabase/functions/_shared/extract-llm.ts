/**
 * Claude-backed casualty extraction.
 *
 * Every SDK touchpoint is confined to callClaude() below, so swapping the SDK
 * for a raw fetch to /v1/messages is a single-function change.
 *
 * Runtime-agnostic: the bare `@anthropic-ai/sdk` specifier resolves under Node
 * from package.json and under Deno from supabase/functions/ingest/deno.json —
 * the same pattern store-supabase.ts already uses for @supabase/supabase-js.
 * Keep the two version pins identical.
 *
 * No env access here. Both entrypoints read the config and inject it, which is
 * what keeps `npm run lint` green over this file (tsconfig type-checks _shared
 * with Node types, so a Deno global would fail).
 */
import Anthropic from '@anthropic-ai/sdk';
import { PROVINCES } from './feeds.ts';
import { EXTRACTION_SCHEMA, SYSTEM_PROMPT, buildUserTurn } from './extract-schema.ts';
import type {
  ExtractorMode,
  FactExtractor,
  LlmExtraction
} from './enrich.ts';
import type { ArticleInput } from './pipeline.ts';

export interface LlmConfig {
  /** Empty disables the extractor entirely. */
  apiKey: string;
  mode: ExtractorMode;
  model: string;
  maxCalls: number;
  deadlineMs: number;
  timeoutMs: number;
  maxRetries: number;
}

export const LLM_DEFAULTS = {
  /**
   * The project default. Casualty counts land on a public health dashboard, so
   * the default is the capable model rather than the cheap one; ANTHROPIC_MODEL
   * can point at claude-sonnet-5 or claude-haiku-4-5 once the eval in
   * scripts/eval-extraction.ts shows the cheaper tier clears the ship gate.
   */
  model: 'claude-opus-5',
  maxCalls: 25,
  deadlineMs: 60_000,
  timeoutMs: 15_000,
  /** Worst case per call is timeout x (maxRetries + 1) plus backoff. */
  maxRetries: 1
} as const;

const VALID_PROVINCES = new Set(PROVINCES);

/** Structured outputs cannot express these — so they are checked here. */
const MAX_PLAUSIBLE_COUNT = 500;

export function validateExtraction(raw: unknown, sentText: string): LlmExtraction | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as LlmExtraction;

  for (const key of ['deaths', 'injuries'] as const) {
    const count = candidate[key];
    if (!count || typeof count !== 'object') return null;

    if (count.basis === 'not_mentioned') {
      if (count.value !== null) return null;
      continue;
    }
    if (count.value === null) continue;

    if (!Number.isInteger(count.value)) return null;
    if (count.value < 0 || count.value > MAX_PLAUSIBLE_COUNT) return null;

    // The hallucination gate. A fabricated figure would need a fabricated quote
    // that happens to be a literal substring of the text we sent.
    if (count.basis === 'stated' && (!count.quote || !sentText.includes(count.quote))) {
      return null;
    }
  }

  if (!Array.isArray(candidate.provinces)) return null;
  candidate.provinces = candidate.provinces.filter(p => VALID_PROVINCES.has(p));
  if (!Array.isArray(candidate.vehicles)) candidate.vehicles = [];

  return candidate;
}

/** Returns null when the extractor is not configured — never throws. */
export function createLlmExtractor(config: Partial<LlmConfig>): FactExtractor | null {
  const mode = config.mode ?? 'off';
  if (!config.apiKey || mode === 'off') return null;

  const model = config.model || LLM_DEFAULTS.model;
  const timeoutMs = config.timeoutMs ?? LLM_DEFAULTS.timeoutMs;
  const maxRetries = config.maxRetries ?? LLM_DEFAULTS.maxRetries;

  const client = new Anthropic({ apiKey: config.apiKey, maxRetries });

  return {
    mode,
    model,
    maxCalls: config.maxCalls ?? LLM_DEFAULTS.maxCalls,
    deadlineMs: config.deadlineMs ?? LLM_DEFAULTS.deadlineMs,

    async extract(article, bodyText) {
      const userTurn = buildUserTurn(article, bodyText);
      const raw = await callClaude(client, model, userTurn, timeoutMs);
      if (raw === null) return null;
      // Validate against the exact bytes we sent, so the quote check means
      // something.
      return validateExtraction(raw, userTurn);
    }
  };
}

/**
 * The only place the SDK is touched.
 *
 * Returns null for every outcome the caller should treat as "keep the regex
 * reading"; throws only for genuinely unexpected failures, which enrich.ts
 * counts and feeds into its circuit breaker.
 */
async function callClaude(
  client: Anthropic,
  model: string,
  userTurn: string,
  timeoutMs: number
): Promise<unknown | null> {
  let response;
  try {
    response = await client.beta.messages.create(
      {
        model,
        max_tokens: 2048,
        system: [{ type: 'text', text: SYSTEM_PROMPT }],
        output_config: {
          // Structured extraction: low effort is ample, and it is the cheap
          // lever. Do NOT disable thinking instead — on this model a disabled
          // thinking path can emit a tool call as plain text and leak
          // <thinking> tags into the output.
          effort: 'low',
          format: { type: 'json_schema', schema: EXTRACTION_SCHEMA }
        },
        // Safety classifiers can decline a benign road-safety article. This
        // re-runs the request server-side on Anthropic's recommended fallback
        // instead of handing us a refusal.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages: [{ role: 'user', content: userTurn }]
      } as Parameters<typeof client.beta.messages.create>[0],
      { timeout: timeoutMs }
    );
  } catch (err) {
    // APIConnectionError is a subclass of APIError in the TS SDK, so it has to
    // be checked first.
    if (err instanceof Anthropic.APIConnectionError) return null;
    if (err instanceof Anthropic.RateLimitError) return null;
    if (err instanceof Anthropic.APIError) return null;
    throw err;
  }

  // Check stop_reason before reading content: a refusal carries no usable
  // content, and a truncated response carries invalid JSON.
  if (response.stop_reason === 'refusal') return null;
  if (response.stop_reason === 'max_tokens') {
    console.error('LLM extraction truncated at max_tokens; raise max_tokens');
    return null;
  }

  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map(block => block.text)
    .join('');
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
