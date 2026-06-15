/**
 * @jest-environment jsdom
 *
 * CancelPolicySettings の保存エラー挙動テスト。
 * - upsert 成功 → 「保存しました」表示
 * - upsert 失敗 → エラー表示し、成功表示は出さない（返金率ポリシーの成功偽装を防ぐ・回帰防止）
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CancelPolicySettings from '@/components/admin/CancelPolicySettings';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const LOAD_DATA = { free_cancel_hours: 24, late_cancel_rate: 50, no_show_rate: 100, policy_text: '' };

function mockClient(upsertError: unknown) {
  const upsert = jest.fn(() => Promise.resolve({ error: upsertError }));
  const maybeSingle = jest.fn(() => Promise.resolve({ data: LOAD_DATA, error: null }));
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) })),
      upsert,
    })),
  });
  return { upsert };
}

afterEach(() => jest.clearAllMocks());

test('upsert 成功 → 「保存しました」を表示', async () => {
  mockClient(null);
  render(<CancelPolicySettings facilityId="f1" />);
  const saveBtn = await screen.findByText('ポリシーを保存');
  fireEvent.click(saveBtn);
  expect(await screen.findByText('保存しました')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('upsert 失敗 → エラー表示・「保存しました」は出さない（成功偽装防止・回帰防止）', async () => {
  mockClient({ message: 'RLS denied' });
  render(<CancelPolicySettings facilityId="f1" />);
  const saveBtn = await screen.findByText('ポリシーを保存');
  fireEvent.click(saveBtn);
  expect(await screen.findByRole('alert')).toHaveTextContent('保存に失敗しました');
  await waitFor(() => expect(screen.queryByText('保存しました')).not.toBeInTheDocument());
});
