/**
 * @jest-environment jsdom
 *
 * 設定ページの連携状態取得失敗可視化 回帰テスト。
 * 旧実装は .catch で connected:false / lineLinked:false に化けさせ、障害を「未連携」と誤表示していた。
 * 連携を操作するページのため、エラーと未連携を区別する。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import SettingsPage from '@/app/mypage/settings/page';

jest.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => null }) }));

function routeFetch(handler: (url: string) => { ok: boolean; status: number; body: object }) {
  global.fetch = jest.fn((url: string) => {
    const { ok, status, body } = handler(url);
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
  }) as unknown as typeof fetch;
}

afterEach(() => jest.clearAllMocks());

test('連携状態の取得失敗 → 「未連携」でなくエラーを明示する（gcal/line とも・回帰防止）', async () => {
  routeFetch(() => ({ ok: false, status: 500, body: {} }));
  render(<SettingsPage />);
  const alerts = await screen.findAllByRole('alert');
  // gcal と LINE の2セクションでそれぞれエラー表示
  expect(alerts.filter((a) => a.textContent?.includes('連携状態を取得できませんでした'))).toHaveLength(2);
});

test('取得成功 → 連携状態を正しく表示しエラーは出さない（正常系不変）', async () => {
  routeFetch((url) =>
    url === '/api/google-calendar'
      ? { ok: true, status: 200, body: { connected: true } }
      : { ok: true, status: 200, body: { linked: true } },
  );
  render(<SettingsPage />);
  // LINE 連携済み（一意テキスト）が表示され、どのセクションもエラーを出さない
  expect(await screen.findByText('LINEと連携中')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  // gcal も「連携する」ボタン（未連携UI）でなく連携済みUIになっている
  expect(screen.queryByText('Googleカレンダーと連携する')).not.toBeInTheDocument();
});
