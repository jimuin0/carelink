/**
 * Tests for app/sitemap.ts — SHOW_JOBS フラグによる /jobs 掲載の分岐（両分岐）。
 * 他の静的/動的ページ列挙ロジックは既存のまま（このPRでは変更していない）。
 */

function makeQueryBuilder(result: { data: unknown; error?: unknown; count?: number | null }) {
  const builder: Record<string, unknown> = {};
  const chainMethods = ['select', 'eq', 'order', 'range', 'in', 'gte', 'lte', 'not', 'or'];
  for (const m of chainMethods) {
    builder[m] = jest.fn(() => builder);
  }
  // count: 'exact' で数える問い合わせ（店舗ブログ）向けに、指定が無ければ返す行数を総数にする。
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ count: Array.isArray(result.data) ? result.data.length : null, ...result }).then(resolve, reject);
  return builder;
}

function setupSupabaseMock() {
  jest.doMock('@/lib/supabase-server', () => ({
    createServerSupabaseClient: jest.fn(() => ({
      from: jest.fn((table: string) => {
        if (table === 'facility_jobs') {
          return makeQueryBuilder({
            data: [{ id: 'job-1', updated_at: '2026-07-01T00:00:00Z' }],
          });
        }
        // facility_profiles / symptoms / features 等はこのテストの関心事ではないため空データで統一
        return makeQueryBuilder({ data: [] });
      }),
    })),
  }));
}

/**
 * 特集ページの「薄いコンテンツ除外」（2026年8月12日 新設）。
 *
 * 2026年7月31日にエリアURLの薄いコンテンツを除外した際、特集ページだけが漏れて
 * 無条件で全件掲載のままだった。本番実測では公開中24件のうち3件が施設0件で、
 * うち2件は filter_type が実在しない business_type（「ヘアサロン」「リラクサロン」）のため恒久的に0件。
 */
function setupFeatureSitemapMock(
  facilities: Array<{ slug: string; prefecture: string | null; business_type: string | null; city: string | null }>,
  features: Array<{ slug: string; filter_type: string | null; filter_prefecture: string | null }>
) {
  jest.doMock('@/lib/supabase-server', () => ({
    createServerSupabaseClient: jest.fn(() => ({
      from: jest.fn((table: string) => {
        if (table === 'facility_profiles') {
          return makeQueryBuilder({ data: facilities.map((f) => ({ ...f, updated_at: null })) });
        }
        if (table === 'features') {
          return makeQueryBuilder({ data: features.map((f) => ({ ...f, updated_at: null })) });
        }
        return makeQueryBuilder({ data: [] });
      }),
    })),
  }));
}

async function featureUrls(
  facilities: Parameters<typeof setupFeatureSitemapMock>[0],
  features: Parameters<typeof setupFeatureSitemapMock>[1]
): Promise<string[]> {
  let sitemapDefault!: () => Promise<{ url: string }[]>;
  jest.isolateModules(() => {
    setupFeatureSitemapMock(facilities, features);
    jest.doMock('@/lib/feature-toggles', () => ({ SHOW_JOBS: false }));
    sitemapDefault = require('../sitemap').default;
  });
  const result = await sitemapDefault();
  return result.map((r) => r.url).filter((u) => u.includes('/feature/'));
}

