import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * 来院者向け公開画面のタップ領域（WCAG 2.2 AA 2.5.8: 24×24px 以上か十分な間隔）をゲートする
 * （2026年10月22日）。本番では「都道府県から探す」の地名リンク（36×17px）、
 * パスワード表示ボタン（20×20px）、日本地図の「中国」ラベル（「九州・沖縄」に一部重なる）が満たしていなかった。
 */
const PAGES = ['/', '/search', '/auth/login', '/auth/signup', '/register'];

for (const path of PAGES) {
  test(`タップ領域: ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
    if (path === '/') {
      // 地名リンクと地図はクライアント描画。描画されてから測る（空振りで緑にしない）
      await expect(page.getByRole('heading', { name: '都道府県から探す' })).toBeAttached();
      await expect(page.getByRole('link', { name: '中国' }).first()).toBeAttached();
    }
    const results = await new AxeBuilder({ page }).withRules(['target-size']).analyze();
    const found = results.violations.flatMap(v => v.nodes.map(n => `${n.target.join(' ')} ${(n.any[0]?.message ?? '').slice(0, 90)}`));
    expect(found).toEqual([]);
  });
}

/**
 * 構造面（2026年10月22日）: Cookie通知がランドマーク外、モバイルメニューと
 * トップの右メニューが名前の無い <nav> で区別できない、フッター・検索結果で見出しが飛ぶ、が本番にあった。
 */
for (const path of PAGES) {
  test(`ランドマーク・見出し順: ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    if (path === '/') await expect(page.getByRole('heading', { name: '都道府県から探す' })).toBeAttached();
    const results = await new AxeBuilder({ page }).withRules(['region', 'landmark-unique', 'heading-order']).analyze();
    const found = results.violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(' ')}`));
    expect(found).toEqual([]);
  });
}
