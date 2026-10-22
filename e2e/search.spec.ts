import { test, expect } from '@playwright/test';

test.describe('検索フロー', () => {
  test('トップページから検索できる', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    // 検索バーに入力
    const searchInput = page.getByPlaceholder(/検索|Search/);
    if (await searchInput.isVisible()) {
      await searchInput.fill('鍼灸');
      await searchInput.press('Enter');
      await page.waitForURL(/\/search/);
    } else {
      // 業種リンクから検索
      await page.goto('/search?type=鍼灸院');
    }
    await expect(page).toHaveURL(/\/search/);
  });

  test('検索結果ページが表示される', async ({ page }) => {
    await page.goto('/search');
    await expect(page.locator('h1')).toBeVisible();
    // 件数表示を特定して検証する。`/件/` だけだと複数要素に一致して曖昧になるため、
    // 結果見出しの「N 件見つかりました」を限定して検証する。
    await expect(page.getByText(/件見つかりました/)).toBeVisible();
  });

  test('業種フィルターが動作する', async ({ page }) => {
    await page.goto('/search?type=鍼灸院');
    await expect(page).toHaveURL(/type=%E9%8D%BC%E7%81%B8%E9%99%A2|type=鍼灸院/);
    await expect(page.locator('body')).not.toContainText('エラー');
  });

  // 価格帯・保険適用・症状は facility_card_view からの !inner 埋め込み（facility_menus /
  // facility_symptoms → symptoms）として検索本体のクエリに入れ、DB が絞り込む。埋め込みや条件の
  // 書き方を PostgREST が受け付けないと、検索全体がエラー表示になる。単体テストは supabase を
  // モックしているので検出できず、実際の PostgREST を通すのはここだけ。
  for (const query of [
    'price_min=1000&price_max=20000',
    'price_max=3000&sort=rating',
    'insurance=1',
    `symptom=${encodeURIComponent('腰痛')}`,
    `price_min=1000&insurance=1&symptom=${encodeURIComponent('腰痛')}&type=${encodeURIComponent('鍼灸院・整骨院')}&page=2`,
    'lat=34.7816&lng=135.4699&price_max=20000&insurance=1',
  ]) {
    test(`メニュー単位・症状の絞り込みが DB で通る: ${query}`, async ({ page }) => {
      await page.goto(`/search?${query}`);
      await expect(page.getByText(/件見つかりました/)).toBeVisible();
      await expect(page.getByRole('heading', { name: '検索結果を表示できません' })).toBeHidden();
    });
  }

  // 結果より後ろのページは PostgREST が 416 を返す。以前は検索失敗として 500 になっていた
  // （本番で掲載 3 件の /search?page=2 が 500・2026年10月22日）。1 ページ目へ戻すことを固定する。
  test('結果より後ろのページは 1 ページ目へ戻る', async ({ page }) => {
    await page.goto(`/search?type=${encodeURIComponent('鍼灸院・整骨院')}&page=999`);
    await expect(page).not.toHaveURL(/page=/);
    await expect(page).toHaveURL(/type=/);
    await expect(page.getByText(/件見つかりました/)).toBeVisible();
    await expect(page.getByRole('heading', { name: '検索結果を表示できません' })).toBeHidden();
  });

  test('エリア検索ページが表示される', async ({ page }) => {
    await page.goto('/search/area');
    // ページ固有の見出しを限定（`h1, h2` は共通フッター見出しにも一致して曖昧なため）。
    await expect(page.getByRole('heading', { name: 'エリアから探す' })).toBeVisible();
    // The index can succeed while every on-demand statically generated child
    // fails. Follow the actual stored area link, then exercise request pagination.
    const region = page.locator('a[href^="/search/area/"]').first();
    await expect(region).toBeVisible();
    const href = await region.getAttribute('href');
    expect(href).toMatch(/^\/search\/area\/[^/?]+$/);
    await region.click();
    await expect(page).toHaveURL(url => url.pathname === href);
    await expect(page.getByRole('heading', { level: 1, name: /のサロン・クリニック$/ })).toBeVisible();
    const paged = await page.goto(`${href}?page=2`);
    expect(paged?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: /のサロン・クリニック$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'エラーが発生しました', exact: true })).toBeHidden();
  });
});
