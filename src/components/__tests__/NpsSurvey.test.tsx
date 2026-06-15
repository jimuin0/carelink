/**
 * @jest-environment jsdom
 *
 * NpsSurvey の送信エラー挙動テスト。
 * - res.ok=true → 送信完了
 * - res.ok=false（HTTPエラー）→ エラー表示し送信完了にしない（成功偽装を防ぐ・回帰防止）
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NpsSurvey from '@/components/NpsSurvey';

jest.mock('@/lib/analytics-events', () => ({ trackNpsSubmitted: jest.fn() }));

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function selectScoreAndSubmit() {
  fireEvent.click(screen.getByText('9')); // スコア選択
  fireEvent.click(screen.getByText('送信する'));
}

test('res.ok=true → 送信完了（送信ボタンが消える）', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response) as unknown as typeof fetch;
  render(<NpsSurvey facilityId="f1" bookingId="b1" />);
  selectScoreAndSubmit();
  await waitFor(() => expect(screen.queryByText('送信する')).not.toBeInTheDocument());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('res.ok=false → エラー表示・送信完了にしない（成功偽装防止・回帰防止）', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response) as unknown as typeof fetch;
  render(<NpsSurvey facilityId="f1" bookingId="b1" />);
  selectScoreAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent('送信に失敗しました');
  expect(screen.getByText('送信する')).toBeInTheDocument(); // 送信完了画面に遷移していない
});

test('通信エラー（fetch reject）→ エラー表示・送信完了にしない', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
  render(<NpsSurvey facilityId="f1" bookingId="b1" />);
  selectScoreAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent('送信に失敗しました');
  expect(screen.getByText('送信する')).toBeInTheDocument();
});
