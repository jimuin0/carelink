import { test, expect, devices, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { confirmSyntheticBookingPreparation } from './booking-preparation.seed';

/**
 * スマホ（iPhone 13 の画面）で、画面下部の固定バーが他の操作を覆わないこと（2026年10月22日）。
 *
 * 本番では次の 3 つが実測で起きていた。
 * - 一番下までスクロールしても、フッター最終行の「プライバシーポリシー／利用規約／
 *   特定商取引法に基づく表記」が下部ナビの下に隠れ、押すとナビ（ホーム・検索…）が開いた。
 *   特商法表記へはフッターからしか行けないので、スマホからは開けなかった。
 * - トップの会員登録 CTA が下部ナビと Cookie 同意バナーの「必須のみ／すべて同意」を覆っていた。
 * - 絞り込みドロワーで「この条件で検索」「クリア」を押しても閉じず、反応が無いように見えた。
 * - 施設詳細では予約バー（StickyBookingBar）がフッターの「施設掲載をご希望のオーナー様はこちら」と
 *   規約リンクを覆っていた。予約バーは残席表示や案内文の折り返しで高さが変わるため、
 *   予約できる施設（今すぐ予約する）と掲載のみの施設（案内文が 2 行に折り返す）の両方で確かめる。
 *
 * 「見えている」だけでは覆われていても通ってしまうので、要素の中心で elementFromPoint を引き、
 * 本当にその要素が押せる（いちばん手前にある）ことまで確かめる。
 * Mobile Safari プロジェクトでは iPhone 13 そのもの、他のプロジェクトでも同じ画面サイズで走る。
 */
test.use({ viewport: devices['iPhone 13'].viewport });

const CONSENT = JSON.stringify({ necessary: true, analytics: false, marketing: false });

async function withStoredConsent(page: Page) {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('cookie-consent-v2', value);
    } catch {
      // ストレージが使えない場合は同意バナーが出るだけ（検査側で落ちる）
    }
  }, CONSENT);
}

/**
 * 要素の中心が画面内にあり、その点でいちばん手前にあるのが当の要素（か、その子孫）であること。
 * stickToBottom: 判定のたびに末尾までスクロールし直す。遅延描画でページが伸びると、
 * 一度末尾へ着いた後でもフッターが画面外へ押し出される（CI の Mobile Safari で実測）。
 */
async function expectHittable(locator: Locator, { stickToBottom = false }: { stickToBottom?: boolean } = {}) {
  await expect
    .poll(
      () =>
        locator.evaluate((el, toBottom) => {
          if (toBottom) window.scrollTo(0, document.documentElement.scrollHeight);
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          if (r.width === 0 || r.height === 0 || y < 0 || y > window.innerHeight) {
            return `画面外 (top=${Math.round(r.top)}, bottom=${Math.round(r.bottom)}, viewport=${window.innerHeight})`;
          }
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit === el || el.contains(hit))) return 'ok';
          const name = hit ? `${hit.tagName.toLowerCase()} "${(hit.textContent ?? '').trim().slice(0, 20)}"` : 'なし';
          return `覆われている: ${name}`;
        }, stickToBottom),
      { message: '要素がいちばん手前で押せること' },
    )
    .toBe('ok');
}

async function scrollToVeryBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // 遅延描画でページが伸びた場合に備え、末尾に着いたことを確かめる
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1;
      }),
    )
    .toBe(true);
}

/**
 * @param fixedBar 画面下部に固定されるバー。既定は下部ナビ（施設詳細では予約バーを渡す）。
 */
async function expectFooterLegalLinksReachable(page: Page, fixedBar?: Locator) {
  const footer = page.getByRole('contentinfo');
  const bar = fixedBar ?? page.getByRole('navigation', { name: 'メインナビゲーション' });
  // 下部ナビは遅延読み込み。出てから測らないと「覆うものが無い」状態で緑になる
  await expect(bar).toBeVisible();
  await scrollToVeryBottom(page);
  for (const name of ['プライバシーポリシー', '利用規約', '特定商取引法に基づく表記']) {
    await expectHittable(footer.getByRole('link', { name, exact: true }), { stickToBottom: true });
  }
}

