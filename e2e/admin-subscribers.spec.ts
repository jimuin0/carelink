// オーナーがサブスク契約者を一時停止できることを実行証明する（status active→paused）。
// 契約者一覧の描画は user-subscriptions GET（profiles 別取得マージ）を通る＝#330 の root fix を実 UI で実証。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-subscribers.setup の storageState を使う。
import { test, expect } from '@playwright/test';

test('オーナーがサブスク契約者を一時停止できる（active→paused）', async ({ page }) => {
  await page.goto('/admin/subscription-plans');

  // 「契約者一覧」タブへ切替（既定は「プラン定義」）。
  await page.getByRole('button', { name: '契約者一覧', exact: true }).click();

  // アクティブ契約には「一時停止」「解約」ボタンが出る。固定オーバーレイの pointer hit-test 被りを
  // 避けるため focus→Enter のキーボード起動で確実に押す。
  const pauseBtn = page.getByRole('button', { name: '一時停止', exact: true });
  await expect(pauseBtn).toBeVisible({ timeout: 15000 });
  await pauseBtn.scrollIntoViewIfNeeded();
  await pauseBtn.press('Enter');

  // 一時停止後＝status='paused'。アクティブ用ボタンが消え「再開」ボタンが出る（書き込み反映）。
  await expect(page.getByRole('button', { name: '再開', exact: true })).toBeVisible({ timeout: 15000 });
});
