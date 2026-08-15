/**
 * Tests for app/sitemap.ts — SHOW_JOBS フラグによる /jobs 掲載の分岐（両分岐）。
 * 他の静的/動的ページ列挙ロジックは既存のまま（このPRでは変更していない）。
 */

function makeQueryBuilder(result: { data: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  const chainMethods = ['select', 'eq', 'order', 'range', 'in', 'gte', 'lte', 'not', 'or'];
  for (const m of chainMethods) {
    builder[m] = jest.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
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
