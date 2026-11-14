import { featureArticleSearchHref, featureSearchHref } from '../search-href';

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

// 監査 A186: 特集ページの検索リンクが都道府県を落とし、type が無いと '/search?&keyword=' になっていた。
describe('featureArticleSearchHref', () => {
  test('特集の都道府県・業種・キーワードをすべて引き継ぐ', () => {
    const q = query(featureArticleSearchHref({ filter_type: '美容室', filter_prefecture: '大阪府', filter_keyword: '縮毛矯正' }));
    expect(q.get('type')).toBe('美容室');
    expect(q.get('area')).toBe('大阪府');
    expect(q.get('keyword')).toBe('縮毛矯正');
  });

  test('keyword だけでも先頭に & が付かない', () => {
    expect(featureArticleSearchHref({ filter_type: null, filter_keyword: '肩こり', filter_prefecture: null })).toBe('/search?keyword=%E8%82%A9%E3%81%93%E3%82%8A');
  });

  test('条件が無ければ /search', () => {
    expect(featureArticleSearchHref({})).toBe('/search');
  });
});
