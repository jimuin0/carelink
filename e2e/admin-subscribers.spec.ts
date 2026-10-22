// オーナーがサブスク契約者を一時停止できることを実行証明する（status active→paused）。
// 契約者一覧の描画は user-subscriptions GET を通る＝#330 の root fix を実 UI で実証。表示名は RPC
// list_facility_customer_profiles（その店舗の予約者に限る）から取るので、実 DB で名前が出ることも確かめる。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-subscribers.setup の storageState を使う。
import { test, expect } from '@playwright/test';
import { SUBSCRIBERS_SEED } from './admin-subscribers.fixtures';

test('オーナーがサブスク契約者を一時停止できる（active→paused）', async ({ page }) => {
  await page.goto('/admin/subscription-plans');

  // 「契約者一覧」タブへ切替（既定は「プラン定義」）。
  await page.getByRole('button', { name: '契約者一覧', exact: true }).click();

  // 予約者である契約者の表示名が出る（RPC の引数名・uuid[] の受け渡し・GRANT のどれかが壊れると、
  // 単体テストは緑のまま全員が「不明」になる）。
  await expect(page.getByText(SUBSCRIBERS_SEED.subscriberName, { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('不明', { exact: true })).toHaveCount(0);

  // アクティブ契約には「一時停止」「解約」ボタンが出る。固定オーバーレイの pointer hit-test 被りを
  // 避けるため focus→Enter のキーボード起動で確実に押す。
  const pauseBtn = page.getByRole('button', { name: '一時停止', exact: true });
  await expect(pauseBtn).toBeVisible({ timeout: 15000 });
  await pauseBtn.scrollIntoViewIfNeeded();
  await pauseBtn.press('Enter');

  // 一時停止後＝status='paused'。アクティブ用ボタンが消え「再開」ボタンが出る（書き込み反映）。
  await expect(page.getByRole('button', { name: '再開', exact: true })).toBeVisible({ timeout: 15000 });
});
