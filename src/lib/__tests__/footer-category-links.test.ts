import '@testing-library/jest-dom';
import { renderFooterCategoryLinks, FOOTER_CATEGORY_LINKS_HTML } from '../footer-category-links';
import { businessTypes, regionGroups } from '@/lib/constants';

function parse(html: string) {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
}

test('all taxonomy links exist as real anchors without client rendering', () => {
  const element = parse(FOOTER_CATEGORY_LINKS_HTML);
  const prefectures = regionGroups.flatMap((region) => region.prefectures);
  expect(element.querySelectorAll('a')).toHaveLength(businessTypes.length * (prefectures.length + 1));
  expect(element.querySelector('a[href="/tokyo/hair-salon"]')).toHaveTextContent('東京都');
  expect(element.querySelector('a[href="/osaka/acupuncture"]')).toHaveTextContent('大阪府');
  for (const link of element.querySelectorAll('a')) {
    expect(link.getAttribute('href')).toMatch(/^\/(?!\/)/);
  }
});

test('unmapped types and areas retain encoded search links', () => {
  const type = '合成 未登録業種';
  const area = '合成 未登録地域';
  const element = parse(renderFooterCategoryLinks([type], [area]));
  const links = element.querySelectorAll('a');
  expect(links[0]).toHaveTextContent(type);
  expect(links[0].getAttribute('href')).toBe(`/search?type=${encodeURIComponent(type)}`);
  expect(links[1]).toHaveTextContent(area);
  expect(links[1].getAttribute('href')).toBe(`/search?type=${encodeURIComponent(type)}&area=${encodeURIComponent(area)}`);
});

test('text and attributes escape all HTML delimiters and cannot inject markup', () => {
  const text = `&<>"'<img src=x onerror=alert(1)>`;
  const html = renderFooterCategoryLinks([text], [text]);
  const element = parse(html);
  expect(element.querySelectorAll('script, img, svg, [onerror], [onclick]')).toHaveLength(0);
  expect(element.querySelector('h3 a')).toHaveTextContent(text);
  expect(element.querySelector('.footer-category-areas a')).toHaveTextContent(text);
  expect(html).toContain('&amp;&lt;&gt;&quot;&#39;');
  for (const link of element.querySelectorAll('a')) expect(link.getAttribute('href')).toMatch(/^\/search\?/);
});

test('empty taxonomies have no placeholder destinations', () => {
  expect(renderFooterCategoryLinks([], ['東京都'])).toBe('');
  expect(parse(renderFooterCategoryLinks(['ヘアサロン'], [])).querySelectorAll('a')).toHaveLength(1);
});

test.each([
  ['合成 未登録業種', '東京都'],
  ['ヘアサロン', '合成 未登録地域'],
])('a missing slug on either side falls back to the encoded search: %s / %s', (type, area) => {
  const link = parse(renderFooterCategoryLinks([type], [area])).querySelector('.footer-category-areas a');
  expect(link?.getAttribute('href')).toBe(`/search?type=${encodeURIComponent(type)}&area=${encodeURIComponent(area)}`);
});
