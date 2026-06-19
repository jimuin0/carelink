/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/hpb-scraper.ts
 * 純粋パース(decodeEntities/stripHtml/toMinutes/parseReserve/parseListingMeta)と
 * fetch 注入関数(collectListing/fetchStoreRows/fetchMenuRows)と httpFetch を網羅。
 */

import {
  collectListing,
  decodeEntities,
  fetchMenuRows,
  fetchStoreRows,
  httpFetch,
  parseListingMeta,
  parseReserve,
  stripHtml,
  toMinutes,
  type FetchFn,
} from '../hpb-scraper';

// ---- decodeEntities ----
describe('decodeEntities', () => {
  test('decodes hex and decimal numeric references', () => {
    expect(decodeEntities('&#x41;&#66;')).toBe('AB'); // hex 0x41=A, dec 66=B
  });
  test('decodes &nbsp; to a normal space', () => {
    expect(decodeEntities('&nbsp;')).toBe(' ');
  });
  test('decodes &yen; to ¥', () => {
    expect(decodeEntities('&yen;100')).toBe('¥100');
  });
  test('decodes quote/apostrophe entities', () => {
    expect(decodeEntities('&quot;&apos;&#39;')).toBe('"\'\'');
  });
  test('decodes &lt; &gt;', () => {
    expect(decodeEntities('&lt;a&gt;')).toBe('<a>');
  });
  test('decodes &amp; without double-decoding', () => {
    expect(decodeEntities('a&amp;b')).toBe('a&b');
    expect(decodeEntities('&amp;lt;')).toBe('&lt;'); // amp last → no double decode
  });
  test('handles empty / falsy input', () => {
    expect(decodeEntities('')).toBe('');
  });
});

