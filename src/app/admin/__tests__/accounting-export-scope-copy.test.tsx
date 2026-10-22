/** @jest-environment jsdom */
/**
 * 会計ソフト連携の画面の案内が、実際に出力される予約と一致していること（2026年10月22日）。
 *
 * 会計CSV（/api/admin/accounting-export）は売上を来店済みの分だけ計上するため、status=completed
 * かつ来店日（booking_date）で絞る（8体監査 A3）。ところが画面は「確定・完了」を出力すると案内した
 * ままで、「確定」のまま来店処理をしていない店舗には見出しだけのCSVが返り、理由が分からなかった。
 * API 側の絞り込みは src/app/api/admin/accounting-export/__tests__/route.test.ts が固定している。
 */
import { render, screen } from '@testing-library/react';
import AccountingPage from '../accounting/page';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/admin/accounting',
}));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

beforeEach(() => {
  const rows = [{ facility_id: 'ac000000-0000-4000-8000-000000000001', facility_profiles: { name: '合成店舗' } }];
  const query: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    single: () => Promise.resolve({ data: rows[0], error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0], error: null }),
  };
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) query[method] = jest.fn(() => query);
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null }) },
    from: jest.fn(() => query),
  });
});

test('出力対象は「完了」（来店済み）だけだと案内し、「確定」は含まれないと明示する', async () => {
  render(<AccountingPage />);
  expect(await screen.findByText('完了（来店済み）の予約を会計ソフト用CSVでエクスポート')).toBeTruthy();
  expect(screen.getByText('• 出力対象は「完了」（来店済み）の予約のみです。「確定」のままの予約は含まれません')).toBeTruthy();
  expect(screen.getByText('• 期間は来店日で絞り込みます')).toBeTruthy();
  // 回帰: 実際には出力しない「確定」を出力対象として案内しない
  expect(document.body.textContent).not.toMatch(/確定・完了/);
  expect(document.body.textContent).not.toMatch(/「確定」「完了」ステータス/);
});
