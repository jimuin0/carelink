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

const originalLiffId = process.env.NEXT_PUBLIC_LIFF_ID;

afterEach(() => {
  jest.clearAllMocks();
  if (originalLiffId === undefined) delete process.env.NEXT_PUBLIC_LIFF_ID;
  else process.env.NEXT_PUBLIC_LIFF_ID = originalLiffId;
});

/**
 * 【2026年7月29日】LINE はローンチ段階で設定しない方針になり、LIFF 未設定の間は
 * LINE 連携セクションを丸ごと出さないようにした（lib/line-availability.ts）。
 * そのため「取得失敗時のエラー表示」も LIFF の有無で本数が変わる。
 * 隠したこと自体が意図どおりであることと、LIFF を入れれば元に戻ることの両方を固定する。
 */
test('LIFF 未設定 → LINE セクションごと出さない（取得失敗のエラーも gcal のみ）', async () => {
  delete process.env.NEXT_PUBLIC_LIFF_ID;
  routeFetch(() => ({ ok: false, status: 500, body: {} }));
  render(<SettingsPage />);
  const alerts = await screen.findAllByRole('alert');
  expect(alerts.filter((a) => a.textContent?.includes('連携状態を取得できませんでした'))).toHaveLength(1);
  expect(screen.queryByText('LINE連携')).not.toBeInTheDocument();
});

test('LIFF 設定済み → 取得失敗を「未連携」でなくエラーとして明示する（gcal/line とも・回帰防止）', async () => {
  process.env.NEXT_PUBLIC_LIFF_ID = '1234567890-abcdefgh';
  routeFetch(() => ({ ok: false, status: 500, body: {} }));
  render(<SettingsPage />);
  const alerts = await screen.findAllByRole('alert');
  // gcal と LINE の2セクションでそれぞれエラー表示
  expect(alerts.filter((a) => a.textContent?.includes('連携状態を取得できませんでした'))).toHaveLength(2);
});

// LIFF を外しても、既に連携している人からは解除手段を奪わない。
// ここが崩れると、連携済みの顧客が自分で連携を切れなくなる。
test('LIFF 未設定でも連携済みなら LINE セクションを出す（解除手段を残す）', async () => {
  delete process.env.NEXT_PUBLIC_LIFF_ID;
  routeFetch((url) =>
    url === '/api/google-calendar'
      ? { ok: true, status: 200, body: { connected: false } }
      : { ok: true, status: 200, body: { linked: true } },
  );
  render(<SettingsPage />);
  expect(await screen.findByText('LINEと連携中')).toBeInTheDocument();
  expect(screen.getByText('連携を解除する')).toBeInTheDocument();
});

test('取得成功 → 連携状態を正しく表示しエラーは出さない（正常系不変）', async () => {
  process.env.NEXT_PUBLIC_LIFF_ID = '1234567890-abcdefgh';
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
