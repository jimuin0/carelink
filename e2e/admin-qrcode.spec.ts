// オーナーが施設ページ QR コードを生成し PNG 保存できることを実行証明する。
// CI の隔離 Supabase（supabase start）上でのみ動作（本番不可侵）。admin-batch.setup の
// storageState（owner 認証）を使う。QR は qrcode npm でブラウザ内ローカル生成＝外部依存なし。
import { test, expect } from '@playwright/test';

test('オーナーが施設QRコードを生成しPNG保存できる', async ({ page }) => {
  await page.goto('/admin/qrcode');
  await expect(page.getByRole('heading', { name: 'QRコード' })).toBeVisible({ timeout: 15000 });

  // qrcode npm でローカル生成された QR 画像（data URL PNG）が表示される（外部依存なし）。
  const qrImg = page.getByRole('img', { name: 'QRコード' }).first();
  await expect(qrImg).toBeVisible({ timeout: 15000 });
  await expect(qrImg).toHaveAttribute('src', /^data:image\/png;base64,/);

  // 施設ページ URL（slug 由来）が表示される。
  await expect(page.getByText('carelink-jp.com/facility/').first()).toBeVisible();

  // PNG 保存（data URL のローカルダウンロード）→ 成功トースト。focus→Enter で hit-test 被り回避。
  const pngBtn = page.getByRole('button', { name: 'PNG保存' });
  await pngBtn.scrollIntoViewIfNeeded();
  await pngBtn.press('Enter');
  await expect(page.getByText('QRコードをダウンロードしました')).toBeVisible({ timeout: 15000 });
});