for (const path of ['/search', '/ranking', '/auth/login', '/auth/signup']) {
  test(`${path}: 一番下までスクロールすれば、フッターの規約リンクが下部ナビに覆われず押せる`, async ({ page }) => {
    await withStoredConsent(page);
    await page.goto(path);
    await expectFooterLegalLinksReachable(page);
  });
}

test('/: 会員登録 CTA が出ていても、下部ナビとフッターの規約リンクを覆わない', async ({ page }) => {
  await withStoredConsent(page);
  await page.goto('/');
  const cta = page.locator('[data-sticky-signup-cta]');
  // 未ログインなので CTA が出る（出ないまま測ると、覆うものが無いので空振りで緑になる）
  await expect(cta).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
  await expect(nav).toBeVisible();
  await expectHittable(nav.getByRole('link', { name: 'ホーム' }));
  await expectHittable(cta.getByRole('link', { name: '無料で会員登録する' }));

  // 下半分（クライアント描画）が出てから末尾へ
  await expect(page.getByRole('heading', { name: '都道府県から探す' })).toBeAttached();
  await expectFooterLegalLinksReachable(page);
});

test('/: 初回訪問の Cookie 同意バナーは下部ナビの上に出て、ボタンが押せる（CTA はその後に出る）', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByRole('region', { name: 'Cookieの設定' });
  await expect(banner).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
  await expect(nav).toBeVisible();

  // 同意の選択が済むまで CTA は出さない（バナーのボタンを覆っていた）
  await expect(page.locator('[data-sticky-signup-cta]')).toHaveCount(0);
  await expectHittable(banner.getByRole('button', { name: '必須のみ', exact: true }));
  await expectHittable(banner.getByRole('button', { name: 'すべて同意', exact: true }));
  await expectHittable(nav.getByRole('link', { name: 'ホーム' }));

  await banner.getByRole('button', { name: '必須のみ', exact: true }).click();
  await expect(banner).toBeHidden();
  const cta = page.locator('[data-sticky-signup-cta]');
  await expect(cta).toBeVisible();
  await expectHittable(nav.getByRole('link', { name: 'ホーム' }));
});

test('/search: 絞り込みドロワーは「この条件で検索」「クリア」で閉じる', async ({ page }) => {
  await withStoredConsent(page);
  await page.goto('/search');
  const dialog = page.locator('#mobile-filter-dialog');
  const isOpen = () => dialog.evaluate((el) => (el as HTMLDialogElement).open);
  // ドロワーはクライアント側だけで描かれる。描かれる前（ハイドレーション前）に押しても開かない
  await expect(dialog).toBeAttached();

  await page.getByRole('button', { name: '絞り込みフィルターを開く' }).click();
  await expect.poll(isOpen).toBe(true);
  await dialog.getByRole('button', { name: '当日予約OK' }).click();
  await dialog.getByRole('button', { name: 'この条件で検索' }).click();
  await expect(page).toHaveURL(/[?&]features=/);
  await expect.poll(isOpen).toBe(false);

  await page.getByRole('button', { name: '絞り込みフィルターを開く' }).click();
  await expect.poll(isOpen).toBe(true);
  await dialog.getByRole('button', { name: 'フィルターをクリア' }).click();
  await expect(page).not.toHaveURL(/features=/);
  await expect.poll(isOpen).toBe(false);
});

