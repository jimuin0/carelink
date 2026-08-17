/**
 * 「開いた最初のフレームで、まだ試してもいない結果を見せていないか」を検査する。
 *
 * 🔴 なぜ必要か（2026年8月16日 実機で発見した実欠陥）
 * useEffect はブラウザのペイント後に走る。そのため effect のトップレベルに setLoading(true) を
 * 置いても【パネルの最初のフレームには間に合わない】。StationSearch では、駅一覧を取得する前に
 * 「該当する駅がありません」が 1 フレーム見えていた（クリックから 39ms で計測）。
 * 利用者には「押したら駅が無いと言われた」としか見えない。
 *
 * この欠陥は lint も tsc も単体テストも通る。さらに Sonnet 8 体の差分レビューと
 * Opus 3 体の独立評価もすべて見逃した。「effect のトップレベルにあるから即座に反映される」と
 * 全員が思い込んでいたためで、コードを読むだけでは到達できない実行時の性質だった。
 * だから実ブラウザで最初の描画を捕まえる検査を置く。
 *
 * 【検査の方法】
 * 操作する前に MutationObserver を仕掛け、対象領域が最初に現れた瞬間の文字列を記録する。
 * スクリーンショットや待機後の assert では、すでに次のコミットに進んでいて欠陥を見逃す
 * （実際、最初はそれで見逃した）。
 *
 * 【偽陰性への備え】
 * 取得を遅延させないと、fetch が速すぎて最初のフレームを観測できたのか、単に完了後の状態を
 * 見ているのか区別できない。route で応答を遅らせ、かつ「観測できたこと」自体も assert する。
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する。realtime 非接続のためダミー。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

/**
 * 予約フローを最後まで開ける店（公開施設＋メニュー＋在籍スタッフ）を用意する。
 * スタッフが 0 人だと空き状況の effect が早期 return して取得自体が走らず、
 * 「ローディングが出ない」ことの検査が空振りする（実測で踏んだ）。
 */
async function seedBookableFacility() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('first-paint: SUPABASE env 未設定（CI の supabase start 由来）');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ts = `${Date.now()}`;
  const { data: fac, error: fe } = await sb
    .from('facility_profiles')
    .insert({
      name: `初期描画検証店_${ts}`, slug: `first-paint-${ts}`, business_type: 'ヘアサロン',
      prefecture: '東京都', city: 'テスト市', address: 'テスト1-1-1', status: 'published',
    })
    .select('id, slug')
    .single();
  if (fe) throw new Error('seed facility: ' + fe.message);

  const { error: me } = await sb.from('facility_menus').insert({
    facility_id: fac.id, name: 'カット', price: 5000, duration_minutes: 60, category: 'カット',
  });
  if (me) throw new Error('seed menu: ' + me.message);

  const { error: se } = await sb.from('staff_profiles').insert({
    facility_id: fac.id, name: '検証スタッフ', slug: `first-paint-staff-${ts}`, is_active: true,
  });
  if (se) throw new Error('seed staff: ' + se.message);

  return { facilityId: fac.id as string, facilitySlug: fac.slug as string };
}

