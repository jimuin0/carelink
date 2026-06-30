// オーナーが広告・上位表示ページに到達し、プラン提示と申込フォームが表示されることを検証する。
// CI の隔離 Supabase（supabase start）上でのみ動作（本番不可侵）。admin-batch.setup の
// storageState（owner 認証）を使う。
//
// 【検証範囲の限定（重要・正直な記録）】
// ・「決済へ進む」ボタンは押さない＝Stripe Checkout 遷移（外部依存）を一切踏まない。
// ・このページの掲載一覧 GET と作成 POST は API が facility_id を必須とするが、
//   page.tsx は fetch('/api/admin/featured-ads')（GET）も POST body も facility_id を送っていない
//   （現行コードの実体）。そのため一覧は 400→LoadError、作成も 400 になり、owner では
//   「一覧データ表示」「作成成功」を E2E で実証できない。よってここでは fetch 非依存で描画される
//   静的プランカードと、申込フォームの開閉（owner 到達性）までを検証対象とする。
import { test, expect } from '@playwright/test';

test('オーナーが広告・上位表示ページに到達し、プランと申込フォームが表示される', async ({ page }) => {
  await page.goto('/admin/featured-ads');
  // 未認証リダイレクトに飛ばされていない＝owner で到達できている。
  expect(page.url()).toContain('/admin/featured-ads');
  await expect(page.getByRole('heading', { name: '広告・上位表示' })).toBeVisible();

  // 静的プランカード（PLANS・fetch 非依存）が表示される。
  await expect(page.getByText('検索結果上位表示').first()).toBeVisible();
  await expect(page.getByText('エリアページバナー').first()).toBeVisible();
  await expect(page.getByText('カテゴリートップ').first()).toBeVisible();

  // 申込フォームを開く（focus→Enter で hit-test 被り回避）。決済ボタンは押さない。
  const openBtn = page.getByRole('button', { name: '広告枠を購入' });
  await openBtn.scrollIntoViewIfNeeded();
  await openBtn.press('Enter');
  await expect(page.getByRole('heading', { name: '広告枠を申し込む' })).toBeVisible();
});
