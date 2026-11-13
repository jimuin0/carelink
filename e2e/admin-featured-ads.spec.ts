// オーナーが広告・上位表示ページに到達したとき、ローンチ時非表示ゲート（決済手段未導入）により
// 「準備中」表示となり、有料掲載枠の販売UI（プランカード・購入ボタン・申込フォーム）が一切
// 出ないことを検証する。CI の隔離 Supabase（supabase start）上でのみ動作（本番不可侵）。
// admin-batch.setup の storageState（owner 認証）を使う。
//
// 【背景】広告枠は 2026年11月13日（点検 B2-1）から PAY.JP の月額サブスクで販売する。販売 UI は
// PAY.JP の 4 つの設定（isPayjpEnabled・src/lib/integration-availability.ts）が揃ったときだけ出る。
// CI の隔離環境には PAY.JP の設定が無いので、ここでは「設定が無ければ販売 UI が出ない」ことを固定する
// （nav も src/app/admin/layout.tsx の LAUNCH_HIDDEN_HREFS で同じ判定に従って隠れる）。
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
  await expect(page.getByRole('button', { name: '広告枠を申し込む' })).toHaveCount(0);
});
