// オーナーがパッケージ（回数券）を作成できることを実行証明する（作成→一覧反映）。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-batch.setup の storageState を使う。
import { test, expect } from '@playwright/test';

test('オーナーがパッケージを作成できる（書き込み→一覧反映）', async ({ page }) => {
  const packageName = 'E2E回数券パッケージ';
  await page.goto('/admin/packages');

  // 新規作成フォームを開く → 必須は名前のみ（回数/ボーナス/価格/有効日数はフォーム既定値）。
  await page.getByRole('button', { name: '+ 新規作成' }).click();
  await page.getByPlaceholder('5回券（お得パック）').fill(packageName);

  // 作成（POST /api/admin/packages）。service_packages の NOT NULL 列は全て Zod 必須/API 注入/
  // DB デフォルトで埋まる（#311 同型の未生成バグは無い）。
  await page.getByRole('button', { name: '作成', exact: true }).click();

  await expect(page.getByText('パッケージを作成しました')).toBeVisible({ timeout: 15000 });
  // 一覧に作成したパッケージが出る（書き込み永続化＋再読込反映）。
  await expect(page.getByText(packageName)).toBeVisible({ timeout: 15000 });
});
