// オーナーがブログ記事を作成できることを実行証明する（作成→一覧反映）。
// CI の隔離 Supabase（supabase start）上でのみ動作（本番不可侵）。admin-batch.setup の
// storageState（owner 認証）を使う。/admin/blog/new は facility_members の owner/admin で到達でき、
// POST /api/admin/blog は membership.facility_id で投稿先を解決するため owner 単独で完走する。
import { test, expect } from '@playwright/test';

test('オーナーがブログ記事を作成できる（書き込み→一覧反映）', async ({ page }) => {
  const title = `E2Eブログ記事_${Date.now()}`;
  await page.goto('/admin/blog/new');
  await expect(page.getByRole('heading', { name: 'ブログ新規作成' })).toBeVisible();

  // 必須はタイトル・本文の2つ（handleCreate は !title || !content で早期 return）。最小入力で作成する。
  await page.fill('#blog-title', title);
  await page.fill('#blog-content', 'E2E本文です。これはテスト記事の本文です。');

  // 作成ボタンはキーボード起動（focus→Enter）で確定する。CI の headless ビューポートでは
  // ポインタ hit-test 被りで .click() がタイムアウトすることがあるため、被りに依存しない操作を使う。
  const createBtn = page.getByRole('button', { name: '記事を作成' });
  await createBtn.scrollIntoViewIfNeeded();
  await createBtn.press('Enter');

  // 成功で /admin/blog へ遷移（router.push）。一覧に作成記事が出る（書き込み永続化＋再読込反映）。
  await page.waitForURL('**/admin/blog', { timeout: 15000 });
  await expect(page.getByText(title)).toBeVisible({ timeout: 15000 });
});
