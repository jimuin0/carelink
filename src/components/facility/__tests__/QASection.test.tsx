/**
 * @jest-environment jsdom
 *
 * QASection の質問投稿失敗可視化 回帰テスト。
 * 旧実装は catch { // silent } で insert 失敗(RLS拒否・通信断等)が顧客に一切見えなかった。
 * ReviewForm.tsx / InquiryForm.tsx と同じ Toast パターンで可視化する。
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QASection from '@/components/facility/QASection';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

function mockSupabase({ insertError = null as { message: string } | null, userId = 'user-1' } = {}) {
  const single = jest.fn();
  const select = jest.fn(() => ({
    eq: () => ({
      eq: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  }));
  const insert = jest.fn(() => Promise.resolve({ data: null, error: insertError }));
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: userId ? { id: userId } : null } }) },
    from: jest.fn(() => ({ select, insert })),
  });
  return { single };
}

afterEach(() => jest.clearAllMocks());

test('質問投稿が失敗(RLS拒否等) → エラーをToastで明示する（握り潰し回帰防止）', async () => {
  const user = userEvent.setup();
  mockSupabase({ insertError: { message: 'row-level security policy violation' } });

  render(<QASection facilityId="f1" />);

  const textarea = await screen.findByLabelText('質問を入力');
  await user.type(textarea, 'この施設は駐車場がありますか？');
  await user.click(screen.getByRole('button', { name: '質問する' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('質問の送信に失敗しました');
});

test('質問投稿が成功 → 成功メッセージを表示しエラーは出さない（正常系不変）', async () => {
  const user = userEvent.setup();
  mockSupabase({ insertError: null });

  render(<QASection facilityId="f1" />);

  const textarea = await screen.findByLabelText('質問を入力');
  await user.type(textarea, 'この施設は駐車場がありますか？');
  await user.click(screen.getByRole('button', { name: '質問する' }));

  expect(await screen.findByText('質問を送信しました。施設からの回答をお待ちください。')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});
