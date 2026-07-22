// オーナーが広告・上位表示ページに到達したとき、ローンチ時非表示ゲート（決済手段未導入）により
// 「準備中」表示となり、有料掲載枠の販売UI（プランカード・購入ボタン・申込フォーム）が一切
// 出ないことを検証する。CI の隔離 Supabase（supabase start）上でのみ動作（本番不可侵）。
// admin-batch.setup の storageState（owner 認証）を使う。
//
// 【背景】神原さん決定（2026年7月22日）：ローンチは決済プロバイダ（Stripe/PAY.JP）を使わない。
// 施設オーナーがプラットフォームへ支払う有料掲載枠は回収手段が無く成立しないため、壊れた決済導線
// （鍵の無い Stripe Checkout への遷移）を出さないよう非表示化した。実体＝
// src/app/admin/featured-ads/page.tsx の FEATURED_ADS_ENABLED（false でゲート）と
// src/app/admin/layout.tsx の LAUNCH_HIDDEN_HREFS（nav から /admin/featured-ads を全ロール非表示）。
// 決済導入時にフラグを戻すだけで販売UIが復活する。このテストは「販売UIが再露出しないこと」を固定する。
import { test, expect } from '@playwright/test';

test('オーナーが広告・上位表示ページに到達すると「準備中」表示となり販売UIが出ない', async ({ page }) => {
  await page.goto('/admin/featured-ads');
  // 未認証リダイレクトに飛ばされていない＝owner で到達できている（ページ自体は温存・直URLは有効）。
  expect(page.url()).toContain('/admin/featured-ads');
  await expect(page.getByRole('heading', { name: '広告・上位表示' })).toBeVisible();

  // ローンチ時非表示ゲートの「準備中」表示が出る。
  await expect(page.getByText('この機能は現在準備中です')).toBeVisible();

  // 販売UI（プランカード・購入ボタン）が一切表示されない＝決済導線を出さない。
  await expect(page.getByText('検索結果上位表示')).toHaveCount(0);
  await expect(page.getByText('エリアページバナー')).toHaveCount(0);
  await expect(page.getByText('カテゴリートップ')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '広告枠を購入' })).toHaveCount(0);
});
