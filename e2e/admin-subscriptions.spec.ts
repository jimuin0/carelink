// オーナーがサブスクリプション（月額）プランを作成できることを実行証明する（作成→一覧反映）。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-batch.setup の storageState を共有して使う。
import { test, expect } from '@playwright/test';

test('オーナーがサブスクプランを作成できる（書き込み→一覧反映）', async ({ page }) => {
  const planName = 'E2E月額プラン';
  await page.goto('/admin/subscription-plans');

  // 新規プランフォームを開く → 必須は名前のみ（料金/月あたり回数/最低契約月数はフォーム既定値）。
  await page.getByRole('button', { name: '+ 新規プラン' }).click();
  await page.getByPlaceholder('月4回プラン など').fill(planName);

  // 作成（POST /api/admin/subscription-plans）。subscription_plans の NOT NULL 列は Zod 必須/API 注入/
  // DB デフォルトで埋まる。一覧再読込では user-subscriptions GET も叩くが、profiles 別取得化で
  // LoadError にならない（同 PR で根治済み）。
  // 成功判定は、4秒で自動消滅し CI では消滅後にポーリングして flake する成功トーストではなく
  // API 応答そのもので行う（唯一の副作用ゼロな決定的判定）。
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/subscription-plans') && r.request().method() === 'POST' && r.ok()),
    page.getByRole('button', { name: '作成', exact: true }).click(),
  ]);

  // 一覧に作成したプランが出る（書き込み永続化＋再読込反映＝永続 DOM 証拠）。
  await expect(page.getByText(planName)).toBeVisible({ timeout: 15000 });
});
