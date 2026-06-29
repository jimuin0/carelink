// 来院者が施設をお気に入り登録できることを実行証明する（トグル＝aria-label 変化＋DB 書き込み）。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。visitor-favorite.setup の storageState を使う。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { VISITOR_FAVORITE_FACILITY_FILE } from './visitor-favorite.fixtures';

test('来院者が施設をお気に入り登録できる', async ({ page }) => {
  const { slug } = JSON.parse(fs.readFileSync(VISITOR_FAVORITE_FACILITY_FILE, 'utf8')) as { slug: string };
  await page.goto(`/facility/${slug}`);

  // 初期は未登録（aria-label「お気に入りに追加」）。クリックで POST /api/favorites → 登録。
  const addBtn = page.getByRole('button', { name: 'お気に入りに追加' });
  await expect(addBtn).toBeVisible({ timeout: 15000 });
  await addBtn.click();

  // 登録成功＝aria-label が「お気に入りから削除」に変わる（favorites に1行 INSERT・サーバ応答で確定）。
  await expect(page.getByRole('button', { name: 'お気に入りから削除' })).toBeVisible({ timeout: 15000 });
});
