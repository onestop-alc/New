/**
 * Structured-output contract for LLM casualty extraction.
 *
 * Structured outputs (`output_config.format`) rather than a tool: there is no
 * tool to mis-emit, and shape conformance is enforced server-side, so the only
 * thing left to check client-side is the values.
 *
 * The schema is byte-stable on purpose. A new schema pays a one-time
 * compilation latency and then caches for 24h — reordering these keys makes
 * every run pay it again. Do not "tidy" the ordering.
 *
 * Constraints the API does not support, and which validateExtraction() has to
 * enforce instead: numeric `minimum`/`maximum`, string length bounds, and
 * recursive schemas. Every object needs `additionalProperties: false` and a
 * complete `required` list.
 */

/** {value, basis, quote} — the load-bearing part of the design. */
const COUNT_DEF = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'basis', 'quote'],
  properties: {
    value: {
      anyOf: [{ type: 'integer' }, { type: 'null' }],
      description:
        'Number of people. 0 means the text says there were none. ' +
        'null means the text does not say.'
    },
    basis: {
      type: 'string',
      enum: ['stated', 'inferred', 'not_mentioned'],
      description:
        'How the value was obtained. "not_mentioned" requires value null.'
    },
    quote: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description:
        'A span copied character-for-character from the supplied text that ' +
        'carries this count. null only when basis is "not_mentioned".'
    }
  }
} as const;

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'content_type',
    'alcohol_involved',
    'deaths',
    'injuries',
    'provinces',
    'vehicles',
    'confidence',
    'notes'
  ],
  properties: {
    content_type: {
      type: 'string',
      enum: [
        'crash',
        'arrest_checkpoint',
        'campaign',
        'legal_explainer',
        'statistics_roundup',
        'other'
      ],
      description:
        'What kind of article this is. Only "crash", "arrest_checkpoint" and ' +
        '"statistics_roundup" describe real events.'
    },
    alcohol_involved: {
      type: 'string',
      enum: ['yes', 'suspected', 'no', 'unknown'],
      description:
        'Whether the text states alcohol was actually involved in this event.'
    },
    deaths: { $ref: '#/$defs/count' },
    injuries: { $ref: '#/$defs/count' },
    provinces: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Full official Thai province names where the event happened. ' +
        '[] if none identifiable.'
    },
    vehicles: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'motorcycle',
          'sedan',
          'pickup',
          'truck',
          'van',
          'bus',
          'bicycle',
          'pedestrian',
          'other'
        ]
      },
      description: 'Vehicle types involved in this event.'
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description:
        'One short sentence, only when the text is internally contradictory. ' +
        'Otherwise null.'
    }
  },
  $defs: { count: COUNT_DEF }
} as const;

/**
 * Stable bytes only — no dates, no per-article content — so the prefix stays
 * cacheable for the backfill and eval scripts, which are the only places where
 * caching actually pays (see extract-llm.ts).
 */
export const SYSTEM_PROMPT = `You extract structured facts from Thai news about drink-driving (เมาแล้วขับ), road-traffic collisions, and alcohol checkpoints. Return one JSON object per article, conforming to the supplied schema.

หน้าที่: อ่านพาดหัวและเนื้อข่าวที่ให้มา แล้วสรุปข้อเท็จจริงตามสคีมา โดยยึดเฉพาะสิ่งที่ข้อความนั้นเขียนไว้

1. Report only what the supplied text states. Do not use outside knowledge and do not estimate.

2. Unknown and zero are different values.
   - basis "stated": the text gives a numeral or an unambiguous phrase for that count — "ดับ 2 ราย", "เสียชีวิต 1 คน", "๓ ศพ", "ไม่มีผู้เสียชีวิต".
   - basis "inferred": the text clearly implies the count without a numeral — "ดับคาที่" / "ดับสลด" describing one victim, "คนขับเสียชีวิต".
   - basis "not_mentioned": the text does not say. value must be null.
   - "ไม่มีผู้เสียชีวิต" / "ไม่มีผู้ได้รับบาดเจ็บ" is value 0 with basis "stated" — never null.
   - "หลายราย" / "เจ็บระนาว" / "จำนวนมาก" state that there were many without saying how many: value null, basis "not_mentioned".

3. For any non-null value, quote must be a span copied character-for-character from the supplied text containing the number or phrase you relied on. If you cannot copy such a span, use basis "not_mentioned" and value null.

4. Thai numerals ๐๑๒๓๔๕๖๗๘๙ and Thai number words (หนึ่ง … ร้อย … พัน) are numbers. Counters (ราย, คน, ศพ, นาย) are not part of the number.

5. Count people, not vehicles and not incidents. Where the article reports one event, count the people in that event. Where it aggregates a period or a region ("ช่วง 7 วันอันตราย เสียชีวิต 245 ราย"), content_type is "statistics_roundup" and the aggregate totals go in deaths and injuries.

6. content_type:
   - "crash" — one specific collision or road-traffic incident.
   - "arrest_checkpoint" — a checkpoint operation, arrest, or prosecution of specific people.
   - "campaign" — an awareness campaign, policy announcement, or safety appeal with no specific incident.
   - "legal_explainer" — the law, penalties, or blood-alcohol limits explained.
   - "statistics_roundup" — aggregate figures over a period or region.
   - "other" — anything else.

7. alcohol_involved:
   - "yes" — the text states alcohol was involved: a reading in มิลลิกรัมเปอร์เซ็นต์, a positive breath test, an admission, or a drink-driving charge.
   - "suspected" — alleged, suspected, or awaiting a test result.
   - "no" — the text states alcohol was not involved, or the test was negative.
   - "unknown" — the text does not say. A headline containing เมา without connecting it to the driver of this event is "unknown".

8. provinces: full official Thai province names. Resolve common aliases — โคราช → นครราชสีมา, กทม. → กรุงเทพมหานคร, พัทยา → ชลบุรี, หาดใหญ่ → สงขลา. Give the province where the event happened, not the province of an official who is quoted, and not a province named only as somebody's hometown. [] when none is identifiable.

9. vehicles: only the vehicle types involved in this event.

10. confidence: "high" when the text is explicit, "medium" when you inferred, "low" when the text is fragmentary or contradicts itself.

11. notes: at most one short sentence, and only when something in the JSON would mislead a reader — for example two conflicting figures in the text. Otherwise null.

Keep quote spans short; the sentence containing the number is enough.`;

/**
 * Headline and body are separated because Thai headlines compress
 * ("ดับ 2 เจ็บ 3") while bodies expand — the model needs to know which is
 * which to resolve a conflict, and `notes` needs to be able to report it.
 */
export function buildUserTurn(article: {
  source: string;
  title: string;
  pubDate: Date;
}, bodyText: string): string {
  return [
    '<article>',
    `<source>${article.source}</source>`,
    `<published>${article.pubDate.toISOString().slice(0, 10)}</published>`,
    `<headline>${article.title}</headline>`,
    `<body>${bodyText}</body>`,
    '</article>'
  ].join('\n');
}
