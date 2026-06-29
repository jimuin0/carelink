// 来院者（ゲスト・未ログイン）が施設に口コミ（5軸星評価＋本文）を投稿できることを実行証明する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。reCAPTCHA は CI で SECRET 未設定のためスキップされる。
//
// #312 教訓：施設ページのタブ内容ハイドレーションが CI headless で不安定だった。タブを明示クリックし、
// フォーム要素（#reviewer_name）が actionable になるまで待ってから操作することで堅牢化する。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { REVIEW_FACILITY_FILE, REVIEW_SEED } from './review.fixtures';

test('ゲストが施設に口コミを投稿できる', async ({ page }) => {
  const { slug } = JSON.parse(fs.readFileSync(REVIEW_FACILITY_FILE, 'utf8')) as { slug: string };
  await page.goto(`/facility/${slug}`);

  // 口コミタブを明示的に開く（初期アクティブタブは top）。ハイドレーション完了後にクリックできるよう
  // タブ自体の表示を待ってから押す。
  const reviewTab = page.getByRole('tab', { name: /口コミ/ });
  await expect(reviewTab).toBeVisible({ timeout: 15000 });
  await reviewTab.click();

  // フォームが actionable になるまで待つ（タブパネルの描画完了）。
  const nameInput = page.locator('#reviewer_name');
  await expect(nameInput).toBeVisible({ timeout: 15000 });
  await nameInput.fill(REVIEW_SEED.reviewerName);

  // 5軸の星評価をすべて 5 点にする（各 StarRating に aria-label="5点を選択" が1つ＝計5個）。
  const fiveStarButtons = page.getByRole('button', { name: '5点を選択' });
  await expect(fiveStarButtons.first()).toBeVisible({ timeout: 15000 });
  const count = await fiveStarButtons.count();
  for (let i = 0; i < count; i++) await fiveStarButtons.nth(i).click();

  await page.locator('#review_comment').fill(REVIEW_SEED.comment);

  // 投稿 → 確認ダイアログ「投稿する」で確定 → POST /api/review。
  await page.getByRole('button', { name: '口コミを投稿する' }).click();
  await page.getByRole('button', { name: '投稿する', exact: true }).click();

  // 成功＝facility_reviews に1行 INSERT・成功表示「口コミを投稿しました」。
  await expect(page.getByText('口コミを投稿しました')).toBeVisible({ timeout: 15000 });
});
