/**
 * @jest-environment jsdom
 *
 * NotificationSettings の保存エラー挙動テスト。
 * - upsert 成功 → トグルが反映されエラーは出さない
 * - upsert 失敗 → 楽観更新したトグルを元に戻し、エラー表示（DBと表示の不整合・成功偽装を防ぐ・回帰防止）
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NotificationSettings from '@/components/admin/NotificationSettings';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const LOAD_DATA = {
  push_on_new_booking: true,
  push_on_cancel: true,
  push_on_review: true,
  email_daily_summary: false,
  email_weekly_report: true,
};

function mockClient(upsertError: unknown) {
  const upsert = jest.fn(() => Promise.resolve({ error: upsertError }));
  const maybeSingle = jest.fn(() => Promise.resolve({ data: LOAD_DATA, error: null }));
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) })),
      upsert,
    })),
  });
}

afterEach(() => jest.clearAllMocks());

test('upsert 成功 → トグルが反映されエラーは出さない', async () => {
  mockClient(null);
  render(<NotificationSettings facilityId="f1" />);
  const switches = await screen.findAllByRole('switch');
  // 先頭 push_on_new_booking は default true → クリックで false
  expect(switches[0]).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(switches[0]);
  await waitFor(() => expect(switches[0]).toHaveAttribute('aria-checked', 'false'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('upsert 失敗 → トグルを元に戻しエラー表示（成功偽装防止・回帰防止）', async () => {
  mockClient({ message: 'RLS denied' });
  render(<NotificationSettings facilityId="f1" />);
  const switches = await screen.findAllByRole('switch');
  expect(switches[0]).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(switches[0]); // 楽観的に false へ
  // 保存失敗 → true に巻き戻り、エラー表示
  expect(await screen.findByRole('alert')).toHaveTextContent('設定の保存に失敗しました');
  await waitFor(() => expect(switches[0]).toHaveAttribute('aria-checked', 'true'));
});