describe('sitemap の特集ページは施設が出るものだけ載せる', () => {
  const LIVE = [
    { slug: 'hal', prefecture: '大阪府', business_type: 'ネイル・まつげサロン', city: '豊中市' },
    { slug: 'kanbara', prefecture: '大阪府', business_type: '鍼灸院・整骨院', city: '豊中市' },
  ];

  test('実在しない business_type を指す特集は載せない（本番の spring-hair-2026 相当）', async () => {
    const urls = await featureUrls(LIVE, [
      { slug: 'spring-hair-2026', filter_type: 'ヘアサロン', filter_prefecture: null },
      { slug: 'eyelash-special', filter_type: 'ネイル・まつげサロン', filter_prefecture: null },
    ]);
    expect(urls).toEqual(['https://carelink-jp.com/feature/eyelash-special']);
  });

  test('施設のいない都道府県を指す特集は載せない', async () => {
    const urls = await featureUrls(LIVE, [
      { slug: 'tokyo-only', filter_type: null, filter_prefecture: '東京都' },
      { slug: 'osaka-ok', filter_type: null, filter_prefecture: '大阪府' },
    ]);
    expect(urls).toEqual(['https://carelink-jp.com/feature/osaka-ok']);
  });

  test('フィルタ未設定の特集は載せる（全施設が対象になるため）', async () => {
    const urls = await featureUrls(LIVE, [{ slug: 'all', filter_type: null, filter_prefecture: null }]);
    expect(urls).toEqual(['https://carelink-jp.com/feature/all']);
  });

  test('空文字のフィルタは未設定として扱う（ページ側 `|| undefined` と同じ意味論）', async () => {
    const urls = await featureUrls(LIVE, [{ slug: 'empty-filters', filter_type: '', filter_prefecture: '' }]);
    expect(urls).toEqual(['https://carelink-jp.com/feature/empty-filters']);
  });

  test('公開施設が0件なら、フィルタ付き特集は1件も載らない', async () => {
    const urls = await featureUrls([], [
      { slug: 'spring-hair-2026', filter_type: 'ヘアサロン', filter_prefecture: null },
    ]);
    expect(urls).toEqual([]);
  });
});

/**
 * 一覧 `/feature` 自体の掲載可否（2026年8月12日 追加）。
 *
 * 本番の特集 21 件はフィルタ未設定で同じ3施設を返す重複コンテンツであり、一括非公開にすると
 * 一覧が空になる。詳細を除外しておきながら一覧だけ出すのは規則として一貫しないため、
 * 載せる詳細が 1 本も無いときは一覧も出さない（ページ側は noindex で補完する）。
 */
describe('sitemap の特集一覧ページ', () => {
  const LIVE_2 = [
    { slug: 'hal', prefecture: '大阪府', business_type: 'ネイル・まつげサロン', city: '豊中市' },
  ];

  async function allUrls(
    facilities: Parameters<typeof setupFeatureSitemapMock>[0],
    features: Parameters<typeof setupFeatureSitemapMock>[1]
  ): Promise<string[]> {
    let sitemapDefault!: () => Promise<{ url: string }[]>;
    jest.isolateModules(() => {
      setupFeatureSitemapMock(facilities, features);
      jest.doMock('@/lib/feature-toggles', () => ({ SHOW_JOBS: false }));
      sitemapDefault = require('../sitemap').default;
    });
    return (await sitemapDefault()).map((r) => r.url);
  }

  test('公開中の特集が1件も無ければ /feature を載せない', async () => {
    const urls = await allUrls(LIVE_2, []);
    expect(urls).not.toContain('https://carelink-jp.com/feature');
  });

  test('載せる詳細が全て除外されるなら /feature も載せない', async () => {
    const urls = await allUrls(LIVE_2, [
      { slug: 'spring-hair-2026', filter_type: 'ヘアサロン', filter_prefecture: null },
    ]);
    expect(urls).not.toContain('https://carelink-jp.com/feature');
    expect(urls.some((u) => u.includes('/feature/'))).toBe(false);
  });

  test('載せる詳細が1本でもあれば /feature も載せる', async () => {
    const urls = await allUrls(LIVE_2, [
      { slug: 'eyelash-special', filter_type: 'ネイル・まつげサロン', filter_prefecture: null },
    ]);
    expect(urls).toContain('https://carelink-jp.com/feature');
    expect(urls).toContain('https://carelink-jp.com/feature/eyelash-special');
  });
});

