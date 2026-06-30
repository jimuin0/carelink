// オーナーが回数券パッケージを「公開トグル（PATCH is_active）→削除（DELETE）」できることを実行証明する。
// 作成は admin-packages.spec.ts が担当済み＝ここは編集（公開状態の更新）と削除（一覧からの消滅）の穴を埋める。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-batch.setup の storageState を使う。
import { test, expect } from '@playwright/test';

test('オーナーがパッケージを公開トグル→削除できる（PATCH→反映 / DELETE→消滅）', async ({ page }) => {
  const name = `E2E回数券_${Date.now()}`;
  await page.goto('/admin/packages');

  // まず編集/削除の対象を1件作成（名前のみ必須・他はフォーム既定値）。
  await page.getByRole('button', { name: '+ 新規作成' }).click();
  await page.getByPlaceholder('5回券（お得パック）').fill(name);
  await page.getByRole('button', { name: '作成', exact: true }).click();
  await expect(page.getByText('パッケージを作成しました')).toBeVisible({ timeout: 15000 });

  // 作成した行に限定（並行 spec が同一施設に作る他パッケージと混ざらないよう一意名でスコープ）。
  const row = page.locator('div.flex.items-start').filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 15000 });

  // 公開トグル＝PATCH /api/admin/packages/{id}（is_active 反転）。固定オーバーレイ hit-test 被り回避で focus→Enter。
  const toggle = row.getByRole('button', { name: '公開中', exact: true });
  await toggle.scrollIntoViewIfNeeded();
  await toggle.press('Enter');
  // is_active=false 反映＝バッジが「非公開」に変わる（書き込み→UI 反映）。
  await expect(row.getByRole('button', { name: '非公開', exact: true })).toBeVisible({ timeout: 15000 });

  // 削除＝DELETE /api/admin/packages/{id}。ConfirmDialog で確定。
  const del = row.getByRole('button', { name: '削除', exact: true });
  await del.scrollIntoViewIfNeeded();
  await del.press('Enter');
  const confirm = page.getByRole('button', { name: '削除する' });
  await confirm.scrollIntoViewIfNeeded();
  await confirm.press('Enter');
  await expect(page.getByText('削除しました')).toBeVisible({ timeout: 15000 });
  // 一覧から消滅（削除永続化＋再読込反映）。
  await expect(page.getByText(name)).toHaveCount(0, { timeout: 15000 });
});
