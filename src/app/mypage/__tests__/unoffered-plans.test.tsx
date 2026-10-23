/** @jest-environment node */
import { renderToStaticMarkup } from 'react-dom/server';
import MyPageLayout from '@/app/mypage/layout';
import MyPackagesPage from '@/app/mypage/packages/page';
import MySubscriptionsPage from '@/app/mypage/subscriptions/page';

// 回数券・月額プランは「今はなし」（2026年10月23日 神原さん判断・src/lib/feature-toggles.ts）。
// 以前はマイページのナビに常に出ており、空の画面は「施設を探して回数券を購入する」
// 「施設を探して月額プランに申し込む」と /search へ誘導していた（どこでも買えない約束）。
// 既に持っている人には一覧を見せ続ける（提供を止めても、持っているものが見えなくなってはいけない）。

const mockGetUser = jest.fn();
const mockHeldCount = jest.fn();
const mockServiceRows = jest.fn();
let navHidden: readonly string[] | undefined;

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: async () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => ({
      select: () => ({ eq: () => mockHeldCount(table) }),
    }),
  }),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: mockServiceRows(table), error: null }) }) }),
    }),
  }),
}));
jest.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error('notFound'); },
}));
jest.mock('@/components/mypage/MyPageNav', () => ({
  __esModule: true,
  default: ({ hiddenHrefs }: { hiddenHrefs?: readonly string[] }) => { navHidden = hiddenHrefs; return <nav>nav</nav>; },
}));

beforeEach(() => {
  navHidden = undefined;
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockHeldCount.mockReset().mockResolvedValue({ count: 0, error: null });
  mockServiceRows.mockReset().mockReturnValue([]);
});

describe('マイページのナビ', () => {
  test('回数券・月額プランを何も持っていない人には、ナビに出さない', async () => {
    renderToStaticMarkup(await MyPageLayout({ children: <div /> }));
    expect(navHidden).toEqual(['/mypage/packages', '/mypage/subscriptions']);
    // 本人の行だけを数えている
    expect(mockHeldCount).toHaveBeenCalledWith('user_packages');
    expect(mockHeldCount).toHaveBeenCalledWith('user_subscriptions');
  });

  test('既に持っている人には出し続ける', async () => {
    mockHeldCount.mockImplementation(async (table: string) => ({ count: table === 'user_packages' ? 2 : 0, error: null }));
    renderToStaticMarkup(await MyPageLayout({ children: <div /> }));
    expect(navHidden).toEqual(['/mypage/subscriptions']);
  });

  test('数えられなかったときは導線を残す（持っているものが見えなくなる側に倒さない）', async () => {
    mockHeldCount.mockImplementation(async (table: string) => (
      table === 'user_packages' ? { count: null, error: { message: 'synthetic' } } : Promise.reject(new Error('synthetic'))
    ));
    renderToStaticMarkup(await MyPageLayout({ children: <div /> }));
    expect(navHidden).toEqual([]);
  });
});

describe('回数券ページ', () => {
  test('何も持っていなければ、購入を約束せず提供していないと伝える', async () => {
    const html = renderToStaticMarkup(await MyPackagesPage());
    expect(html).toContain('回数券は現在提供していません。');
    expect(html).not.toContain('購入する');
    expect(html).not.toContain('href="/search"');
  });

  test('既に持っている回数券は閲覧のみで表示し続ける（購入の案内は出さない）', async () => {
    mockServiceRows.mockReturnValue([{
      id: 'p1', sessions_total: 5, sessions_remaining: 3, purchased_at: '2030-01-01T00:00:00Z', expires_at: null,
      service_packages: { name: '合成回数券', description: null, price: 10000 },
      facility_profiles: { name: '合成サロン', slug: 'synthetic-shop' },
    }]);
    const html = renderToStaticMarkup(await MyPackagesPage());
    expect(html).toContain('合成回数券');
    expect(html).toContain('利用可能な回数券');
    expect(html).not.toContain('購入する');
    expect(html).not.toContain('href="/search"');
  });
});

describe('月額プランページ', () => {
  test('何も加入していなければ、申し込みを約束せず提供していないと伝える', async () => {
    const html = renderToStaticMarkup(await MySubscriptionsPage());
    expect(html).toContain('月額プランは現在提供していません。');
    expect(html).not.toContain('申し込む');
    expect(html).not.toContain('href="/search"');
  });

  test('既に加入しているプランは閲覧のみで表示し続ける（申し込みの案内は出さない）', async () => {
    mockServiceRows.mockReturnValue([{
      id: 's1', status: 'active', sessions_used_this_month: 1, month_reset_at: '2030-01-01T00:00:00Z', ends_at: null,
      created_at: '2030-01-01T00:00:00Z',
      subscription_plans: { name: '合成月額プラン', price: 8000, sessions_per_month: 4, description: null },
      facility_profiles: { name: '合成サロン', slug: 'synthetic-shop' },
    }]);
    const html = renderToStaticMarkup(await MySubscriptionsPage());
    expect(html).toContain('合成月額プラン');
    expect(html).not.toContain('申し込む');
    expect(html).not.toContain('href="/search"');
  });
});