describe('sitemap SHOW_JOBS branch', () => {
  test('SHOW_JOBS=false のとき /jobs 系 URL を一切含まない', async () => {
    let sitemapDefault!: () => Promise<{ url: string }[]>;
    jest.isolateModules(() => {
      setupSupabaseMock();
      jest.doMock('@/lib/feature-toggles', () => ({ SHOW_JOBS: false }));
      sitemapDefault = require('../sitemap').default;
    });
    const result = await sitemapDefault();
    const urls = result.map((r) => r.url);
    expect(urls.some((u) => u.includes('/jobs'))).toBe(false);
  });

  test('SHOW_JOBS=true のとき /jobs 一覧・詳細 URL を含む', async () => {
    let sitemapDefault!: () => Promise<{ url: string }[]>;
    jest.isolateModules(() => {
      setupSupabaseMock();
      jest.doMock('@/lib/feature-toggles', () => ({ SHOW_JOBS: true }));
      sitemapDefault = require('../sitemap').default;
    });
    const result = await sitemapDefault();
    const urls = result.map((r) => r.url);
    expect(urls).toContain('https://carelink-jp.com/jobs');
    expect(urls.some((u) => u.includes('/jobs/job-1'))).toBe(true);
  });
});

/**
 * 表ごとの応答を差し替えられる汎用モック。from() に渡された表名と、select の列指定を記録する。
 */
function setupTablesMock(tables: Record<string, { data: unknown; error?: unknown; count?: number | null }>, selects: Array<[string, unknown]> = []) {
  jest.doMock('@/lib/supabase-server', () => ({
    createServerSupabaseClient: jest.fn(() => ({
      from: jest.fn((table: string) => {
        const builder = makeQueryBuilder(tables[table] ?? { data: [] });
        const select = builder.select as jest.Mock;
        builder.select = jest.fn((...args: unknown[]) => { selects.push([table, args[0]]); return select(...args); });
        return builder;
      }),
    })),
  }));
}

async function sitemapUrls(tables: Parameters<typeof setupTablesMock>[0], selects?: Array<[string, unknown]>): Promise<string[]> {
  let sitemapDefault!: () => Promise<{ url: string }[]>;
  jest.isolateModules(() => {
    setupTablesMock(tables, selects);
    jest.doMock('@/lib/feature-toggles', () => ({ SHOW_JOBS: false }));
    sitemapDefault = require('../sitemap').default;
  });
  return (await sitemapDefault()).map((r) => r.url);
}

const SITE = 'https://carelink-jp.com';

/**
 * 症状ページ・症状チェッカー（2026年10月22日・神原さん決定「施設が載るまで検索に出さない」）。
 * 対応症状を登録する手段が無く本番は全症状 0 件なのに、症状ページ 30 本と症状チェッカーが
 * 無条件で sitemap に載っていた（sitemap 60 URL のうち 31 本）。
 */
describe('sitemap の症状ページは公開施設が結びついた症状だけ載せる', () => {
  test('公開施設の結びついた症状が無ければ、症状ページも症状チェッカーも載せない（本番の現状）', async () => {
    const urls = await sitemapUrls({ symptoms: { data: [] } });
    expect(urls.some((u) => u.includes('/symptom'))).toBe(false);
  });

  test('結びついた症状だけ載せ、そのときは症状チェッカーも載せる', async () => {
    const selects: Array<[string, unknown]> = [];
    const urls = await sitemapUrls({ symptoms: { data: [{ slug: 'low-back-pain' }, { slug: 'headache' }] } }, selects);
    expect(urls.filter((u) => u.includes('/symptom/'))).toEqual([
      `${SITE}/symptom/headache`,
      `${SITE}/symptom/low-back-pain`,
    ]);
    expect(urls).toContain(`${SITE}/symptom-checker`);
    // 症状の一覧を丸ごと出すのではなく、対応表と公開施設を内部結合で絞り込んでいること
    expect(selects).toContainEqual(['symptoms', 'slug, facility_symptoms!inner(facility_profiles!inner())']);
  });

  test('読み取りに失敗したら、確かめられない症状ページは載せない（sitemap 自体は返す）', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const urls = await sitemapUrls({ symptoms: { data: null, error: { code: 'PGRST003' } } });
    expect(urls.some((u) => u.includes('/symptom'))).toBe(false);
    expect(urls).toContain(`${SITE}/search`);
    expect(spy).toHaveBeenCalledWith('[sitemap] symptom coverage lookup failed');
    spy.mockRestore();
  });
});

