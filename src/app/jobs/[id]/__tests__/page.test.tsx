/**
 * Tests for app/jobs/[id]/page.tsx generateMetadata — SHOW_JOBS フラグによる
 * metadata.robots の分岐（両分岐）。ページ本体の表示ロジックはこのPRでは変更していないため対象外。
 */

const JOB_ROW = {
  id: 'job-1',
  facility_id: 'fac-1',
  title: '受付スタッフ',
  job_type: '受付',
  employment_type: '正社員',
  salary_min: 200000,
  salary_max: 250000,
  salary_note: null,
  description: '受付業務全般',
  requirements: null,
  benefits: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  facility_profiles: {
    id: 'fac-1',
    name: 'テスト施設',
    slug: 'test-facility',
    business_type: '鍼灸院・整骨院',
    prefecture: '大阪府',
    city: '豊中市',
    address: null,
    postal_code: null,
    website_url: null,
    main_photo_url: null,
    status: 'published',
  },
};

function setupSupabaseMock() {
  jest.doMock('@/lib/supabase-server', () => ({
    createServerSupabaseClient: jest.fn(() => ({
      from: jest.fn(() => {
        const builder: Record<string, unknown> = {};
        builder.select = jest.fn(() => builder);
        builder.eq = jest.fn(() => builder);
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: JOB_ROW, error: null });
        return builder;
      }),
    })),
  }));
}

describe('job detail page generateMetadata SHOW_JOBS branch', () => {
  test('SHOW_JOBS=false のとき robots: noindex,nofollow が付与される', async () => {
    let generateMetadata!: (props: { params: Promise<{ id: string }> }) => Promise<{ robots?: { index: boolean; follow: boolean } }>;
    jest.isolateModules(() => {
      setupSupabaseMock();
      jest.doMock('@/lib/feature-toggles', () => ({ SHOW_JOBS: false }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      generateMetadata = require('../page').generateMetadata;
    });
    const metadata = await generateMetadata({ params: Promise.resolve({ id: 'job-1' }) });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  test('SHOW_JOBS=true のとき robots は付与されない（既定のインデックス可）', async () => {
    let generateMetadata!: (props: { params: Promise<{ id: string }> }) => Promise<{ robots?: { index: boolean; follow: boolean } }>;
    jest.isolateModules(() => {
      setupSupabaseMock();
      jest.doMock('@/lib/feature-toggles', () => ({ SHOW_JOBS: true }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      generateMetadata = require('../page').generateMetadata;
    });
    const metadata = await generateMetadata({ params: Promise.resolve({ id: 'job-1' }) });
    expect(metadata.robots).toBeUndefined();
  });
});