// ---- stripHtml ----
describe('stripHtml', () => {
  test('removes tags, decodes entities, collapses whitespace', () => {
    expect(stripHtml('<div>  a\n\t b </div>')).toBe(' a b ');
    expect(stripHtml('<span>&yen;500</span>')).toBe(' ¥500 ');
  });

  test('handles empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});

// ---- toMinutes ----
describe('toMinutes', () => {
  test('parses 時間/分 combinations', () => {
    expect(toMinutes('2時間')).toBe(120);
    expect(toMinutes('1時間50分')).toBe(110);
    expect(toMinutes('120分')).toBe(120);
    expect(toMinutes('')).toBe(0);
    expect(toMinutes('なし')).toBe(0);
  });
});

// ---- parseReserve ----
describe('parseReserve', () => {
  test('coupon page: bracket name, target=新規, price, duration, description', () => {
    const html =
      '選択済みクーポン・メニュー 新規 ' +
      '《パリジェンヌラッシュリフト》 ¥6,900 説明テキストです。提示条件 ' +
      '所要合計 70分';
    expect(parseReserve(html)).toEqual({
      name: '《パリジェンヌラッシュリフト》',
      target: '新規',
      durationMin: 70,
      price: 6900,
      description: '説明テキストです。',
    });
  });

  test('menu page (選択済みメニュー), no badge → target ?, no description', () => {
    const html = '選択済みメニュー《上下まつ毛パーマ》 ¥9,900 所要合計 100分';
    const r = parseReserve(html);
    expect(r.name).toBe('《上下まつ毛パーマ》');
    expect(r.target).toBe('?');
    expect(r.durationMin).toBe(100);
    expect(r.price).toBe(9900);
    expect(r.description).toBeNull();
  });

  test('returns empty result when no 見出し', () => {
    expect(parseReserve('<html>無関係</html>')).toEqual({
      name: null,
      target: '?',
      durationMin: 0,
      price: 0,
      description: null,
    });
  });

  test('non-bracket name via 所要時間(目安), 再来 → 既存', () => {
    const html =
      '選択済みクーポン・メニュー 再来 所要時間(目安) コーティング ¥3,000 所要合計 30分';
    const r = parseReserve(html);
    expect(r.name).toBe('コーティング');
    expect(r.target).toBe('既存');
    expect(r.durationMin).toBe(30);
    expect(r.price).toBe(3000);
  });

  test('badge prefix stripped from non-bracket name; target 全員', () => {
    const html =
      '全員 選択済みメニュー 所要時間(目安) 全員 まつ毛パーマ ¥6,900 所要合計 100分';
    const r = parseReserve(html);
    expect(r.name).toBe('まつ毛パーマ');
    expect(r.target).toBe('全員');
  });

  test('name becomes null when only a badge word', () => {
    const html = '選択済みメニュー 所要時間(目安) 全員 ¥6,900 所要合計 50分';
    const r = parseReserve(html);
    expect(r.name).toBeNull();
  });

  test('mm null path: no bracket and no 所要時間(目安)', () => {
    const html = '選択済みメニュー ただの文章 ¥1,000 所要合計 30分';
    const r = parseReserve(html);
    expect(r.name).toBeNull();
    expect(r.price).toBe(1000);
    expect(r.durationMin).toBe(30);
  });

  test('duration fallback when 所要合計 absent (cut<0, sm null, dm match)', () => {
    const html = '選択済みメニュー《テスト》 ¥1,000 内容 80分';
    const r = parseReserve(html);
    expect(r.durationMin).toBe(80);
    expect(r.price).toBe(1000);
  });

  test('duration stays 0 when no duration anywhere (dm null)', () => {
    const html = '選択済みメニュー《テスト》 ¥1,000 内容のみ';
    expect(parseReserve(html).durationMin).toBe(0);
  });

  test('price 0 when no ¥ before 所要合計', () => {
    const html = '選択済みメニュー《名前のみ》 所要合計 40分';
    const r = parseReserve(html);
    expect(r.price).toBe(0);
    expect(r.name).toBe('《名前のみ》');
  });

  test('description strips leading duplicated name', () => {
    const html =
      '選択済みクーポン・メニュー《クーポンA》 ¥6,900 《クーポンA》追加説明。提示条件 所要合計 60分';
    expect(parseReserve(html).description).toBe('追加説明。');
  });

  test('description becomes null after stripping leading price', () => {
    const html = '選択済みメニュー《X》 ¥6,900 ¥100 提示条件 所要合計 60分';
    expect(parseReserve(html).description).toBeNull();
  });
});

// ---- parseListingMeta ----
describe('parseListingMeta', () => {
  test('既存 hint + description from last 。', () => {
    const r = parseListingMeta('既存 ［¥6,900］ 最初の説明。 ［¥7,000］ 最後の説明。');
    expect(r.targetHint).toBe('既存');
    expect(r.description).toBe('最後の説明。');
  });

  test('新規 hint', () => {
    expect(parseListingMeta('新規 内容').targetHint).toBe('新規');
  });

  test('全員 hint', () => {
    expect(parseListingMeta('全員 内容').targetHint).toBe('全員');
  });

  test('unknown hint → ? and no description', () => {
    const r = parseListingMeta('特になし');
    expect(r.targetHint).toBe('?');
    expect(r.description).toBeNull();
  });
});

// ---- collectListing ----
const listingPage = (extra = '') =>
  '全員 ［¥6,900］ パリジェンヌの説明。' +
  '<a href="/CSP/kr/reserve/?storeId=H1&couponId=CP123&add=0">予約</a>' +
  '<a href="/CSP/kr/reserve/?storeId=H1&couponId=CP123&amp;add=1">予約</a>' +
  '新規 ［¥3,000］ メニューの説明。' +
  '<a href="/CSP/kr/reserve/?storeId=H1&menuId=MN456&add=5">予約</a>' +
  extra;

describe('collectListing', () => {
  test('collects coupon/menu mix, merges add candidates, parses meta', async () => {
    const fetchFn: FetchFn = async (url) =>
      url.includes('coupon/') && !url.includes('PN')
        ? { status: 200, text: listingPage() }
        : { status: 404, text: '' };
    const items = await collectListing('H1', fetchFn);
    expect(items).toHaveLength(2);
    const cp = items.find((i) => i.refId === 'CP123')!;
    expect(cp.kind).toBe('coupon');
    expect(cp.adds).toEqual([0, 1]);
    expect(cp.targetHint).toBe('全員');
    expect(cp.description).toBe('パリジェンヌの説明。');
    const mn = items.find((i) => i.refId === 'MN456')!;
    expect(mn.kind).toBe('menu');
    expect(mn.adds).toEqual([5]);
    expect(mn.targetHint).toBe('新規');
  });

  test('stops on non-200', async () => {
    const fetchFn: FetchFn = async () => ({ status: 500, text: '' });
    expect(await collectListing('H1', fetchFn)).toEqual([]);
  });

  test('breaks on fetch throw', async () => {
    const fetchFn: FetchFn = async () => {
      throw new Error('network');
    };
    expect(await collectListing('H1', fetchFn)).toEqual([]);
  });

  test('breaks at first page with no new ids on page>1', async () => {
    const fetchFn: FetchFn = async (url) =>
      url.includes('PN')
        ? { status: 200, text: '全員 重複なし' } // page2: no link → pageNew 0
        : { status: 200, text: listingPage() };
    const items = await collectListing('H1', fetchFn, 5);
    expect(items).toHaveLength(2); // page2 adds nothing then breaks
  });

  test('continues across pages collecting new ids', async () => {
    const fetchFn: FetchFn = async (url) => {
      if (url.includes('PN2')) {
        return {
          status: 200,
          text: '<a href="?couponId=CP999&add=0">x</a>',
        };
      }
      if (url.includes('PN')) return { status: 404, text: '' };
      return { status: 200, text: listingPage() };
    };
    const items = await collectListing('H1', fetchFn, 5);
    expect(items.map((i) => i.refId).sort()).toEqual(['CP123', 'CP999', 'MN456']);
  });
});

// ---- fetchStoreRows ----
const couponReserve =
  '選択済みクーポン・メニュー 新規 《クーポンA》 ¥6,900 クーポン説明。提示条件 所要合計 70分';
const menuReserveNoBadge = '選択済みメニュー《上下まつ毛》 ¥9,900 所要合計 100分';

describe('fetchStoreRows', () => {
  test('builds rows; add retry; target ? falls back to listing hint; desc fallback', async () => {
    const fetchFn: FetchFn = async (url) => {
      if (url.includes('coupon/') && !url.includes('reserve')) {
        return { status: 200, text: listingPage() };
      }
      if (url.includes('PN')) return { status: 404, text: '' };
      // reserve pages
      if (url.includes('couponId=CP123')) {
        if (url.includes('add=0')) return { status: 200, text: '見出し無し' }; // invalid → retry
        return { status: 200, text: couponReserve }; // add=1 valid
      }
      if (url.includes('menuId=MN456')) {
        return { status: 200, text: menuReserveNoBadge }; // target ? → hint 新規
      }
      return { status: 404, text: '' };
    };
    const rows = await fetchStoreRows('H1', fetchFn);
    expect(rows).toHaveLength(2);
    const cp = rows.find((r) => r.refId === 'CP123')!;
    expect(cp.name).toBe('《クーポンA》');
    expect(cp.durationMin).toBe(70);
    expect(cp.price).toBe(6900);
    expect(cp.description).toBe('クーポン説明。'); // info.description truthy branch
    const mn = rows.find((r) => r.refId === 'MN456')!;
    expect(mn.target).toBe('新規'); // info.target '?' → listing hint
    expect(mn.description).toBe('メニューの説明。'); // info.description null → listing desc
  });

  test('skips ref when all adds fail (non-200 + throw + invalid)', async () => {
    const fetchFn: FetchFn = async (url) => {
      if (url.includes('coupon/') && !url.includes('reserve')) {
        return {
          status: 200,
          text:
            '<a href="?couponId=CP1&add=0">x</a>' +
            '<a href="?couponId=CP1&add=1">x</a>',
        };
      }
      if (url.includes('PN')) return { status: 404, text: '' };
      if (url.includes('add=0')) return { status: 500, text: '' }; // non-200
      throw new Error('boom'); // add=1 throws
    };
    expect(await fetchStoreRows('H1', fetchFn)).toEqual([]);
  });
});

// ---- fetchMenuRows ----
describe('fetchMenuRows', () => {
  test('aggregates rows and per-store counts across stores', async () => {
    const fetchFn: FetchFn = async (url) => {
      if (url.includes('slnH1') && !url.includes('reserve')) {
        return {
          status: 200,
          text: '<a href="?couponId=CP123&add=0">x</a>',
        };
      }
      if (url.includes('couponId=CP123')) {
        return { status: 200, text: couponReserve };
      }
      return { status: 404, text: '' }; // H2 listing empty, PN pages
    };
    const { rows, perStore } = await fetchMenuRows(['H1', 'H2'], fetchFn);
    expect(rows).toHaveLength(1);
    expect(perStore).toEqual({ H1: 1, H2: 0 });
  });
});

// ---- httpFetch ----
describe('httpFetch', () => {
  test('calls global fetch with UA and returns {status,text}', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue({ status: 200, text: async () => 'body' });
    const original = global.fetch;
    // @ts-expect-error override for test
    global.fetch = mockFetch;
    try {
      const r = await httpFetch('https://example.test/x');
      expect(r).toEqual({ status: 200, text: 'body' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.test/x',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('Mozilla/5.0'),
          }),
        }),
      );
    } finally {
      global.fetch = original;
    }
  });
});
