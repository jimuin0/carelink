/**
 * @jest-environment jsdom
 *
 * 予約詳細ページの Googleカレンダー連携状態 取得失敗可視化 回帰テスト。
 * 旧実装は .catch(() => {}) で握り潰し、連携済みでも非連携扱いになっていた。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import BookingDetailPage from '@/app/mypage/bookings/[id]/page';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

// React 18.3.1 の CJS ビルドは jest 環境で `use` を公開しないため、引数素通しでモック。
// これによりテストでは params を解決済みオブジェクトとして渡せる（Suspense 不要）。
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return { ...actual, use: (v: unknown) => v };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const BOOKING = {
  id: 'b1',
  facility_id: 'f1',
  menu_id: null,
  staff_id: null,
  status: 'confirmed',
  booking_date: '2026-06-20',
  start_time: '10:00:00',
  end_time: '11:00:00',
  customer_name: 'テスト太郎',
  total_price: 5000,
  note: null,
};

// テーブルごとに data を返す柔軟なチェーン（select/eq を任意回チェーンでき、single で解決）。
// 予約(.eq×2)・施設(.eq×1)・メニュー/スタッフ など複数のクエリ形状に一様に対応する。
function mockSupabase() {
  const dataFor: Record<string, unknown> = {
    bookings: BOOKING,
    facility_profiles: { slug: 'test-salon', name: 'テスト施設' },
    facility_menus: null,
    staff_profiles: null,
  };
  const chain = (data: unknown): Record<string, unknown> => {
    const obj: Record<string, unknown> = {
      select: () => obj,
      eq: () => obj,
      single: () => Promise.resolve({ data, error: null }),
    };
    return obj;
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => chain(dataFor[t] ?? null),
  });
}

function mockGcalFetch(ok: boolean, body: object) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

afterEach(() => jest.clearAllMocks());

function renderPage() {
  // use() をモックしているため、params は解決済みオブジェクトを直接渡す
  return render(
    <BookingDetailPage params={{ id: 'b1' } as unknown as Promise<{ id: string }>} />,
  );
}

test('gcal連携状態の取得失敗 → 握り潰さずエラーを明示する（回帰防止）', async () => {
  mockSupabase();
  mockGcalFetch(false, {});
  renderPage();
  expect(await screen.findByText(/カレンダー連携状態を取得できませんでした/)).toBeInTheDocument();
});

test('gcal取得成功 → エラーを出さず連携同期ボタンを表示（正常系不変）', async () => {
  mockSupabase();
  mockGcalFetch(true, { connected: true, isExpired: false });
  renderPage();
  expect(await screen.findByText(/カレンダーに同期/)).toBeInTheDocument();
  expect(screen.queryByText(/連携状態を取得できませんでした/)).not.toBeInTheDocument();
});
