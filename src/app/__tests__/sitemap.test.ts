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

describe('sitemap SHOW_JOBS branch', () => {
  test('SHOW_JOBS=false のとき /jobs 系 URL を一切含まない', async () => {
    let sitemapDefault!: () => Promise<{ url: string }[]>;
    jest.isolateModules(() => {
      setupSupabaseMock();
      jest.doMock('@/lib/feature-toggles', () => ({ SHOW_JOBS: false }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sitemapDefault = require('../sitemap').default;
    });
    const result = await sitemapDefault();
    const urls = result.map((r) => r.url);
    expect(urls).toContain('https://carelink-jp.com/jobs');
    expect(urls.some((u) => u.includes('/jobs/job-1'))).toBe(true);
  });
});
