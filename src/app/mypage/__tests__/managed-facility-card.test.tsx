/** @jest-environment node */
import { renderToStaticMarkup } from 'react-dom/server';
import MyPageDashboard from '@/app/mypage/page';

// 店舗オーナーが来院者向けのマイページに着いたとき、自分の管理画面へ戻る道が無かった不具合の回帰テスト。
const mockMembership = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } }, error: null }) },
    from: (table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { display_name: '合成', phone: '0900000000', prefecture: '東京都' }, error: null }) }) }) };
      }
      if (table === 'facility_members') {
        return { select: () => ({ eq: () => ({ in: (_c: string, roles: string[]) => ({ order: () => ({ limit: () => ({
          maybeSingle: async () => mockMembership(roles),
        }) }) }) }) }) };
      }
      return { select: () => ({ eq: async () => ({ count: 0, error: null }) }) };
    },
  }),
}));
jest.mock('@/components/facility/RecentlyViewed', () => ({ __esModule: true, default: () => null }));
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound'); } }));

beforeEach(() => mockMembership.mockReset());

test('owner/admin には「あなたの店舗：<店舗名>」と管理画面へのボタンを上部に出す', async () => {
  mockMembership.mockResolvedValue({ data: { facility_profiles: { name: '合成サロン' } }, error: null });
  const html = renderToStaticMarkup(await MyPageDashboard());
  expect(html).toContain('data-testid="managed-facility-card"');
  expect(html).toMatch(/あなたの店舗：<span[^>]*>合成サロン<\/span>/);
  expect(html).toMatch(/<a [^>]*href="\/admin"[^>]*>管理画面を開く<\/a>/);
  // 挨拶カードより上
  expect(html.indexOf('managed-facility-card')).toBeLessThan(html.indexOf('さん、こんにちは'));
  expect(mockMembership).toHaveBeenCalledWith(['owner', 'admin']);
});

test('来院者（店舗なし）・取得失敗ではカードを出さず、マイページは表示する', async () => {
  mockMembership.mockResolvedValue({ data: null, error: null });
  let html = renderToStaticMarkup(await MyPageDashboard());
  expect(html).not.toContain('managed-facility-card');
  expect(html).toContain('さん、こんにちは');
  mockMembership.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
  html = renderToStaticMarkup(await MyPageDashboard());
  expect(html).not.toContain('managed-facility-card');
  expect(html).toContain('さん、こんにちは');
});
