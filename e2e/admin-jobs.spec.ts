// オーナーが求人を作成できることを実行証明する（作成→一覧反映）。
// CI の隔離 Supabase（supabase start）上でのみ動作（本番不可侵）。admin-batch.setup の
// storageState（owner 認証）を使う。POST /api/admin/jobs は単一施設 owner の場合 facilityIds[0]
// を投稿先に解決するため、body に facility_id を含めなくても owner 単独で完走する。
import { test, expect } from '@playwright/test';

test('オーナーが求人を作成できる（書き込み→一覧反映）', async ({ page }) => {
  const title = `E2E求人_${Date.now()}`;
  await page.goto('/admin/jobs/new');
  await expect(page.getByRole('heading', { name: '求人新規作成' })).toBeVisible();

  // 必須はタイトル・職種（雇用形態は既定「正社員」・給与は任意で空→null）。最小入力で作成する。
  // jobs/new は react-hook-form（uncontrolled）。ハイドレーション完了前に fill すると rhf が
  // defaultValues（空）でリセットしうる。fill→値検証を toPass で繰り返し、値が定着する
  //（＝ハイドレーション後の入力で onChange が rhf に届く）まで待つことで競合を構造的に排除する。
  // 任意の待ち時間に依存しない決定的な方法。
  await expect(async () => {
    await page.fill('#job-title', title);
    await expect(page.locator('#job-title')).toHaveValue(title);
  }).toPass({ timeout: 15000 });
  await expect(async () => {
    await page.fill('#job-type', '美容師');
    await expect(page.locator('#job-type')).toHaveValue('美容師');
  }).toPass({ timeout: 15000 });

  // 送信ボタンは type=submit。focus→Enter でフォーム送信（hit-test 被り回避）。
  const submitBtn = page.getByRole('button', { name: '求人を作成' });
  await submitBtn.scrollIntoViewIfNeeded();
  await submitBtn.press('Enter');

  // 成功で /admin/jobs へ遷移（router.push）。一覧に作成求人が出る（書き込み永続化＋再読込反映）。
  await page.waitForURL('**/admin/jobs', { timeout: 15000 });
  await expect(page.getByText(title)).toBeVisible({ timeout: 15000 });
});
