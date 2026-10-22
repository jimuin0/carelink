import { featureSearchHref } from '../search-href';

function query(href: string): URLSearchParams {
  expect(href.startsWith('/search?')).toBe(true);
  return new URLSearchParams(href.slice('/search?'.length));
}

describe('featureSearchHref', () => {
  test('こだわり条件は features= で渡す（keyword= の文字列検索にしない）', () => {
    const q = query(featureSearchHref('駐車場あり'));
    expect(q.get('features')).toBe('駐車場あり');
    expect(q.has('keyword')).toBe(false);
    expect([...q.keys()]).toEqual(['features']);
  });

  test('業種・エリアのページからは業種とエリアを引き継ぐ', () => {
    const q = query(featureSearchHref('個室あり', { type: '鍼灸院・整骨院', area: '大阪府' }));
    expect(q.get('type')).toBe('鍼灸院・整骨院');
    expect(q.get('area')).toBe('大阪府');
    expect(q.get('features')).toBe('個室あり');
  });

  test('空の業種・エリアは付けない', () => {
    const q = query(featureSearchHref('WiFi完備', { type: '', area: '' }));
    expect([...q.keys()]).toEqual(['features']);
  });
});
