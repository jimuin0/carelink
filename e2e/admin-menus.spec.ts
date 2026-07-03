// オーナーがメニュー（施術メニュー）を作成→編集→削除できることを実行証明する。
// 作成は既カバーだが PATCH/DELETE（src/app/admin/menus/page.tsx:95,134）は未カバーのため新設。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-batch.setup の storageState（owner 認証）を共有して使う。
import { test, expect } from '@playwright/test';

test('オーナーがメニューを作成→編集→削除できる（書き込み→一覧反映/消滅）', async ({ page }) => {
  // CI の retries で同一 storageState（同一施設）を再利用するため、毎回ユニーク名で衝突を避ける。
  const ts = `${Date.now()}`;
  const menuName = `E2Eメニュー_${ts}`;
  const editedName = `E2Eメニュー編集済_${ts}`;

  await page.goto('/admin/menus');

  // --- 作成：ヘッダーの「メニュー追加」→ モーダルで名前のみ入力（カテゴリ既定=カット）→ 保存。
  // 固定オーバーレイ（Cookie 同意バナー/AIサポート）と pointer hit-test が被り .click() が
  // タイムアウトする事例が既出のため、focus→Enter のキーボード起動（正当なユーザー操作）で押す。
  const addBtn = page.getByRole('button', { name: 'メニュー追加', exact: true });
  await expect(addBtn).toBeVisible({ timeout: 15000 });
  await addBtn.scrollIntoViewIfNeeded();
  await addBtn.press('Enter');

  const addDialog = page.getByRole('dialog');
  await expect(addDialog).toBeVisible();
  await addDialog.locator('#menu-name').fill(menuName);
  const addSave = addDialog.getByRole('button', { name: '保存', exact: true });
  await addSave.scrollIntoViewIfNeeded();
  // POST /api/admin/menus の 2xx を成功シグナルにする（waitForResponse はトリガーの press より前に
  // 登録して取りこぼしを防ぐ）。約4.3秒で自動消滅するトースト assertion は flaky の温床のため主判定に
  // せず、代わりに「API 2xx＋一覧反映（永続 DOM）」で成功を断定する（成功検証は同等以上・非揮発）。
  const menuPost = page.waitForResponse(
    (r) => r.url().includes('/api/admin/menus') && r.request().method() === 'POST' && r.ok(),
    { timeout: 15000 }
  );
  await addSave.press('Enter');
  await menuPost;
  await expect(page.getByText(menuName, { exact: true })).toBeVisible({ timeout: 15000 });

  // --- 編集：作成したメニュー行の「編集」ボタン（aria-label="編集"）→ モーダルで名前変更 → 保存。
  const row = page.locator('div.flex.items-center.gap-4.p-4').filter({ hasText: menuName });
  const editBtn = row.getByRole('button', { name: '編集', exact: true });
  await editBtn.scrollIntoViewIfNeeded();
  await editBtn.press('Enter');

  const editDialog = page.getByRole('dialog');
  await expect(editDialog.getByText('メニュー編集')).toBeVisible();
  await editDialog.locator('#menu-name').fill(editedName);
  const editSave = editDialog.getByRole('button', { name: '保存', exact: true });
  await editSave.scrollIntoViewIfNeeded();
  // PATCH /api/admin/menus/{id} の 2xx を成功シグナルに（press より前に登録）。編集後の名前が一覧に
  // 反映され旧名が消える永続 DOM を主判定とし、揮発トースト依存を外す。
  const menuPatch = page.waitForResponse(
    (r) => /\/api\/admin\/menus\/[^/?]+/.test(r.url()) && r.request().method() === 'PATCH' && r.ok(),
    { timeout: 15000 }
  );
  await editSave.press('Enter');
  await menuPatch;
  await expect(page.getByText(editedName, { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(menuName, { exact: true })).toHaveCount(0);

  // --- 削除：編集後メニュー行の「削除」ボタン（aria-label="削除"）→ 確認ダイアログ「削除する」。
  const editedRow = page.locator('div.flex.items-center.gap-4.p-4').filter({ hasText: editedName });
  const delBtn = editedRow.getByRole('button', { name: '削除', exact: true });
  await delBtn.scrollIntoViewIfNeeded();
  await delBtn.press('Enter');

  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  const confirmDel = confirm.getByRole('button', { name: '削除する', exact: true });
  await confirmDel.scrollIntoViewIfNeeded();
  // DELETE /api/admin/menus/{id} の 2xx を成功シグナルに（press より前に登録）。一覧からの消滅
  // （toHaveCount(0)＝永続削除）を主判定とし、揮発トースト依存を外す（確定 flake 箇所の根治）。
  const menuDelete = page.waitForResponse(
    (r) => /\/api\/admin\/menus\/[^/?]+/.test(r.url()) && r.request().method() === 'DELETE' && r.ok(),
    { timeout: 15000 }
  );
  await confirmDel.press('Enter');
  await menuDelete;
  await expect(page.getByText(editedName, { exact: true })).toHaveCount(0);
});
