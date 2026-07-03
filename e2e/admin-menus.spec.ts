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

  // POST /api/admin/menus の成功を、4秒で自動消滅し CI では消滅後にポーリングして flake する
  // 成功トーストではなく API 応答そのもので判定する（唯一の副作用ゼロな決定的判定）。
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/menus') && r.request().method() === 'POST' && r.ok()),
    addSave.press('Enter'),
  ]);
  // 一覧反映（書き込み永続化＝永続 DOM 証拠）。
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

  // PATCH /api/admin/menus/{id} の成功を API 応答そのもので判定する（トースト消滅 flake 回避）。
  await Promise.all([
    page.waitForResponse((r) => /\/api\/admin\/menus\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH' && r.ok()),
    editSave.press('Enter'),
  ]);
  // 一覧に編集後の名前が反映（旧名は消える＝永続 DOM 証拠）。
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

  // DELETE /api/admin/menus/{id} の成功を API 応答そのもので判定する（トースト消滅 flake 回避）。
  await Promise.all([
    page.waitForResponse((r) => /\/api\/admin\/menus\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE' && r.ok()),
    confirmDel.press('Enter'),
  ]);
  // 一覧から消滅（永続削除＝永続 DOM 証拠）。
  await expect(page.getByText(editedName, { exact: true })).toHaveCount(0);
});
