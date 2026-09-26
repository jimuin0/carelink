/**
 * @jest-environment node
 */
import type { NextRequest } from 'next/server';
import { GET } from '../route';
import { buildOgImageSvg, OG_IMAGE_HEADERS, renderOgImagePng } from '@/lib/og-image';

describe('CareLink OGP image rendering', () => {
  test('defaults produce a valid 1200x630 SVG without facility rating content', () => {
    const svg = buildOgImageSvg(new URLSearchParams());

    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain('>CareLink</text>');
    expect(svg).toContain('ネットでかんたんサロン予約');
    expect(svg).toContain('carelink-jp.com');
    expect(svg).not.toContain('施設情報');
    expect(svg).not.toContain('aria-label="評価');
  });

  test('escapes untrusted text and keeps valid Unicode while dropping XML-invalid controls', () => {
    const svg = buildOgImageSvg(new URLSearchParams({
      title: `<&"'>😀\u0001`,
      subtitle: 'サロン\t予約 😀',
      rating: '4.5',
      reviews: '10',
    }));

    expect(svg).toContain('&lt;&amp;&quot;&apos;&gt;😀');
    expect(svg).not.toContain('\u0001');
    expect(svg).toContain('サロン 予約 😀');
    expect(svg).toContain('施設情報');
    expect(svg).toContain('評価 4.5');
    expect(svg).toContain('(10件)');
    expect(svg).not.toContain('fill="#d1d5db"');
  });

  test('empty text falls back, and long titles/subtitles are clipped on code point boundaries', () => {
    const svg = buildOgImageSvg(new URLSearchParams({
      title: `${'あ'.repeat(39)}😀`,
      subtitle: ' '.repeat(2) + '予約'.repeat(40),
      rating: '3.0',
      reviews: '0',
    }));

    expect(svg).toContain(`<text x="72" y="268" font-size="56" font-weight="700" fill="#0f172a">${'あ'.repeat(20)}</text>`);
    expect(svg).toContain(`<text x="72" y="332" font-size="56" font-weight="700" fill="#0f172a">${'あ'.repeat(19)}😀</text>`);
    expect(svg).toContain(`${'予約'.repeat(30)}`);
    expect(svg).not.toContain('予約'.repeat(31));
    expect(svg).toContain('(0件)');
    expect(svg).toContain('評価 3.0');
  });

  test.each([
    ['Infinity', null],
    ['10', '5.0'],
    ['-1', '0.0'],
    ['', null],
  ])('rating input %s is safely parsed and clamped', (rating, expectedDisplay) => {
    const svg = buildOgImageSvg(new URLSearchParams({ rating }));

    if (expectedDisplay === null) {
      expect(svg).not.toContain('aria-label="評価');
    } else {
      expect(svg).toContain(`aria-label="評価 ${expectedDisplay}"`);
    }
    if (rating) expect(svg).toContain('施設情報');
    else expect(svg).not.toContain('施設情報');
  });

  test('invalid review counts are omitted instead of being rendered as markup', () => {
    const svg = buildOgImageSvg(new URLSearchParams({ rating: '2.5', reviews: '<svg>' }));

    expect(svg).toContain('評価 2.5');
    expect(svg).not.toContain('&lt;svg&gt;');
    expect(svg).not.toContain('件)</text>');
  });

  test('rasterizes PNG bytes for the public route and preserves cache/content-type headers', async () => {
    const image = await renderOgImagePng(new URLSearchParams({ title: 'テスト施設', rating: '4.5' }));
    expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const request = {
      nextUrl: new URL('https://carelink-jp.com/api/og?title=%E3%83%86%E3%82%B9%E3%83%88%E6%96%BD%E8%A8%AD'),
    } as unknown as NextRequest;
    const response = await GET(request);
    const responseBytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(OG_IMAGE_HEADERS['Content-Type']);
    expect(response.headers.get('Cache-Control')).toBe(OG_IMAGE_HEADERS['Cache-Control']);
    expect([...responseBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
