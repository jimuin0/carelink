// オーナーがスタッフを「作成→編集（PATCH）→一覧反映」できることを実行証明する。
// 編集対象が必要なため spec 内で先にスタッフを作成し、その編集ページで名前を変更して保存する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-batch.setup の storageState を使う。
import { test, expect } from '@playwright/test';

test('オーナーがスタッフを編集できる（作成→編集→一覧反映）', async ({ page }) => {
  const ts = Date.now();
  const original = `E2Eスタッフ_${ts}`;
  const edited = `E2E編集後_${ts}`;

  // 編集対象を作成（名前のみ必須）。作成後 /admin/staff へリダイレクト。
  await page.goto('/admin/staff/new');
  await page.fill('#staff-name', original);
  await page.getByRole('button', { name: 'スタッフを追加' }).click();
  await page.waitForURL((u) => u.pathname === '/admin/staff', { timeout: 20000 });

  // 一覧から該当スタッフの「編集」リンクで編集ページへ（一意名でカードをスコープ）。
  const card = page.locator('div.shadow-sm').filter({ hasText: original });
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.getByRole('link', { name: '編集', exact: true }).click();
  await page.waitForURL(/\/admin\/staff\/[^/]+\/edit/, { timeout: 20000 });

  // 既存値がロードされてから名前を変更し保存＝PATCH /api/admin/staff/{id}。
  await expect(page.locator('#staff-name')).toHaveValue(original, { timeout: 15000 });
  await page.fill('#staff-name', edited);
  // PATCH /api/admin/staff/{id} の成功を、4秒で自動消滅し CI では消滅後にポーリングして flake する
  // 成功トーストではなく API 応答そのもので判定する（唯一の副作用ゼロな決定的判定）。
  await Promise.all([
    page.waitForResponse((r) => /\/api\/admin\/staff\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH' && r.ok()),
    page.getByRole('button', { name: '保存', exact: true }).click(),
  ]);

  // 一覧へ戻り、編集後の名前が反映され旧名は消えていること（書き込み永続化＋再読込反映＝永続 DOM 証拠）。
  await page.goto('/admin/staff');
  await expect(page.getByText(edited)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(original)).toHaveCount(0, { timeout: 15000 });
});