/** 応答を遅らせ、ローディング状態が観測可能な時間だけ持続するようにする。 */
async function delayRoute(page: Page, urlPattern: string, ms: number) {
  await page.route(urlPattern, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/**
 * 操作前に監視を仕掛け、`selector` が最初に描画された瞬間の innerText を返す。
 * 見つからなければ null。
 */
async function captureFirstPaint(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const w = window as unknown as { __firstPaint?: string | null; __fpObserver?: MutationObserver };
    w.__firstPaint = null;
    if (w.__fpObserver) w.__fpObserver.disconnect();
    w.__fpObserver = new MutationObserver(() => {
      if (w.__firstPaint != null) return;
      const el = document.querySelector(sel);
      if (el) w.__firstPaint = (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
    });
    w.__fpObserver.observe(document.body, { childList: true, subtree: true });
  }, selector);
}

async function readFirstPaint(page: Page) {
  return page.evaluate(() => (window as unknown as { __firstPaint?: string | null }).__firstPaint ?? null);
}

test.describe('開いた最初のフレームに、試す前の結果を出していない', () => {
  test('駅検索：開いた最初のフレームが「該当する駅がありません」ではない', async ({ page }) => {
    // 取得を遅らせ、ローディング状態が確実に観測できる長さにする。
    await delayRoute(page, '**/api/stations*', 3000);

    await page.goto('/');
    const openButton = page.getByRole('button', { name: '駅から探す' });
    await expect(openButton).toBeVisible();

    await captureFirstPaint(page, '#station-listbox');
    await openButton.click();

    // パネルが出るまで待つ（最初の描画は observer が既に記録している）
    await expect(page.locator('#station-listbox')).toBeVisible();
    const first = await readFirstPaint(page);

    // 空振り防止：観測できていない（null）なら、この assert 自体が意味を失う。
    expect(first, '最初の描画を観測できていない（observer の仕掛けが効いていない）').not.toBeNull();

    // 本題：まだ取得していないのに「駅が無い」と言っていないこと。
    expect(
      first,
      `開いた最初のフレームが「${first}」だった。取得前に結果を見せている（useEffect は` +
        'ペイント後に走るため、ローディングはイベントハンドラ側で立てる必要がある）',
    ).not.toContain('該当する駅がありません');

    // 期待する状態：読み込み中が最初から出ている。
    expect(first).toContain('読み込み中');
  });

  test('予約フロー：日時ステップの最初のフレームが「予約可能な時間帯がありません」ではない', async ({ page }) => {
    // 空き状況の取得を遅らせ、ローディングが観測できる長さにする。
    await delayRoute(page, '**/api/slots*', 3000);

    // 公開施設（メニューとスタッフがある店）を service role で用意する。
    const { facilitySlug } = await seedBookableFacility();

    await page.goto(`/facility/${facilitySlug}/booking`);
    const menu = page.getByRole('button', { name: /カット/ });
    await expect(menu).toBeVisible({ timeout: 20000 });
    await menu.click();

    // tbody（空き状況マトリクス本体）の最初の描画を捕まえる。
    await page.evaluate(() => {
      const w = window as unknown as { __fp?: { spinner: boolean; text: string } | null; __o?: MutationObserver };
      w.__fp = null;
      if (w.__o) w.__o.disconnect();
      w.__o = new MutationObserver(() => {
        if (w.__fp) return;
        const tb = document.querySelector('table tbody');
        if (!tb) return;
        w.__fp = {
          spinner: !!tb.querySelector('.animate-spin'),
          text: (tb as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
        };
      });
      w.__o.observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    await page.getByRole('button', { name: /日時を選ぶ/ }).click();
    await expect(page.locator('table tbody')).toBeVisible();

    const first = await page.evaluate(
      () => (window as unknown as { __fp?: { spinner: boolean; text: string } | null }).__fp ?? null,
    );

    expect(first, '最初の描画を観測できていない').not.toBeNull();
    expect(
      first!.text,
      `日時ステップの最初のフレームが「${first!.text}」だった。空き状況を取得する前に` +
        '「予約できる時間帯が無い」と告げている（利用者は予約できない店だと誤解する）',
    ).not.toContain('予約可能な時間帯がありません');
    expect(first!.spinner, '最初のフレームでローディング表示が出ていない').toBe(true);
  });

  test('駅検索：2回目に開いたときも前回の結果が残っていない', async ({ page }) => {
    // 1 回目で失敗させ、2 回目に「駅情報の読み込みに失敗しました」が残らないことを見る。
    let call = 0;
    await page.route('**/api/stations*', async (route) => {
      call += 1;
      await new Promise((r) => setTimeout(r, 1500));
      if (call === 1) return route.fulfill({ status: 500, body: '{}' });
      return route.continue();
    });

    await page.goto('/');
    const openButton = page.getByRole('button', { name: '駅から探す' });

    // 1 回目：失敗させる
    await openButton.click();
    await expect(page.getByText('駅情報の読み込みに失敗しました')).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#station-listbox')).toBeHidden();

    // 2 回目：前回のエラーが最初のフレームに残っていないこと
    await captureFirstPaint(page, '#station-listbox');
    await openButton.click();
    await expect(page.locator('#station-listbox')).toBeVisible();
    const first = await readFirstPaint(page);

    expect(first, '最初の描画を観測できていない').not.toBeNull();
    expect(
      first,
      `2 回目に開いた最初のフレームが「${first}」だった。前回の失敗表示が残っている`,
    ).not.toContain('読み込みに失敗しました');
    expect(first).toContain('読み込み中');
  });
});
