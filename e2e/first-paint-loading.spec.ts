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

/** 予約日時の変更画面を開ける利用者（ログイン可能なアカウント＋変更可能な予約）を用意する。 */
async function seedVisitorWithBooking() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('first-paint: SUPABASE env 未設定');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { facilityId } = await seedBookableFacility();
  const ts = `${Date.now()}`;
  const email = `first-paint-visitor-${ts}@example.invalid`;
  const password = 'FirstPaintVisitor2026!';

  const { data: cu, error: ce } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (ce) throw new Error('seed user: ' + JSON.stringify(ce, Object.getOwnPropertyNames(ce)));

  // 変更可能な予約（status は pending/confirmed のみ変更画面を開ける）。
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: bk, error: be } = await sb
    .from('bookings')
    .insert({
      facility_id: facilityId, user_id: cu.user.id, booking_date: tomorrow,
      start_time: '10:00', end_time: '11:00', status: 'confirmed',
      customer_name: '初期描画検証', email, phone: '09000000000',
    })
    .select('id')
    .single();
  if (be) throw new Error('seed booking: ' + be.message);

  return { email, password, bookingId: bk.id as string };
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
  // 🔴 chromium だけで走らせる。
  // ここで検査しているのは【useEffect がペイント後に走る】という React のライフサイクルの性質で、
  // ブラウザ実装に依存しない。一方 Mobile Safari（iPhone 13 エミュレーション）では、
  // ログイン後リダイレクトの競合や狭いビューポートに起因する、検査対象とは無関係な失敗が出る
  // （2026年8月17日 CI で実測：chromium 4/4 緑・Mobile Safari のみ 2 件失敗）。
  // 同じ不変条件を 2 ブラウザで見ても得るものが無く、無関係な理由で赤くなる分だけ信頼性が下がる。
  test.skip(({ browserName }) => browserName !== 'chromium', 'React のライフサイクル検査のためブラウザ差は無関係');

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

  test('予約日時の変更：日付を選んだ最初のフレームに前日の枠や「空きなし」が出ない', async ({ page }) => {
    // シード（施設＋メニュー＋スタッフ＋利用者＋予約）と実 UI ログインを含むため既定 30 秒では足りない。
    test.setTimeout(120_000);
    await delayRoute(page, '**/api/slots*', 3000);

    const { email, password, bookingId } = await seedVisitorWithBooking();

    // 実 UI でログイン（@supabase/ssr の認証 Cookie を確立する）。
    await page.goto(`/auth/login?redirect=/mypage/bookings/${bookingId}/change`);
    await page.fill('#login-email', email);
    await page.fill('#login-password', password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    // 🔴 「/auth/login を抜けた」だけを待つと、アプリ側の既定リダイレクト（/mypage）が
    // まだ進行中のまま次の goto を出してしまい "interrupted by another navigation" になる
    // （2026年8月17日 CI で実測）。目的のパスに到達したことを直接待つ。
    await page.waitForURL(`**/mypage/bookings/${bookingId}/change`, { timeout: 30000 });
    // 日付ボタンは「8/19」＋曜日の 2 行構成。日付部分の正規表現で拾う。
    const dateButtons = page.locator('button').filter({ hasText: /^\d+\/\d+/ });
    await expect(dateButtons.first()).toBeVisible({ timeout: 30000 });

    // 空き枠の表示領域の最初の描画を捕まえる。
    await page.evaluate(() => {
      const w = window as unknown as { __fp?: string | null; __o?: MutationObserver };
      w.__fp = null;
      if (w.__o) w.__o.disconnect();
      w.__o = new MutationObserver(() => {
        if (w.__fp != null) return;
        // 枠の表示領域だけを見る。ページ全体だと既存予約の時刻表示（10:00 等）を拾ってしまう。
        const picker = document.querySelector('[data-testid="slot-picker"]');
        if (!picker) return;
        const t = (picker as HTMLElement).innerText.replace(/\s+/g, ' ');
        const m = t.match(/(この日は予約可能な時間帯がありません|\d{2}:\d{2})/);
        if (m) w.__fp = m[1];
      });
      w.__o.observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    await dateButtons.first().click();

    // 取得完了を待たずに、記録された最初の描画を読む。
    await page.waitForTimeout(500);
    const first = await page.evaluate(() => (window as unknown as { __fp?: string | null }).__fp ?? null);

    // 最初の描画で「空きなし」の断定も、前の日付の時間枠も出ていないこと。
    // （null＝スピナーだけが出ていて、どちらも描かれなかった状態＝期待どおり）
    expect(
      first,
      `日付を選んだ最初のフレームに「${first}」が出た。空き枠を取得する前に結果を見せている` +
        '（初回は誤った「空きなし」、2回目以降は前の日付の枠が見えて別日の枠を選ばせ得る）',
    ).toBeNull();
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
