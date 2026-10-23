import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * 来院者向け公開画面の文字コントラスト（WCAG AA）をゲートする（2026年10月21日）。
 * a11y-audit.spec.ts は全ルールの非ゲート測定のまま残し、ここでは「読めない文字」に直結する
 * color-contrast と link-in-text-block だけを、違反 0 件で通す条件にする。
 * 本番では gray-400 の補足文字（2.5:1）や red-500 の価格（3.8:1）、白い絞り込み欄の上の
 * 白文字「駅から探す」などが基準割れだった。
 */
const PAGES = ['/', '/search', '/auth/login', '/auth/signup', '/register', '/legal', '/symptom/low-back-pain', '/blog'];

for (const path of PAGES) {
  test(`文字コントラスト: ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    // 色の切り替えアニメーションの途中を測らない
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
    if (path === '/') {
      // 下半分はクライアント描画。描画されてから測る（空振りで緑にしない）
      await expect(page.getByRole('heading', { name: '都道府県から探す' })).toBeAttached();
    }
    const results = await new AxeBuilder({ page }).withRules(['color-contrast', 'link-in-text-block']).analyze();
    const found = results.violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(' ')} ${(n.any[0]?.message ?? '').slice(0, 80)}`));
    expect(found).toEqual([]);
  });
}

test('文字コントラスト: /search の地図表示（読み込み中・失敗の表示を含む）', async ({ page }) => {
  await page.goto('/search');
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  const mapToggle = page.getByRole('button', { name: 'マップ表示' });
  await expect(mapToggle).toBeVisible();
  await mapToggle.click();
  // 地図の読み込み中・読み込み失敗・表示済みのどれかになるまで待つ（どの状態でも文字は基準を満たすこと）
  await expect(page.getByText(/地図を読み込み中|地図を読み込めませんでした/).or(page.locator('.leaflet-container')).first()).toBeVisible();
  const results = await new AxeBuilder({ page }).withRules(['color-contrast', 'link-in-text-block']).analyze();
  const found = results.violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(' ')} ${(n.any[0]?.message ?? '').slice(0, 80)}`));
  expect(found).toEqual([]);
});