/**
 * ランキング（2026年10月22日）。口コミのある施設だけを並べるため、口コミが集まるまでは必ず空。
 * 空のページを提出していた（本番の /ranking は掲載 0 件で sitemap に載っていた）。
 */
describe('sitemap の /ranking は口コミのある公開施設があるときだけ載せる', () => {
  const facility = { slug: 'hal', prefecture: '大阪府', business_type: 'ネイル・まつげサロン', city: '豊中市', updated_at: null };

  test('口コミのある施設が無ければ載せない', async () => {
    const urls = await sitemapUrls({ facility_profiles: { data: [{ ...facility, rating_count: 0 }, { ...facility, slug: 'x', rating_count: null }] } });
    expect(urls).not.toContain(`${SITE}/ranking`);
  });

  test('1施設でも口コミがあれば載せる', async () => {
    const urls = await sitemapUrls({ facility_profiles: { data: [{ ...facility, rating_count: 2 }] } });
    expect(urls).toContain(`${SITE}/ranking`);
  });
});

/**
 * 店舗ブログ（2026年10月22日）。店舗が公開した記事は施設ページにも sitemap にも導線が無かった。
 */
describe('sitemap は公開施設の店舗ブログを載せる', () => {
  test('公開記事と、その施設の記事一覧を載せる（公開施設に限る絞り込み付き）', async () => {
    const selects: Array<[string, unknown]> = [];
    const urls = await sitemapUrls({
      blog_posts: {
        data: [
          { slug: 'first', published_at: '2026-10-01T00:00:00Z', updated_at: null, facility_profiles: { slug: 'hal', status: 'published' } },
          { slug: 'second', published_at: null, updated_at: '2026-10-02T00:00:00Z', facility_profiles: { slug: 'hal', status: 'published' } },
          { slug: 'news', published_at: null, updated_at: null, facility_profiles: { slug: 'kanbara', status: 'published' } },
        ],
      },
    }, selects);
    expect(urls.filter((u) => u.includes('/blog') && u.includes('/facility/'))).toEqual([
      `${SITE}/facility/hal/blog`,
      `${SITE}/facility/kanbara/blog`,
      `${SITE}/facility/hal/blog/first`,
      `${SITE}/facility/hal/blog/second`,
      `${SITE}/facility/kanbara/blog/news`,
    ]);
    expect(selects).toContainEqual(['blog_posts', 'slug, published_at, updated_at, facility_profiles!inner(slug, status)']);
  });

  test('店舗ブログの読み取りに失敗しても、sitemap 全体は返す（店舗ブログだけ出さない）', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const urls = await sitemapUrls({ blog_posts: { data: null, error: { code: 'PGRST003' } } });
    expect(urls.some((u) => u.includes('/facility/') && u.includes('/blog'))).toBe(false);
    expect(urls).toContain(`${SITE}/search`);
    expect(spy).toHaveBeenCalledWith('[sitemap] blog_posts lookup failed', { code: 'PGRST003' });
    spy.mockRestore();
  });

  test('記事が無い施設の記事一覧は載せない', async () => {
    const urls = await sitemapUrls({ blog_posts: { data: [] } });
    expect(urls.some((u) => u.includes('/facility/') && u.includes('/blog'))).toBe(false);
  });

  test('総数が取れなければ取り切れたか確かめられないので、店舗ブログだけ出さない', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const urls = await sitemapUrls({
      blog_posts: { data: [{ slug: 'first', published_at: null, updated_at: null, facility_profiles: { slug: 'hal', status: 'published' } }], count: null },
    });
    expect(urls.some((u) => u.includes('/facility/') && u.includes('/blog'))).toBe(false);
    expect(spy).toHaveBeenCalledWith('[sitemap] blog_posts lookup failed', { code: 'NO_COUNT' });
    spy.mockRestore();
  });

  /**
   * API の行数上限（max-rows）を超える記事数でも、古い記事から無言で切れない。
   * 以前は 1 回の問い合わせだけで、上限を超えた分（古い記事）と、その記事しか持たない施設の
   * 記事一覧が sitemap から消えていた。
   */
  describe('行数上限を超える記事数', () => {
    const MAX_ROWS = 2;
    const all = [
      { slug: 'a1', facility: 'hal' },
      { slug: 'a2', facility: 'hal' },
      { slug: 'b1', facility: 'kanbara' },
      { slug: 'c1', facility: 'old-shop' },
      { slug: 'c2', facility: 'old-shop' },
    ].map((p) => ({ slug: p.slug, published_at: null, updated_at: null, facility_profiles: { slug: p.facility, status: 'published' } }));

    /** range の指定どおりに切り出し、1 回に返す行数は MAX_ROWS で頭打ちにする（PostgREST の max-rows と同じ）。 */
    async function pagedSitemapUrls(rows: typeof all, ranges: Array<[number, number]>, totalOverride?: number) {
      let sitemapDefault!: () => Promise<{ url: string }[]>;
      jest.isolateModules(() => {
        jest.doMock('@/lib/supabase-server', () => ({
          createServerSupabaseClient: jest.fn(() => ({
            from: jest.fn((table: string) => {
              if (table !== 'blog_posts') return makeQueryBuilder({ data: [] });
              let from = 0;
              let to = Infinity;
              const builder = makeQueryBuilder({ data: [] });
              builder.range = jest.fn((f: number, t: number) => { from = f; to = t; ranges.push([f, t]); return builder; });
              builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({
                data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS)),
                error: null,
                count: totalOverride ?? rows.length,
              }).then(resolve);
              return builder;
            }),
          })),
        }));
        jest.doMock('@/lib/feature-toggles', () => ({ SHOW_JOBS: false }));
        sitemapDefault = require('../sitemap').default;
      });
      return (await sitemapDefault()).map((r) => r.url).filter((u) => u.includes('/facility/') && u.includes('/blog'));
    }

    test('返ってきた行数ぶん先へ進めて総数まで読み切る（上限より大きいページ幅でも読み飛ばさない）', async () => {
      const ranges: Array<[number, number]> = [];
      const urls = await pagedSitemapUrls(all, ranges);
      expect(urls).toEqual(expect.arrayContaining([
        `${SITE}/facility/hal/blog/a1`,
        `${SITE}/facility/hal/blog/a2`,
        `${SITE}/facility/kanbara/blog/b1`,
        `${SITE}/facility/old-shop/blog/c1`,
        `${SITE}/facility/old-shop/blog/c2`,
        `${SITE}/facility/old-shop/blog`,
      ]));
      expect(urls).toHaveLength(8);
      expect(ranges.map(([f]) => f)).toEqual([0, 2, 4]);
    });

    test('読む間に記事が減って続きが空になったら、読めた分で終える（無限に問い合わせない）', async () => {
      const ranges: Array<[number, number]> = [];
      const urls = await pagedSitemapUrls(all.slice(0, 3), ranges, 5);
      expect(urls).toContain(`${SITE}/facility/kanbara/blog/b1`);
      expect(ranges.map(([f]) => f)).toEqual([0, 2, 3]);
    });
  });
});
