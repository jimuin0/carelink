// オーナーが月額プランを「公開トグル（PATCH is_active）→削除（DELETE）」できることを実行証明する。
// 作成は admin-subscriptions.spec.ts が担当済み＝ここは編集（公開状態の更新）と削除（一覧からの消滅）の穴を埋める。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-batch.setup の storageState を共有して使う。
import { test, expect } from '@playwright/test';

test('オーナーがサブスクプランを公開トグル→削除できる（PATCH→反映 / DELETE→消滅）', async ({ page }) => {
  const name = `E2E月額_${Date.now()}`;
  await page.goto('/admin/subscription-plans');

  // まず編集/削除の対象を1件作成（名前のみ必須・他はフォーム既定値）。
  await page.getByRole('button', { name: '+ 新規プラン' }).click();
  await page.getByPlaceholder('月4回プラン など').fill(name);
  const planCreate = page.waitForResponse(
    (r) => r.url().includes('/api/admin/subscription-plans') && r.request().method() === 'POST' && r.ok(),
    { timeout: 15000 }
  );
  await page.getByRole('button', { name: '作成', exact: true }).click();
  await planCreate; // POST 2xx を成功シグナルに（揮発トースト依存を外す。下の card 可視で永続確認）。

  // 作成したプランカードに限定（一意名＋削除ボタンの存在でスコープ）。
  const card = page.locator('div.rounded-xl')
    .filter({ hasText: name })
    .filter({ has: page.getByRole('button', { name: '削除', exact: true }) });
  await expect(card).toBeVisible({ timeout: 15000 });

  // 公開トグル＝PATCH /api/admin/subscription-plans/{id}（is_active 反転・load 再取得）。focus→Enter。
  const toggle = card.getByRole('button', { name: '非公開に', exact: true });
  await toggle.scrollIntoViewIfNeeded();
  await toggle.press('Enter');
  // is_active=false 反映＝ボタン文言が「公開に」へ変わる（書き込み→再読込反映）。
  await expect(card.getByRole('button', { name: '公開に', exact: true })).toBeVisible({ timeout: 15000 });

  // 削除＝DELETE /api/admin/subscription-plans/{id}（契約者ゼロなので物理削除）。ConfirmDialog で確定。
  const del = card.getByRole('button', { name: '削除', exact: true });
  await del.scrollIntoViewIfNeeded();
  await del.press('Enter');
  const confirm = page.getByRole('button', { name: '削除する' });
  await confirm.scrollIntoViewIfNeeded();
  await confirm.press('Enter');
  // 一覧から消滅（DELETE 永続化＋再読込反映）。成功 toast は API の {message:'deleted'} 由来で文言が変わるため
  // 消滅そのものを検証する。
  await expect(page.getByText(name)).toHaveCount(0, { timeout: 15000 });
});