test.describe('施設詳細: 予約バー', () => {
  let readySlug: string;
  let listingSlug: string;

  // 施設は CI の使い捨て Supabase にだけ seed する（booking.spec.ts と同じ守り。本番・手元の DB には書かない）。
  test.beforeAll(async () => {
    if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
      || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
      || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000') {
      throw new Error('facility bottom bar fixture requires the managed disposable CI lifecycle');
    }
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const base = { business_type: 'ヘアサロン', prefecture: '東京都', city: '検証市', address: '合成町1', status: 'published' };

    // 予約できる施設（電話・今すぐ予約する・問合せの 3 ボタン）
    readySlug = `synthetic-bottom-bar-${randomUUID()}`;
    const ready = await db.from('facility_profiles')
      .insert({ ...base, name: '合成予約バー確認店', slug: readySlug, phone: '0300000000' })
      .select('id').single();
    if (ready.error || !ready.data) throw new Error('synthetic bottom bar facility setup failed');
    const menu = await db.from('facility_menus').insert({ facility_id: ready.data.id, name: '合成カット',
      category: 'カット', price: 5000, duration_minutes: 60, is_published: true });
    const staff = await db.from('staff_profiles').insert({ facility_id: ready.data.id, name: '合成スタッフ',
      slug: `${readySlug}-staff`, is_active: true }).select('id').single();
    if (menu.error || staff.error || !staff.data) throw new Error('synthetic bottom bar catalog setup failed');
    // 勤務時間の無いスタッフは予約を受けられない（facility_booking_ready・20261023080000）。勤務は明示して作る。
    const week = await db.from('staff_schedules').insert(Array.from({ length: 7 }, (_, day) => ({
      staff_id: staff.data.id, day_of_week: day, start_time: '09:00', end_time: '20:00' })));
    if (week.error) throw new Error('synthetic bottom bar schedule setup failed');
    await confirmSyntheticBookingPreparation(db, ready.data.id);

    // 掲載のみの施設（ネット予約の準備中。案内文が折り返して予約バーが高くなる）
    listingSlug = `synthetic-bottom-bar-listing-${randomUUID()}`;
    const listing = await db.from('facility_profiles')
      .insert({ ...base, name: '合成掲載のみ確認店', slug: listingSlug })
      .select('id').single();
    if (listing.error || !listing.data) throw new Error('synthetic listing-only facility setup failed');
  });

  const bookingBar = (page: Page) => page.locator('[data-bottom-fixed].sticky-bar');

  async function expectFooterReachableAboveBookingBar(page: Page) {
    await expectFooterLegalLinksReachable(page, bookingBar(page));
    await expectHittable(page.getByRole('contentinfo').locator('a[href="/salon"]'), { stickToBottom: true });
  }

  test('予約できる施設: 一番下までスクロールすれば、フッターの掲載案内と規約リンクが予約バーに覆われず押せる', async ({ page }) => {
    await withStoredConsent(page);
    await page.goto(`/facility/${readySlug}`);
    await expect(bookingBar(page).getByRole('link', { name: '今すぐ予約する' })).toBeVisible();
    await expectFooterReachableAboveBookingBar(page);
  });

  test('掲載のみの施設: 案内文で高くなった予約バーでも、フッターの掲載案内と規約リンクを覆わない', async ({ page }) => {
    await withStoredConsent(page);
    await page.goto(`/facility/${listingSlug}`);
    const notice = bookingBar(page).getByText('ネット予約は準備中です', { exact: false });
    await expect(notice).toBeVisible();
    // 折り返して 2 行以上になっていること（1 行のままでは高いバーを確かめたことにならない）
    expect(await notice.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(30);
    await expectFooterReachableAboveBookingBar(page);
  });

  test('初回訪問: Cookie 同意バナーは予約バーの上に出て、「必須のみ」と「今すぐ予約する」の両方が押せる', async ({ page }) => {
    await page.goto(`/facility/${readySlug}`);
    const banner = page.getByRole('region', { name: 'Cookieの設定' });
    const reserve = bookingBar(page).getByRole('link', { name: '今すぐ予約する' });
    await expect(banner).toBeVisible();
    await expect(reserve).toBeVisible();
    await expectHittable(banner.getByRole('button', { name: '必須のみ', exact: true }));
    await expectHittable(banner.getByRole('button', { name: 'すべて同意', exact: true }));
    await expectHittable(reserve);

    await banner.getByRole('button', { name: '必須のみ', exact: true }).click();
    await expect(banner).toBeHidden();
    await expectHittable(reserve);
  });
});
