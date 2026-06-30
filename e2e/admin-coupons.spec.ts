// オーナーがクーポンを作成→編集→削除できることを実行証明する。
// 作成は既カバーだが PATCH/DELETE（src/app/admin/coupons/[id]/edit/page.tsx:86,123）は未カバーのため新設。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-batch.setup の storageState（owner 認証）を共有して使う。
import { test, expect } from '@playwright/test';

test('オーナーがクーポンを作成→編集→削除できる（書き込み→一覧反映/消滅）', async ({ page }) => {
  // CI の retries で同一 storageState（同一施設）を再利用するため、毎回ユニーク名で衝突を避ける。
  const ts = `${Date.now()}`;
  const couponName = `E2Eクーポン_${ts}`;
  const editedName = `E2Eクーポン編集済_${ts}`;

  // --- 作成：新規フォームで名前のみ入力（割引タイプ既定=fixed）→ 作成 → 一覧へ遷移。
  // 固定オーバーレイ（Cookie 同意バナー/AIサポート）の hit-test 被り対策で focus→Enter で押す。
  await page.goto('/admin/coupons/new');
  await page.locator('#coupon-name').fill(couponName);
  const createBtn = page.getByRole('button', { name: 'クーポンを作成', exact: true });
  await createBtn.scrollIntoViewIfNeeded();
  await createBtn.press('Enter');

  // POST /api/admin/coupons 成功で一覧へ router.push → 作成したクーポンが表示される（永続化）。
  await expect(page).toHaveURL(/\/admin\/coupons$/, { timeout: 15000 });
  await expect(page.getByText(couponName, { exact: true })).toBeVisible({ timeout: 15000 });

  // --- 編集：該当カードの「編集」リンク → 編集ページで名前変更 → 保存。
  const card = page.locator('div.bg-white.rounded-xl.p-4.shadow-sm').filter({ hasText: couponName });
  const editLink = card.getByRole('link', { name: '編集', exact: true });
  await editLink.scrollIntoViewIfNeeded();
  await editLink.press('Enter');
  await expect(page).toHaveURL(/\/admin\/coupons\/[^/]+\/edit$/, { timeout: 15000 });

  await page.locator('#coupon-name').fill(editedName);
  const saveBtn = page.getByRole('button', { name: '保存', exact: true });
  await saveBtn.scrollIntoViewIfNeeded();
  await saveBtn.press('Enter');

  // PATCH /api/admin/coupons/{id} → 成功トースト（編集ページに留まる）。
  await expect(page.getByText('保存しました')).toBeVisible({ timeout: 15000 });

  // 一覧へ戻ると編集後の名前が反映され、旧名は消えている（書き込み永続化＋再読込）。
  await page.goto('/admin/coupons');
  await expect(page.getByText(editedName, { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(couponName, { exact: true })).toHaveCount(0);

  // --- 削除：編集ページの「このクーポンを削除」→ 確認ダイアログ「削除する」→ 一覧へ遷移。
  const editedCard = page.locator('div.bg-white.rounded-xl.p-4.shadow-sm').filter({ hasText: editedName });
  const reEditLink = editedCard.getByRole('link', { name: '編集', exact: true });
  await reEditLink.scrollIntoViewIfNeeded();
  await reEditLink.press('Enter');
  await expect(page).toHaveURL(/\/admin\/coupons\/[^/]+\/edit$/, { timeout: 15000 });

  const deleteLink = page.getByRole('button', { name: 'このクーポンを削除', exact: true });
  await deleteLink.scrollIntoViewIfNeeded();
  await deleteLink.press('Enter');

  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  const confirmDel = confirm.getByRole('button', { name: '削除する', exact: true });
  await confirmDel.scrollIntoViewIfNeeded();
  await confirmDel.press('Enter');

  // DELETE /api/admin/coupons/{id} 成功で一覧へ router.push → 一覧から消滅（永続削除）。
  await expect(page).toHaveURL(/\/admin\/coupons$/, { timeout: 15000 });
  await expect(page.getByText(editedName, { exact: true })).toHaveCount(0);
});
