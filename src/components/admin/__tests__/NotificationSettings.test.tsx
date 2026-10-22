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

// E22: 『口コミ投稿（Push通知）』とは別に、口コミのメールのトグルを置く（Push を切ってもメールは止まらない）。
test('口コミの Push とメールは別々のトグルで、Push を OFF にしてもメールの設定は保存値のまま', async () => {
  const upsert = jest.fn((_row: Record<string, unknown>) => Promise.resolve({ error: null }));
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: () => Promise.resolve({ data: { ...LOAD_DATA, email_on_review: true }, error: null }) })) })),
      upsert,
    })),
  });
  render(<NotificationSettings facilityId="f1" />);
  const pushToggle = await screen.findByRole('switch', { name: '口コミ投稿（Push通知）' });
  const emailToggle = screen.getByRole('switch', { name: '口コミ投稿（メール）' });
  expect(emailToggle).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(pushToggle);
  await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
  // 押したトグルの列だけを保存する（Push のトグルでメールの列に触れない）。
  expect(upsert.mock.calls[0][0]).toEqual({ facility_id: 'f1', push_on_review: false });
  expect(emailToggle).toHaveAttribute('aria-checked', 'true');
});

test('保存済みのメール OFF を読み込んで表示する', async () => {
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: () => Promise.resolve({ data: { ...LOAD_DATA, email_on_review: false }, error: null }) })) })),
      upsert: jest.fn(),
    })),
  });
  render(<NotificationSettings facilityId="f1" />);
  expect(await screen.findByRole('switch', { name: '口コミ投稿（メール）' })).toHaveAttribute('aria-checked', 'false');
});

// アプリが migration 20261023100000 より先にデプロイされた場合（列がまだ無い）。以前は保存のたびに
// email_on_review を送っていたため、関係の無いトグルまで全て保存に失敗した（レビュー指摘）。
describe('口コミのメールの列がまだ無い DB', () => {
  function clientWith(data: unknown) {
    const upsert = jest.fn((_row: Record<string, unknown>, _opts: unknown) => Promise.resolve({ error: null }));
    (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: () => Promise.resolve({ data, error: null }) })) })),
        upsert,
      })),
    });
    return upsert;
  }

  test('読み込んだ行に列が無ければ、保存できない『口コミ投稿（メール）』は出さず、他のトグルはその列だけを保存する', async () => {
    const upsert = clientWith(LOAD_DATA);
    render(<NotificationSettings facilityId="f1" />);
    const newBooking = await screen.findByRole('switch', { name: '新規予約（Push通知）' });
    expect(screen.queryByRole('switch', { name: '口コミ投稿（メール）' })).not.toBeInTheDocument();
    fireEvent.click(newBooking);
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][0]).toEqual({ facility_id: 'f1', push_on_new_booking: false });
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'facility_id' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('設定の行がまだ無い施設は判別できないので出す（作られる行の他の列は DB の既定値＝画面の初期値）', async () => {
    const upsert = clientWith(null);
    render(<NotificationSettings facilityId="f1" />);
    const email = await screen.findByRole('switch', { name: '口コミ投稿（メール）' });
    expect(email).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(email);
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][0]).toEqual({ facility_id: 'f1', email_on_review: false });
  });
});
