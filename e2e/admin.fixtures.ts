// 管理画面（オーナー）E2E の共有定数。
// admin.setup.ts が CI の隔離 Supabase（supabase start）にテスト店舗＋オーナーを
// service role で seed し、admin.spec.ts がここに定義した期待値を検証する。
// 本番には一切触れない（CI ランナー内の一時 DB のみ）。

export const ADMIN_AUTH_FILE = 'e2e/.auth/admin.json';
// admin.setup.ts が seed した「承認待ち(pending)予約」の id を書き出すファイル。
// admin.spec.ts が読み、その予約詳細で承認の書き込みフローを検証する。
export const PENDING_BOOKING_FILE = 'e2e/.auth/admin-pending.json';
// 確定(confirmed)予約の id。退店レジ会計→完了の書き込み・副作用検証に使う。
export const CONFIRMED_BOOKING_FILE = 'e2e/.auth/admin-confirmed.json';

// seed する固定値（admin.spec.ts の検証期待値と一致させる）
export const SEED = {
  staffName: '山田 太郎',
  completedCustomer: 'テスト完了予約',
  confirmedCustomer: 'テスト確定予約',
  noShowCustomer: 'テスト無断予約',
  pendingCustomer: 'テスト承認待ち予約',
  completedPriceYen: 8000, // 当日完了予約の total_price → 本日/今月の売上・客単価
  noShowPriceYen: 5000,
  confirmedPriceYen: 6000,
  // 無断キャンセル率 = no_show /(completed + no_show) = 1/2 = 50%
  expectedNoShowRate: '50%',
  // 本日の売上 = 完了予約のみ = 8000 → "¥8,000"
  expectedTodayRevenue: '¥8,000',
};

// JST の本日（YYYY-MM-DD）。CI は UTC のため +9h して算出し、
// dashboard の todayJst() と一致させる。
export function jstToday(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
