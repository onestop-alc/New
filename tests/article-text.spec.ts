import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  extractBodyText,
  stripHtml
} from '../supabase/functions/_shared/article-text.ts';
import { readCasualties } from '../supabase/functions/_shared/casualties.ts';

const LEDE =
  'เจ้าหน้าที่กู้ภัยรายงานว่ารถเก๋งคันดังกล่าวพุ่งชนรถจักรยานยนต์อย่างแรง ' +
  'ก่อนเสียหลักตกข้างทาง ผู้เสียชีวิต 2 ราย บาดเจ็บ 1 ราย นำส่งโรงพยาบาลประจำจังหวัดทันที ' +
  'ผลตรวจแอลกอฮอล์คนขับอยู่ที่ 180 มิลลิกรัมเปอร์เซ็นต์ เกินกว่าที่กฎหมายกำหนด';

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a&nbsp;b&amp;c&#39;d&hellip;')).toBe('a b&c\'d…');
  });

  it('leaves an unknown entity alone rather than mangling it', () => {
    expect(decodeEntities('&zzz;')).toBe('&zzz;');
  });
});

describe('stripHtml', () => {
  it('drops script and style content entirely', () => {
    const html = '<p>ดับ 2 ราย</p><script>var x = "ดับ 99 ราย";</script>';
    expect(stripHtml(html, 200)).toBe('ดับ 2 ราย');
  });

  it('collapses whitespace and honours the length cap', () => {
    expect(stripHtml('<p>a</p>\n\n   <p>b</p>', 3)).toBe('a b');
  });
});

describe('extractBodyText', () => {
  it('prefers JSON-LD articleBody', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      ${JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', articleBody: LEDE })}
      </script>
      <meta property="og:description" content="สรุปสั้นที่ไม่มีตัวเลข" />
    </head><body><p>${LEDE}</p></body></html>`;

    const result = extractBodyText(html, 2500);
    expect(result?.via).toBe('jsonld');
    expect(result!.text).toContain('ผู้เสียชีวิต 2 ราย');
  });

  it('walks an @graph wrapper', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@graph': [{ '@type': 'WebPage' }, { '@type': 'Article', articleBody: LEDE }]
    })}</script>`;
    expect(extractBodyText(html, 2500)?.via).toBe('jsonld');
  });

  it('falls back to article paragraphs when there is no JSON-LD', () => {
    const html = `<article>
      <figure><figcaption>ภาพจากผู้เห็นเหตุการณ์ ดับ 99 ราย</figcaption></figure>
      <p>${LEDE}</p>
    </article>`;
    const result = extractBodyText(html, 2500);
    expect(result?.via).toBe('paragraphs');
    // The caption is inside <figure> and must not reach the extractor.
    expect(result!.text).not.toContain('99');
  });

  it('falls back to og:description last', () => {
    const html = `<head><meta property="og:description" content="${LEDE}" /></head>`;
    expect(extractBodyText(html, 2500)?.via).toBe('og');
  });

  it('returns null when the page carries nothing usable', () => {
    expect(extractBodyText('<html><body><p>สั้นมาก</p></body></html>', 2500)).toBeNull();
  });

  it('ignores malformed JSON-LD instead of throwing', () => {
    const html = `<script type="application/ld+json">{ not json </script>
      <head><meta name="description" content="${LEDE}" /></head>`;
    expect(() => extractBodyText(html, 2500)).not.toThrow();
    expect(extractBodyText(html, 2500)?.via).toBe('og');
  });

  it('feeds the extractor a body it can read a toll out of', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'NewsArticle', articleBody: LEDE
    })}</script>`;
    const body = extractBodyText(html, 2500)!;
    const reading = readCasualties({
      title: 'หนุ่มเมาขับซิ่งเก๋งชนกลางดึก',
      summary: '',
      body: body.text
    });
    expect({ deaths: reading.deaths.value, injuries: reading.injuries.value })
      .toEqual({ deaths: 2, injuries: 1 });
    expect(reading.deaths.field).toBe('body');
  });
});
